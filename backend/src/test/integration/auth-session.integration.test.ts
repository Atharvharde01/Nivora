import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  clearDatabase,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { OtpChallengeModel } from "../../modules/auth/otp-challenge.model";
import { MockEmailService } from "../../modules/auth/email.service";
import { OtpService } from "../../modules/auth/otp.service";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthService } from "../../modules/auth/auth.service";
import { UserModel } from "../../modules/users/user.model";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import { LedgerEntryModel } from "../../modules/ledger/ledger.model";
import { SessionModel } from "../../modules/auth/session.model";
import { createAuthMiddleware } from "../../modules/auth/auth.middleware";
import { AuthError } from "../../modules/auth/auth.errors";
import { Request, Response } from "express";

describe("Task 23 — JWT Access Tokens & Session Authentication (Real Replica-Set Integration)", () => {
  const TEST_HMAC_SECRET =
    "integration_test_otp_hmac_secret_key_minimum_32_characters";
  const TEST_JWT_SECRET =
    "integration_test_jwt_access_secret_key_minimum_32_characters";

  let mockEmailService: MockEmailService;
  let otpService: OtpService;
  let jwtService: JwtService;
  let authService: AuthService;

  before(async () => {
    await setupIntegrationTestDb();
  });

  after(async () => {
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    mockEmailService = new MockEmailService();
    otpService = new OtpService({
      hmacSecret: TEST_HMAC_SECRET,
      emailService: mockEmailService,
    });
    jwtService = new JwtService({
      accessSecret: TEST_JWT_SECRET,
    });
    authService = new AuthService({
      otpService,
      jwtService,
    });
  });

  const DEFAULT_SIGNUP_CONSENTS = {
    acceptTerms: true,
    acceptPrivacy: true,
    acceptSimulationDisclosure: true,
    termsVersion: "1.0",
    privacyVersion: "1.0",
  };

  describe("1. First-Time User Provisioning (User + Account + Ledger + Session)", () => {
    it("atomically provisions new User, PracticeAccount, INITIAL_FUNDING ledger, and Session", async () => {
      const email = "newtrader@nivora.test";
      const ipAddress = "192.168.1.100";
      const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

      // Request and retrieve OTP
      await otpService.requestOtp(email, ipAddress);
      const rawOtp = mockEmailService.sentEmails[0].otp;

      // Execute login with valid OTP
      const loginResult = await authService.verifyOtpAndLogin({
        email,
        otp: rawOtp,
        displayName: "New Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress,
        userAgent,
      });

      assert.ok(loginResult);
      assert.equal(loginResult.user.email, email);
      assert.equal(loginResult.user.status, "ACTIVE");
      assert.equal(loginResult.user.onboardingCompleted, false);
      assert.ok(loginResult.accessToken);
      assert.ok(loginResult.refreshToken);

      // Verify User document in MongoDB
      const userDoc = await UserModel.findOne({ email }).lean();
      assert.ok(userDoc);
      assert.equal(userDoc.email, email);
      assert.equal(userDoc.status, "ACTIVE");

      // Verify PracticeAccount document in MongoDB
      const accountDoc = await PracticeAccountModel.findOne({
        userId: userDoc._id,
      }).lean();
      assert.ok(accountDoc);
      assert.equal(accountDoc.accountNumber, 1);
      assert.equal(accountDoc.status, "ACTIVE");
      assert.equal(accountDoc.cashBalancePaise, 100_000_000); // 100000000 paise (₹10,00,000)
      assert.equal(accountDoc.initialBalancePaise, 100_000_000);

      // Verify Ledger entry in MongoDB
      const ledgerDoc = await LedgerEntryModel.findOne({
        userId: userDoc._id,
        practiceAccountId: accountDoc._id,
      }).lean();
      assert.ok(ledgerDoc);
      assert.equal(ledgerDoc.entryType, "INITIAL_FUNDING");
      assert.equal(ledgerDoc.direction, "CREDIT");
      assert.equal(ledgerDoc.amountPaise, 100_000_000);
      assert.equal(ledgerDoc.balanceBeforePaise, 0);
      assert.equal(ledgerDoc.balanceAfterPaise, 100_000_000);

      // Verify Session document in MongoDB
      const sessionDoc = await SessionModel.findOne({
        userId: userDoc._id,
      })
        .select("+currentRefreshTokenHash +ipAddress +userAgent")
        .lean();
      assert.ok(sessionDoc);
      assert.equal(sessionDoc.status, "ACTIVE");
      assert.equal(sessionDoc.ipAddress, ipAddress);
      assert.equal(sessionDoc.userAgent, userAgent);
      // Ensure raw token is not stored (hash only)
      assert.notEqual(
        sessionDoc.currentRefreshTokenHash,
        loginResult.refreshToken
      );
      assert.equal(sessionDoc.currentRefreshTokenHash.length, 64);
    });
  });

  describe("2. Returning User Login & Multi-Device Sessions", () => {
    it("logs in returning user, creates separate session, preserves existing account & balance", async () => {
      const email = "returning@nivora.test";

      // 1. First login (device A)
      await otpService.requestOtp(email, "192.168.1.1");
      const otp1 = mockEmailService.sentEmails[0].otp;
      const login1 = await authService.verifyOtpAndLogin({
        email,
        otp: otp1,
        displayName: "Returning Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "192.168.1.1",
        userAgent: "DeviceA/1.0",
      });

      // Mutate account balance slightly (simulate trading activity)
      await PracticeAccountModel.updateOne(
        { userId: login1.user.id },
        { $set: { cashBalancePaise: 95_000_000 } }
      );

      // 2. Second login (device B)
      const t2 = new Date(Date.now() + 65_000);
      await otpService.requestOtp(email, "192.168.1.2", t2);
      const otp2 = mockEmailService.sentEmails[1].otp;
      const login2 = await authService.verifyOtpAndLogin({
        email,
        otp: otp2,
        ipAddress: "192.168.1.2",
        userAgent: "DeviceB/2.0",
        now: t2,
      });

      // Both logins share the same user ID
      assert.equal(login2.user.id, login1.user.id);
      // Sessions are distinct
      assert.notEqual(login2.session.id, login1.session.id);

      // Exactly ONE PracticeAccount exists and its mutated balance is PRESERVED (never reset)
      const accounts = await PracticeAccountModel.find({
        userId: login1.user.id,
      }).lean();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].cashBalancePaise, 95_000_000);

      // Exactly TWO active sessions exist in the database (unrelated devices not invalidated)
      const activeSessions = await SessionModel.find({
        userId: login1.user.id,
        status: "ACTIVE",
      }).lean();
      assert.equal(activeSessions.length, 2);
    });

    it("rejects login for SUSPENDED user and creates zero sessions", async () => {
      const email = "suspended@nivora.test";

      // Create suspended user
      const user = new UserModel({
        email,
        status: "SUSPENDED",
        onboardingCompleted: true,
      });
      await user.save();

      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;

      await assert.rejects(
        async () => {
          await authService.verifyOtpAndLogin({
            email,
            otp,
            ipAddress: "127.0.0.1",
            userAgent: "Mozilla/5.0",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "USER_SUSPENDED");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );

      // No session created
      const sessions = await SessionModel.find({ userId: user._id });
      assert.equal(sessions.length, 0);
    });
  });

  describe("3. Authentication Middleware Validation", () => {
    it("authenticates valid access token and attaches user and session context", async () => {
      const email = "middleware@nivora.test";
      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;

      const loginResult = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Middleware Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Jest/TestRunner",
      });

      const middleware = createAuthMiddleware(jwtService);

      let nextCalled = false;
      const req = {
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
        },
      } as unknown as Request;
      const res = {} as Response;

      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.ok(req.user);
      assert.equal(req.user.email, email);
      assert.ok(req.session);
      assert.equal(req.session._id.toString(), loginResult.session.id);
    });

    it("rejects revoked session with SESSION_REVOKED", async () => {
      const email = "revoked.session@nivora.test";
      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;

      const loginResult = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Revoked Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
      });

      // Revoke the session in database
      await SessionModel.updateOne(
        { _id: loginResult.session.id },
        {
          $set: {
            status: "REVOKED",
            revokedReason: "USER_LOGOUT",
            revokedAt: new Date(),
          },
        }
      );

      const middleware = createAuthMiddleware(jwtService);

      let capturedStatus = 0;
      let capturedBody: any = null;
      const req = {
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
        },
      } as unknown as Request;
      const res = {
        status: (code: number) => {
          capturedStatus = code;
          return {
            json: (body: Record<string, unknown>) => {
              capturedBody = body;
            },
          };
        },
      } as unknown as Response;

      await middleware(req, res, () => {
        assert.fail("next() should not be called for revoked session");
      });

      assert.equal(capturedStatus, 401);
      assert.equal(
        (capturedBody?.error as Record<string, unknown>)?.code,
        "SESSION_REVOKED"
      );
    });

    it("enforces 7-day idle timeout in middleware and updates status to EXPIRED", async () => {
      const email = "idle.session@nivora.test";
      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;

      const loginResult = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Idle Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
      });

      // Manually wind back session idleExpiresAt and lastActiveAt past current time
      const expiredPast = new Date(Date.now() - 1000);
      const pastActive = new Date(Date.now() - 2000);
      await SessionModel.updateOne(
        { _id: loginResult.session.id },
        { $set: { idleExpiresAt: expiredPast, lastActiveAt: pastActive } }
      );

      const middleware = createAuthMiddleware(jwtService);

      let capturedStatus = 0;
      let capturedBody: any = null;
      const req = {
        headers: {
          authorization: `Bearer ${loginResult.accessToken}`,
        },
      } as unknown as Request;
      const res = {
        status: (code: number) => {
          capturedStatus = code;
          return {
            json: (body: Record<string, unknown>) => {
              capturedBody = body;
            },
          };
        },
      } as unknown as Response;

      await middleware(req, res, () => {
        assert.fail("next() should not be called for idle expired session");
      });

      assert.equal(capturedStatus, 401);
      assert.equal(
        (capturedBody?.error as Record<string, unknown>)?.code,
        "SESSION_EXPIRED"
      );

      // Verify in DB that session was transitioned to EXPIRED with IDLE_TIMEOUT reason
      const doc = await SessionModel.findById(loginResult.session.id).lean();
      assert.ok(doc);
      assert.equal(doc.status, "EXPIRED");
      assert.equal(doc.revokedReason, "IDLE_TIMEOUT");
    });
  });

  describe("5. Phase 6.1 Revision — Unified New vs Existing Detection, DisplayName & Consent Persistence", () => {
    it("enforces displayName and consents for new users without consuming OTP, preserves stored name on returning login, and prevents duplicate accounts", async () => {
      const email = "consent.signup@nivora.test";
      const reqRes = await otpService.requestOtp(email, "127.0.0.1");
      assert.equal(reqRes.resendCooldownSeconds, 60);

      const rawOtp = mockEmailService.sentEmails[0].otp;

      // 1. Missing displayName for new user fails with DISPLAY_NAME_REQUIRED without consuming OTP
      await assert.rejects(
        async () => {
          await authService.verifyOtpAndLogin({
            email,
            otp: rawOtp,
            ipAddress: "127.0.0.1",
            userAgent: "BrowserTest/1.0",
            consents: DEFAULT_SIGNUP_CONSENTS,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "DISPLAY_NAME_REQUIRED");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );

      // 2. Missing consents for new user fails with CONSENT_REQUIRED without consuming OTP
      await assert.rejects(
        async () => {
          await authService.verifyOtpAndLogin({
            email,
            otp: rawOtp,
            displayName: "Atharv Harde",
            ipAddress: "127.0.0.1",
            userAgent: "BrowserTest/1.0",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CONSENT_REQUIRED");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );

      // OTP challenge must still be PENDING and no user created
      const pendingChallenge = await OtpChallengeModel.findOne({ email }).lean();
      assert.equal(pendingChallenge?.status, "PENDING");
      const missingUser = await UserModel.findOne({ email }).lean();
      assert.equal(missingUser, null);

      // 3. Same OTP succeeds once valid displayName and consents are provided
      const signupRes = await authService.verifyOtpAndLogin({
        email,
        otp: rawOtp,
        displayName: "  Atharv   Harde  ",
        ipAddress: "127.0.0.1",
        userAgent: "BrowserTest/1.0",
        consents: DEFAULT_SIGNUP_CONSENTS,
      });

      assert.equal(signupRes.isNewUser, true);
      assert.equal(signupRes.user.displayName, "Atharv Harde");
      assert.equal(signupRes.user.userId, signupRes.user.id);
      assert.ok(signupRes.user.emailVerifiedAt);
      assert.ok(signupRes.user.termsAcceptedAt);
      assert.equal(signupRes.user.termsVersion, "1.0");
      assert.ok(signupRes.user.privacyAcceptedAt);
      assert.equal(signupRes.user.privacyVersion, "1.0");
      assert.ok(signupRes.user.simulationDisclosureAcceptedAt);

      const accounts = await PracticeAccountModel.find({
        userId: signupRes.user.id,
      }).lean();
      assert.equal(accounts.length, 1);

      // 4. Returning user authenticates with NO name and NO consents
      const t2 = new Date(Date.now() + 65_000);
      await otpService.requestOtp(email, "127.0.0.1", t2);
      const otp2 = mockEmailService.sentEmails[1].otp;
      const loginNoName = await authService.verifyOtpAndLogin({
        email,
        otp: otp2,
        ipAddress: "127.0.0.1",
        userAgent: "BrowserTest/1.0",
        now: t2,
      });

      assert.equal(loginNoName.isNewUser, false);
      assert.equal(loginNoName.user.id, signupRes.user.id);
      assert.equal(loginNoName.user.displayName, "Atharv Harde");

      // 5. Returning user submitting a DIFFERENT name must have it ignored; stored name is preserved
      const t3 = new Date(Date.now() + 130_000);
      await otpService.requestOtp(email, "127.0.0.1", t3);
      const otp3 = mockEmailService.sentEmails[2].otp;
      const loginDifferentName = await authService.verifyOtpAndLogin({
        email,
        otp: otp3,
        displayName: "Attempted Overwrite Name",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "BrowserTest/1.0",
        now: t3,
      });

      assert.equal(loginDifferentName.isNewUser, false);
      assert.equal(loginDifferentName.user.displayName, "Atharv Harde");

      const persistedUser = await UserModel.findById(signupRes.user.id).lean();
      assert.equal(persistedUser?.displayName, "Atharv Harde");

      const accountsAfter = await PracticeAccountModel.find({
        userId: signupRes.user.id,
      }).lean();
      assert.equal(accountsAfter.length, 1);
    });
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  clearDatabase,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { MockEmailService } from "../../modules/auth/email.service";
import { OtpService } from "../../modules/auth/otp.service";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthService } from "../../modules/auth/auth.service";
import { SessionModel } from "../../modules/auth/session.model";
import { RefreshTokenModel } from "../../modules/auth/refresh-token.model";
import { AuthError } from "../../modules/auth/auth.errors";
import { createAuthMiddleware } from "../../modules/auth/auth.middleware";
import { Request, Response } from "express";

describe("Task 24 — Refresh Token Rotation, Multi-Generation Reuse & Logout (Real Replica-Set Integration)", () => {
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

  describe("1. Refresh Token Rotation & Multi-Step Succession", () => {
    it("rotates refresh token sequentially across multiple generations", async () => {
      const email = "rotate.trader@nivora.test";

      // 1. Initial Login -> Generation 1
      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;
      const login = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Rotate Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const token1 = login.refreshToken;
      assert.ok(token1);

      // Verify token1 in DB is generation 1 and ACTIVE
      const t1Doc = await RefreshTokenModel.findOne({
        sessionId: login.session.id,
      })
        .select("+tokenHash")
        .lean();
      assert.ok(t1Doc);
      assert.equal(t1Doc.generation, 1);
      assert.equal(t1Doc.status, "ACTIVE");

      // 2. Rotate token 1 -> token 2 (Generation 2)
      const rot1 = await authService.rotateRefreshToken({
        rawRefreshToken: token1,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const token2 = rot1.newRefreshToken;
      assert.notEqual(token2, token1);

      // Verify token 1 is now ROTATED
      const t1Rotated = await RefreshTokenModel.findById(t1Doc._id).lean();
      assert.equal(t1Rotated?.status, "ROTATED");
      assert.ok(t1Rotated?.rotatedAt instanceof Date);

      // Verify token 2 is ACTIVE and generation 2
      const t2Doc = await RefreshTokenModel.findOne({
        sessionId: login.session.id,
        status: "ACTIVE",
      })
        .select("+tokenHash")
        .lean();
      assert.ok(t2Doc);
      assert.equal(t2Doc.generation, 2);

      // 3. Rotate token 2 -> token 3 (Generation 3)
      const rot2 = await authService.rotateRefreshToken({
        rawRefreshToken: token2,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const token3 = rot2.newRefreshToken;
      assert.notEqual(token3, token2);

      const t3Doc = await RefreshTokenModel.findOne({
        sessionId: login.session.id,
        status: "ACTIVE",
      })
        .select("+tokenHash")
        .lean();
      assert.ok(t3Doc);
      assert.equal(t3Doc.generation, 3);
    });
  });

  describe("2. Multi-Generation Token Reuse Detection", () => {
    it("detects reuse of an older token after multiple rotations, revoking the entire session family", async () => {
      const email = "reuse.detection@nivora.test";

      // Login -> Token 1
      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;
      const login = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Reuse Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const token1 = login.refreshToken;

      // Rotate: 1 -> 2
      const rot1 = await authService.rotateRefreshToken({
        rawRefreshToken: token1,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });
      const token2 = rot1.newRefreshToken;

      // Rotate: 2 -> 3
      const rot2 = await authService.rotateRefreshToken({
        rawRefreshToken: token2,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });
      const token3 = rot2.newRefreshToken;

      // Rotate: 3 -> 4
      const rot3 = await authService.rotateRefreshToken({
        rawRefreshToken: token3,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });
      const token4 = rot3.newRefreshToken;

      // At this point, tokens 1, 2, and 3 are ROTATED; token 4 is ACTIVE.
      // Now: An attacker presents older Token 1 (simulating stolen token replay)
      await assert.rejects(
        async () => {
          await authService.rotateRefreshToken({
            rawRefreshToken: token1,
            ipAddress: "192.168.1.99",
            userAgent: "AttackerBot/1.0",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "REFRESH_TOKEN_REUSE_DETECTED");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );

      // Verify Session is REVOKED with TOKEN_REUSE_DETECTED in database
      const sessionDoc = await SessionModel.findById(login.session.id).lean();
      assert.ok(sessionDoc);
      assert.equal(sessionDoc.status, "REVOKED");
      assert.equal(sessionDoc.revokedReason, "TOKEN_REUSE_DETECTED");

      // Verify all tokens in the family are marked REVOKED
      const activeTokensCount = await RefreshTokenModel.countDocuments({
        sessionId: login.session.id,
        status: "ACTIVE",
      });
      assert.equal(activeTokensCount, 0);

      // Even the latest legitimate Token 4 cannot be used anymore
      await assert.rejects(
        async () => {
          await authService.rotateRefreshToken({
            rawRefreshToken: token4,
            ipAddress: "127.0.0.1",
            userAgent: "Browser/1.0",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "SESSION_REVOKED");
          return true;
        }
      );

      // And any access token for this session fails middleware authentication
      const middleware = createAuthMiddleware(jwtService);
      let capturedStatus = 0;
      const req = {
        headers: {
          authorization: `Bearer ${rot3.accessToken}`,
        },
      } as unknown as Request;
      const res = {
        status: (code: number) => {
          capturedStatus = code;
          return { json: () => {} };
        },
      } as unknown as Response;

      await middleware(req, res, () => {
        assert.fail("Middleware should reject revoked session");
      });
      assert.equal(capturedStatus, 401);
    });

    it("rejects unknown random refresh token without revoking valid sessions", async () => {
      const email = "safe.user@nivora.test";

      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;
      const login = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Safe Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const unknownToken = "a".repeat(64); // Completely random fake token

      await assert.rejects(
        async () => {
          await authService.rotateRefreshToken({
            rawRefreshToken: unknownToken,
            ipAddress: "127.0.0.1",
            userAgent: "Browser/1.0",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "INVALID_REFRESH_TOKEN");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );

      // The legitimate user's session remains untouched and ACTIVE
      const sessionDoc = await SessionModel.findById(login.session.id).lean();
      assert.equal(sessionDoc?.status, "ACTIVE");
    });
  });

  describe("3. Refresh Concurrency Protection", () => {
    it("handles two simultaneous refresh requests: exactly one succeeds", async () => {
      const email = "concurrency.refresh@nivora.test";

      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;
      const login = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Concurrency Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      const rawToken = login.refreshToken;

      // Simultaneous requests using same active refresh token
      const results = await Promise.allSettled([
        authService.rotateRefreshToken({
          rawRefreshToken: rawToken,
          ipAddress: "127.0.0.1",
          userAgent: "TabA/1.0",
        }),
        authService.rotateRefreshToken({
          rawRefreshToken: rawToken,
          ipAddress: "127.0.0.1",
          userAgent: "TabB/1.0",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly ONE rotation must succeed
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);

      // Exactly ONE active refresh token exists in DB for this session
      const activeCount = await RefreshTokenModel.countDocuments({
        sessionId: login.session.id,
        status: "ACTIVE",
      });
      assert.equal(activeCount, 1);
    });
  });

  describe("4. Logout, Logout-All & Device Management", () => {
    it("logs out current session and revokes refresh token family", async () => {
      const email = "logout.test@nivora.test";

      await otpService.requestOtp(email, "127.0.0.1");
      const otp = mockEmailService.sentEmails[0].otp;
      const login = await authService.verifyOtpAndLogin({
        email,
        otp,
        displayName: "Logout Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "127.0.0.1",
        userAgent: "Browser/1.0",
      });

      await authService.logoutCurrentSession({
        sessionId: login.session.id,
      });

      const sessionDoc = await SessionModel.findById(login.session.id).lean();
      assert.equal(sessionDoc?.status, "REVOKED");
      assert.equal(sessionDoc?.revokedReason, "USER_LOGOUT");

      // Token rotation with the old token fails
      await assert.rejects(async () => {
        await authService.rotateRefreshToken({
          rawRefreshToken: login.refreshToken,
          ipAddress: "127.0.0.1",
          userAgent: "Browser/1.0",
        });
      });
    });

    it("logs out all sessions for the user across multiple devices", async () => {
      const email = "logoutall.test@nivora.test";

      // Device 1
      await otpService.requestOtp(email, "10.0.0.1");
      const otp1 = mockEmailService.sentEmails[0].otp;
      const login1 = await authService.verifyOtpAndLogin({
        email,
        otp: otp1,
        displayName: "Logout All Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "10.0.0.1",
        userAgent: "Device1",
      });

      // Device 2
      const t2 = new Date(Date.now() + 65_000);
      await otpService.requestOtp(email, "10.0.0.2", t2);
      const otp2 = mockEmailService.sentEmails[1].otp;
      const login2 = await authService.verifyOtpAndLogin({
        email,
        otp: otp2,
        ipAddress: "10.0.0.2",
        userAgent: "Device2",
        now: t2,
      });

      // Logout All
      await authService.logoutAllSessions(login1.user.id);

      // Both sessions must be REVOKED with reason LOGOUT_ALL
      const sessions = await SessionModel.find({
        userId: login1.user.id,
      }).lean();
      assert.equal(sessions.length, 2);
      for (const s of sessions) {
        assert.equal(s.status, "REVOKED");
        assert.equal(s.revokedReason, "LOGOUT_ALL");
      }
    });

    it("lists user sessions and revokes individual session enforcing ownership", async () => {
      const email = "devices.test@nivora.test";

      await otpService.requestOtp(email, "10.0.0.1");
      const otp1 = mockEmailService.sentEmails[0].otp;
      const login1 = await authService.verifyOtpAndLogin({
        email,
        otp: otp1,
        displayName: "Devices Trader",
        consents: DEFAULT_SIGNUP_CONSENTS,
        ipAddress: "10.0.0.1",
        userAgent: "Device1",
      });

      const t2 = new Date(Date.now() + 65_000);
      await otpService.requestOtp(email, "10.0.0.2", t2);
      const otp2 = mockEmailService.sentEmails[1].otp;
      const login2 = await authService.verifyOtpAndLogin({
        email,
        otp: otp2,
        ipAddress: "10.0.0.2",
        userAgent: "Device2",
        now: t2,
      });

      // List sessions
      const userSessions = await authService.getUserSessions(login1.user.id);
      assert.equal(userSessions.length, 2);
      // Ensure token hashes are never exposed in session listing
      for (const s of userSessions) {
        assert.equal(s.currentRefreshTokenHash, undefined);
        assert.equal(s.previousRefreshTokenHash, undefined);
      }

      // Revoke session 1 specifically
      await authService.revokeUserSession({
        userId: login1.user.id,
        sessionId: login1.session.id,
      });

      const s1 = await SessionModel.findById(login1.session.id).lean();
      assert.equal(s1?.status, "REVOKED");

      // Session 2 is still ACTIVE
      const s2 = await SessionModel.findById(login2.session.id).lean();
      assert.equal(s2?.status, "ACTIVE");

      // Attempting to revoke session with a different userId fails
      await assert.rejects(
        async () => {
          await authService.revokeUserSession({
            userId: "507f1f77bcf86cd799439099",
            sessionId: login2.session.id,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "SESSION_REVOKED");
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    });
  });
});

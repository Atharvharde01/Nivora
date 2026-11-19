import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  clearDatabase,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { createApp } from "../../app";
import { createAppRouter } from "../../routes";
import { MockEmailService } from "../../modules/auth/email.service";
import { OtpService } from "../../modules/auth/otp.service";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthService } from "../../modules/auth/auth.service";
import { AuthController } from "../../modules/auth/auth.controller";
import { UserModel } from "../../modules/users/user.model";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import { OtpChallengeModel } from "../../modules/auth/otp-challenge.model";

const ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

const FULL_CONSENTS = {
  acceptTerms: true,
  acceptPrivacy: true,
  acceptSimulationDisclosure: true,
  termsVersion: "1.0",
  privacyVersion: "1.0",
};

function parseCookiesFromResponse(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieHeaders =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : res.headers.get("set-cookie")
      ? [res.headers.get("set-cookie") as string]
      : [];

  for (const header of setCookieHeaders) {
    const firstPart = header.split(";")[0]?.trim();
    if (!firstPart) continue;
    const eqIndex = firstPart.indexOf("=");
    if (eqIndex > 0) {
      const name = firstPart.slice(0, eqIndex).trim();
      const val = firstPart.slice(eqIndex + 1).trim();
      cookies[name] = val;
    }
  }
  return cookies;
}

describe("Phase 6.1 Revision — Unified Email OTP & Profile Display Name Management (HTTP Integration)", () => {
  const TEST_HMAC_SECRET =
    "phase61_rev_otp_hmac_secret_key_minimum_32_characters_long";
  const TEST_JWT_SECRET =
    "phase61_rev_jwt_access_secret_key_minimum_32_characters_long";

  let server: http.Server;
  let baseUrl: string;
  let mockEmailService: MockEmailService;
  let otpService: OtpService;
  let jwtService: JwtService;
  let authService: AuthService;

  before(async () => {
    await setupIntegrationTestDb();
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await clearDatabase();

    mockEmailService = new MockEmailService();
    otpService = new OtpService({
      hmacSecret: TEST_HMAC_SECRET,
      emailService: mockEmailService,
      resendCooldownMs: 1_000,
    });
    jwtService = new JwtService({ accessSecret: TEST_JWT_SECRET });
    authService = new AuthService({ otpService, jwtService });
    const authController = new AuthController({
      otpService,
      authService,
      cookieConfig: { isProduction: false },
      allowedOrigins: ALLOWED_ORIGINS,
    });

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      jwtService,
    });

    const app = createApp({
      isProduction: false,
      allowedOrigins: ALLOWED_ORIGINS,
      router,
      enableSwagger: false,
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  it("returns identical generic OTP request response for new and existing emails", async () => {
    const existingEmail = "existing.user@nivora.test";
    await new UserModel({
      email: existingEmail,
      displayName: "Existing User",
      status: "ACTIVE",
      onboardingCompleted: true,
    }).save();

    const newRes = await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "brand.new@nivora.test" }),
    });
    assert.equal(newRes.status, 200);
    const newJson = await newRes.json();

    const existingRes = await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: existingEmail }),
    });
    assert.equal(existingRes.status, 200);
    const existingJson = await existingRes.json();

    assert.equal(newJson.success, true);
    assert.equal(existingJson.success, true);
    assert.equal(newJson.message, existingJson.message);
    assert.equal(newJson.resendCooldownSeconds, existingJson.resendCooldownSeconds);
  });

  it("rejects deprecated flow parameter via strict schema and auto-detects new vs existing accounts", async () => {
    const email = "atharv.unified@nivora.test";

    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const otp1 = mockEmailService.sentEmails[0].otp;

    // 1. Legacy frontend `flow` field is rejected by strict validation
    const flowRejected = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        otp: otp1,
        flow: "signup",
        displayName: "Atharv Harde",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(flowRejected.status, 400);

    // 2. Missing name for new user fails with DISPLAY_NAME_REQUIRED and does NOT consume OTP
    const missingNameRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        otp: otp1,
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(missingNameRes.status, 400);
    const missingNameJson = await missingNameRes.json();
    assert.equal(missingNameJson.error.code, "DISPLAY_NAME_REQUIRED");

    const challengeStillPending = await OtpChallengeModel.findOne({ email }).lean();
    assert.equal(challengeStillPending?.status, "PENDING");

    // 3. Invalid name (email address or control char) rejected without consuming OTP
    const badNameRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        otp: otp1,
        displayName: "atharv@example.com",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(badNameRes.status, 400);
    const badNameJson = await badNameRes.json();
    assert.equal(badNameJson.error.code, "INVALID_DISPLAY_NAME");

    // 4. Same OTP still succeeds with valid Unicode/trimmed displayName + consents
    const createRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email,
        otp: otp1,
        displayName: "  Atharv   Harde  ",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(createRes.status, 200);
    const createJson = await createRes.json();
    assert.equal(createJson.success, true);
    assert.equal(createJson.isNewUser, true);
    assert.equal(createJson.user.displayName, "Atharv Harde");
    assert.equal(createJson.user.userId, createJson.user.id);
    assert.ok(createJson.user.emailVerifiedAt);

    // Exactly one default PracticeAccount exists
    const accountsAfterSignup = await PracticeAccountModel.countDocuments({
      userId: createJson.user.id,
    });
    assert.equal(accountsAfterSignup, 1);

    // 5. Refresh returns persisted displayName
    const cookies = parseCookiesFromResponse(createRes);
    assert.ok(cookies["refresh_token"]);
    assert.ok(cookies["XSRF-TOKEN"]);

    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3001",
        "X-CSRF-Token": cookies["XSRF-TOKEN"],
        Cookie: `refresh_token=${cookies["refresh_token"]}; XSRF-TOKEN=${cookies["XSRF-TOKEN"]}`,
      },
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.equal(refreshJson.user.displayName, "Atharv Harde");
    assert.ok(refreshJson.user.emailVerifiedAt);

    // 6. Simulate existing trading activity (mutated cash balance) before returning-user auth
    await PracticeAccountModel.updateOne(
      { userId: createJson.user.id },
      { $set: { cashBalancePaise: 87_500_000 } }
    );

    // Returning user with NO name and NO consents succeeds
    await new Promise((r) => setTimeout(r, 1100));
    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const otp2 = mockEmailService.sentEmails[1].otp;

    const returningNoNameRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp: otp2 }),
    });
    assert.equal(returningNoNameRes.status, 200);
    const returningNoNameJson = await returningNoNameRes.json();
    assert.equal(returningNoNameJson.isNewUser, false);
    assert.equal(returningNoNameJson.user.displayName, "Atharv Harde");

    // 7. Returning user submitting a DIFFERENT name must preserve stored name AND practice account balance
    await new Promise((r) => setTimeout(r, 1100));
    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const otp3 = mockEmailService.sentEmails[2].otp;

    const returningDifferentNameRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        otp: otp3,
        displayName: "Hacker Overwrite",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(returningDifferentNameRes.status, 200);
    const returningDifferentNameJson = await returningDifferentNameRes.json();
    assert.equal(returningDifferentNameJson.isNewUser, false);
    assert.equal(returningDifferentNameJson.user.displayName, "Atharv Harde");

    // Still exactly 1 user and 1 PracticeAccount with mutated balance preserved
    assert.equal(await UserModel.countDocuments({ email }), 1);
    const accountsFinal = await PracticeAccountModel.find({
      userId: createJson.user.id,
    }).lean();
    assert.equal(accountsFinal.length, 1);
    assert.equal(accountsFinal[0].cashBalancePaise, 87_500_000);
  });

  it("prevents duplicate users and duplicate practice accounts under concurrent OTP verification", async () => {
    const email = "concurrent.signup@nivora.test";
    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const otp = mockEmailService.sentEmails[0].otp;

    const payload = JSON.stringify({
      email,
      otp,
      displayName: "Concurrent Trader",
      consents: FULL_CONSENTS,
    });

    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }),
      fetch(`${baseUrl}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    // Exactly one succeeds (200) and the concurrent duplicate fails (409 or 404)
    assert.equal(statuses[0], 200);
    assert.ok(statuses[1] === 409 || statuses[1] === 404);

    assert.equal(await UserModel.countDocuments({ email }), 1);
    const userDoc = await UserModel.findOne({ email }).lean();
    assert.ok(userDoc);
    assert.equal(
      await PracticeAccountModel.countDocuments({ userId: userDoc._id }),
      1
    );
  });

  it("PATCH /api/v1/users/me/profile updates displayName, rejects invalid/immutable fields, and isolates users", async () => {
    // Provision User A and User B
    const emailA = "user.a@nivora.test";
    const emailB = "user.b@nivora.test";

    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA }),
    });
    const otpA = mockEmailService.sentEmails[0].otp;
    const verifyA = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        otp: otpA,
        displayName: "User Alpha",
        consents: FULL_CONSENTS,
      }),
    });
    const dataA = await verifyA.json();
    const cookiesA = parseCookiesFromResponse(verifyA);

    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailB }),
    });
    const otpB = mockEmailService.sentEmails[1].otp;
    const verifyB = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailB,
        otp: otpB,
        displayName: "User Beta",
        consents: FULL_CONSENTS,
      }),
    });
    const dataB = await verifyB.json();

    // 1. Unauthenticated request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Fail" }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Rejects invalid names: empty, control chars, >50 chars, email-as-name
    const invalidNames = [
      "",
      "   ",
      "A",
      "A".repeat(51),
      "Atharv\nHarde",
      "Atharv\x00Harde",
      "<script>alert(1)</script>",
      "atharv@example.com",
      "123456",
    ];
    for (const badName of invalidNames) {
      const badRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${dataA.accessToken}`,
        },
        body: JSON.stringify({ displayName: badName }),
      });
      assert.equal(
        badRes.status,
        400,
        `Expected 400 for invalid displayName: ${JSON.stringify(badName)}`
      );
    }

    // 3. Rejects attempts to pass userId, email, status, or verification/consent fields
    const idorAttemptRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dataA.accessToken}`,
      },
      body: JSON.stringify({
        userId: dataB.user.id,
        displayName: "Pwned Beta",
      }),
    });
    assert.equal(idorAttemptRes.status, 400);

    const emailTamperRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dataA.accessToken}`,
      },
      body: JSON.stringify({
        displayName: "Valid Name",
        email: "newemail@nivora.test",
      }),
    });
    assert.equal(emailTamperRes.status, 400);

    // User B remains completely untouched
    const userBAfterIdor = await UserModel.findById(dataB.user.id).lean();
    assert.equal(userBAfterIdor?.displayName, "User Beta");

    // 4. Valid Unicode trimmed displayName update persists and propagates to GET /auth/me & POST /auth/refresh
    const patchRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dataA.accessToken}`,
      },
      body: JSON.stringify({ displayName: "  José   García  " }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.success, true);
    assert.equal(patchJson.data.user.displayName, "José García");
    assert.equal(patchJson.data.user.email, emailA);

    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${dataA.accessToken}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.displayName, "José García");

    const refreshAfterUpdate = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3001",
        "X-CSRF-Token": cookiesA["XSRF-TOKEN"],
        Cookie: `refresh_token=${cookiesA["refresh_token"]}; XSRF-TOKEN=${cookiesA["XSRF-TOKEN"]}`,
      },
    });
    assert.equal(refreshAfterUpdate.status, 200);
    const refreshJson = await refreshAfterUpdate.json();
    assert.equal(refreshJson.user.displayName, "José García");

    // User B is still untouched
    const userBFinal = await UserModel.findById(dataB.user.id).lean();
    assert.equal(userBFinal?.displayName, "User Beta");
  });

  it("safely authenticates legacy users without displayName and lets them set one via profile endpoint", async () => {
    const legacyEmail = "legacy.user@nivora.test";
    const legacyUser = await new UserModel({
      email: legacyEmail,
      status: "ACTIVE",
      onboardingCompleted: true,
    }).save();

    await fetch(`${baseUrl}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: legacyEmail }),
    });
    const otp = mockEmailService.sentEmails[0].otp;

    // Authenticate without name -> does not overwrite legacy record
    const loginRes = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: legacyEmail, otp }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.equal(loginJson.isNewUser, false);
    assert.equal(loginJson.user.id, legacyUser._id.toString());
    assert.equal(loginJson.user.displayName, undefined);

    // Legacy user sets displayName through profile endpoint
    const patchRes = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${loginJson.accessToken}`,
      },
      body: JSON.stringify({ displayName: "Atharv Harde" }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.data.user.displayName, "Atharv Harde");
  });

  it("backfills displayName once for a legacy user with no stored name when signing in with a valid name, then never overwrites it", async () => {
    const legacyEmail = "legacy.backfill@nivora.test";
    const legacyUser = await new UserModel({
      email: legacyEmail,
      status: "ACTIVE",
      onboardingCompleted: false,
    }).save();

    await otpService.requestOtp(legacyEmail, "10.0.0.11");
    const otp1 = mockEmailService.sentEmails[0].otp;

    const firstLogin = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: legacyEmail,
        otp: otp1,
        displayName: "  Atharv Harde  ",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(firstLogin.status, 200);
    const firstJson = await firstLogin.json();
    assert.equal(firstJson.isNewUser, false);
    assert.equal(firstJson.user.id, legacyUser._id.toString());
    assert.equal(firstJson.user.displayName, "Atharv Harde");

    // Subsequent login with a different name must preserve "Atharv Harde"
    const t2 = new Date(Date.now() + 2_000);
    await otpService.requestOtp(legacyEmail, "10.0.0.12", t2);
    const otp2 = mockEmailService.sentEmails[1].otp;

    const secondLogin = await fetch(`${baseUrl}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: legacyEmail,
        otp: otp2,
        displayName: "New Attempted Name",
        consents: FULL_CONSENTS,
      }),
    });
    assert.equal(secondLogin.status, 200);
    const secondJson = await secondLogin.json();
    assert.equal(secondJson.user.displayName, "Atharv Harde");
  });
});

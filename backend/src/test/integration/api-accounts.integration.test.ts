import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import http from "node:http";
import { Types } from "mongoose";
import { createApp } from "../../app";
import { createAppRouter } from "../../routes";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthController } from "../../modules/auth/auth.controller";
import { OtpService } from "../../modules/auth/otp.service";
import { AuthService } from "../../modules/auth/auth.service";
import { MockEmailService } from "../../modules/auth/email.service";
import { SessionModel } from "../../modules/auth/session.model";
import { PracticeAccountService } from "../../modules/practice-accounts/account.service";
import { AccountController } from "../../modules/practice-accounts/account.controller";
import {
  clearDatabase,
  createTestAccount,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

describe("Task 28 — Practice Account REST APIs (Real Replica-Set Integration)", () => {
  const TEST_JWT_SECRET =
    "integration_test_jwt_access_secret_key_minimum_32_characters";
  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;
  let authToken: string;
  let testUserId: Types.ObjectId;
  let testAccountId: Types.ObjectId;
  let otherAuthToken: string;
  let otherUserId: Types.ObjectId;

  before(async () => {
    await setupIntegrationTestDb();

    jwtService = new JwtService({
      accessSecret: TEST_JWT_SECRET,
    });
    const otpService = new OtpService({
      hmacSecret: "test_hmac_secret_key_minimum_32_characters",
      emailService: new MockEmailService(),
    });
    const authService = new AuthService({ otpService, jwtService });
    const authController = new AuthController({
      otpService,
      authService,
      cookieConfig: { isProduction: false },
      allowedOrigins: ["http://localhost:3000"],
    });

    const practiceAccountService = new PracticeAccountService();
    const accountController = new AccountController({
      practiceAccountService,
    });

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      accountController,
    });

    const app = createApp({
      isProduction: false,
      allowedOrigins: ["http://localhost:3000"],
      router,
    });

    server = app.listen(0);
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error("Failed to bind test server.");
    }
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();

    // 1. Primary user + account #1
    const user = await createTestUser();
    testUserId = user._id;
    const account = await createTestAccount(testUserId);
    testAccountId = account._id;

    const session = new SessionModel({
      userId: user._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "AccountIntegrationTest/1.0",
      currentRefreshTokenHash: "1".repeat(64),
      idleExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(),
    });
    await session.save();

    authToken = jwtService.generateAccessToken({
      userId: user._id.toString(),
      sessionId: session._id.toString(),
    });

    // 2. Secondary user
    const otherUser = await createTestUser();
    otherUserId = otherUser._id;
    await createTestAccount(otherUserId);

    const otherSession = new SessionModel({
      userId: otherUser._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "AccountIntegrationTest/1.0",
      currentRefreshTokenHash: "2".repeat(64),
      idleExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(),
    });
    await otherSession.save();

    otherAuthToken = jwtService.generateAccessToken({
      userId: otherUser._id.toString(),
      sessionId: otherSession._id.toString(),
    });
  });

  describe("1. Authentication Enforcement", () => {
    it("rejects unauthenticated requests to account endpoints with 401", async () => {
      const activeRes = await fetch(`${baseUrl}/api/v1/accounts/active`);
      assert.equal(activeRes.status, 401);

      const listRes = await fetch(`${baseUrl}/api/v1/accounts`);
      assert.equal(listRes.status, 401);

      const resetRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
      });
      assert.equal(resetRes.status, 401);
    });
  });

  describe("2. Account Details, Cash Balance & Ledger Retrieval", () => {
    it("retrieves active account details, cash balance, and immutable initial funding ledger", async () => {
      // 1. GET /api/v1/accounts/active
      const activeRes = await fetch(`${baseUrl}/api/v1/accounts/active`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(activeRes.status, 200);
      const activeJson = await activeRes.json();
      assert.equal(activeJson.success, true);
      assert.equal(activeJson.data.account.accountNumber, 1);
      assert.equal(activeJson.data.account.status, "ACTIVE");
      assert.equal(activeJson.data.account.initialBalancePaise, 100_000_000);
      assert.equal(activeJson.data.account.cashBalancePaise, 100_000_000);

      // 2. GET /api/v1/accounts
      const listRes = await fetch(`${baseUrl}/api/v1/accounts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      assert.equal(listJson.data.pagination.total, 1);
      assert.equal(listJson.data.items[0]._id, testAccountId.toString());

      // 3. GET /api/v1/accounts/:accountId/balance
      const balRes = await fetch(
        `${baseUrl}/api/v1/accounts/${testAccountId.toString()}/balance`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      assert.equal(balRes.status, 200);
      const balJson = await balRes.json();
      assert.equal(balJson.data.balance.cashBalancePaise, 100_000_000);
      assert.equal(balJson.data.balance.status, "ACTIVE");

      // 4. GET /api/v1/accounts/:accountId/ledger
      const ledgerRes = await fetch(
        `${baseUrl}/api/v1/accounts/${testAccountId.toString()}/ledger`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      assert.equal(ledgerRes.status, 200);
      const ledgerJson = await ledgerRes.json();
      assert.equal(ledgerJson.data.pagination.total, 1);
      assert.equal(ledgerJson.data.items[0].entryType, "INITIAL_FUNDING");
      assert.equal(ledgerJson.data.items[0].direction, "CREDIT");
      assert.equal(ledgerJson.data.items[0].amountPaise, 100_000_000);
      assert.equal(ledgerJson.data.items[0].balanceBeforePaise, 0);
      assert.equal(ledgerJson.data.items[0].balanceAfterPaise, 100_000_000);
    });

    it("prevents secondary user from accessing User 1's account details and ledger with 403", async () => {
      const foreignAccountRes = await fetch(
        `${baseUrl}/api/v1/accounts/${testAccountId.toString()}`,
        { headers: { Authorization: `Bearer ${otherAuthToken}` } }
      );
      assert.equal(foreignAccountRes.status, 403);
      const foreignAccountJson = await foreignAccountRes.json();
      assert.equal(
        foreignAccountJson.error.code,
        "ACCOUNT_OWNERSHIP_VIOLATION"
      );

      const foreignLedgerRes = await fetch(
        `${baseUrl}/api/v1/accounts/${testAccountId.toString()}/ledger`,
        { headers: { Authorization: `Bearer ${otherAuthToken}` } }
      );
      assert.equal(foreignLedgerRes.status, 403);
      const foreignLedgerJson = await foreignLedgerRes.json();
      assert.equal(
        foreignLedgerJson.error.code,
        "ACCOUNT_OWNERSHIP_VIOLATION"
      );
    });
  });

  describe("3. Safe Account Reset Lifecycle & Durable Idempotency", () => {
    it("rejects reset without confirmation or with stale expectedActiveAccountId", async () => {
      // 1. Missing header
      const noHeaderRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: testAccountId.toString(),
        }),
      });
      assert.equal(noHeaderRes.status, 400);
      const noHeaderJson = await noHeaderRes.json();
      assert.equal(noHeaderJson.error.code, "INVALID_IDEMPOTENCY_KEY");

      // 2. Missing or incorrect confirmation
      const badConfRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "reset-test-key-00123",
        },
        body: JSON.stringify({
          confirmation: "YES_RESET",
          expectedActiveAccountId: testAccountId.toString(),
        }),
      });
      assert.equal(badConfRes.status, 400);
      const badConfJson = await badConfRes.json();
      assert.equal(badConfJson.error.code, "CONFIRMATION_REQUIRED");

      // 3. Stale expectedActiveAccountId
      const staleId = new Types.ObjectId().toString();
      const staleRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "reset-test-key-00123",
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: staleId,
        }),
      });
      assert.equal(staleRes.status, 409);
      const staleJson = await staleRes.json();
      assert.equal(staleJson.error.code, "STALE_ACCOUNT_ID");
    });

    it("resets account atomically, archives previous account, provisions new account #2, and replays idempotently", async () => {
      const idempotencyKey = "reset-practice-account-idemp-001";

      // 1. First Reset Call
      const resetRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: testAccountId.toString(),
        }),
      });

      assert.equal(resetRes.status, 201);
      const resetJson = await resetRes.json();
      assert.equal(resetJson.success, true);
      assert.equal(resetJson.data.wasIdempotentReplay, false);
      assert.equal(resetJson.data.archivedAccount.accountId, testAccountId.toString());
      assert.equal(resetJson.data.archivedAccount.status, "ARCHIVED");
      assert.equal(resetJson.data.activeAccount.accountNumber, 2);
      assert.equal(resetJson.data.activeAccount.status, "ACTIVE");
      assert.equal(resetJson.data.activeAccount.cashBalancePaise, 100_000_000);
      assert.equal(resetJson.data.initialFundingLedgerEntry.amountPaise, 100_000_000);

      const newActiveAccountId = resetJson.data.activeAccount.accountId;

      // 2. Idempotent Replay with same key
      const replayRes = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: testAccountId.toString(),
        }),
      });

      assert.equal(replayRes.status, 200);
      const replayJson = await replayRes.json();
      assert.equal(replayJson.success, true);
      assert.equal(replayJson.data.wasIdempotentReplay, true);
      assert.equal(replayJson.data.activeAccount._id, newActiveAccountId);
      assert.equal(replayJson.data.activeAccount.accountNumber, 2);

      // 3. Verify total accounts for user is exactly 2 (account #1 ARCHIVED, account #2 ACTIVE)
      const listRes = await fetch(`${baseUrl}/api/v1/accounts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const listJson = await listRes.json();
      assert.equal(listJson.data.pagination.total, 2);
      assert.equal(listJson.data.items[0].accountNumber, 2);
      assert.equal(listJson.data.items[0].status, "ACTIVE");
      assert.equal(listJson.data.items[1].accountNumber, 1);
      assert.equal(listJson.data.items[1].status, "ARCHIVED");
    });
  });
});

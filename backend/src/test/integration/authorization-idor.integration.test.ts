import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import { Router } from "express";
import { Types } from "mongoose";
import { createApp } from "../../app";
import { createAppRouter } from "../../routes";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthController } from "../../modules/auth/auth.controller";
import { OtpService } from "../../modules/auth/otp.service";
import { AuthService } from "../../modules/auth/auth.service";
import { MockEmailService } from "../../modules/auth/email.service";
import { SessionModel } from "../../modules/auth/session.model";
import { UserModel } from "../../modules/users/user.model";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { InstrumentController } from "../../modules/instruments/instrument.controller";
import { WatchlistService } from "../../modules/watchlist/watchlist.service";
import { WatchlistController } from "../../modules/watchlist/watchlist.controller";
import { WatchlistItemModel } from "../../modules/watchlist/watchlist.model";
import { PracticeAccountService } from "../../modules/practice-accounts/account.service";
import { AccountController } from "../../modules/practice-accounts/account.controller";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { OrderController } from "../../modules/orders/order.controller";
import { PortfolioService } from "../../modules/portfolio/portfolio.service";
import { PortfolioController } from "../../modules/portfolio/portfolio.controller";
import { TradeController } from "../../modules/trades/trade.controller";
import {
  clearDatabase,
  createTestAccount,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { AppError } from "../../shared/errors";

describe("Task 31 — Authorization, IDOR Protection & Centralized Errors (Integration)", () => {
  const TEST_JWT_SECRET =
    "test_jwt_secret_min_32_characters_for_task_31_tests";
  const ALLOWED_ORIGIN = "http://localhost:3000";

  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;

  let userAId: Types.ObjectId;
  let userBId: Types.ObjectId;
  let userAToken: string;
  let userBToken: string;
  let userASessionId: Types.ObjectId;
  let userBSessionId: Types.ObjectId;

  let userAAccountId: string;
  let userBAccountId: string;
  let instrumentId1: string;

  before(async () => {
    await setupIntegrationTestDb();

    jwtService = new JwtService({ accessSecret: TEST_JWT_SECRET });
    const otpService = new OtpService({
      hmacSecret: "test_hmac_secret_key_minimum_32_characters",
      emailService: new MockEmailService(),
    });
    const authService = new AuthService({ otpService, jwtService });
    const authController = new AuthController({
      otpService,
      authService,
      cookieConfig: { isProduction: false },
      allowedOrigins: [ALLOWED_ORIGIN],
    });

    const quoteService = new InstrumentQuoteService();
    const instrumentController = new InstrumentController({ quoteService });
    const watchlistService = new WatchlistService({ quoteService });
    const watchlistController = new WatchlistController({ watchlistService });
    const practiceAccountService = new PracticeAccountService();
    const accountController = new AccountController({ practiceAccountService });
    const orderExecutionService = new OrderExecutionService({ quoteService });
    const orderController = new OrderController({
      orderExecutionService,
      practiceAccountService,
    });
    const portfolioService = new PortfolioService({
      quoteService,
      accountService: practiceAccountService,
    });
    const portfolioController = new PortfolioController({ portfolioService });
    const tradeController = new TradeController();

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      instrumentController,
      watchlistController,
      orderController,
      portfolioController,
      tradeController,
      accountController,
    });

    const app = createApp({
      isProduction: false,
      allowedOrigins: [ALLOWED_ORIGIN],
      router,
    });

    server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Addr failed");
    baseUrl = `http://127.0.0.1:${addr.port}`;

    await clearDatabase();

    // 1. Create User A (Alice)
    const userA = await createTestUser({ email: "alice@nivora.in" });
    userAId = userA._id;
    const accountA = await createTestAccount(userAId);
    userAAccountId = accountA._id.toString();

    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);

    const now = new Date();
    const sessionA = new SessionModel({
      userId: userAId,
      currentRefreshTokenHash: hashA,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent",
      status: "ACTIVE",
      createdAt: now,
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    await sessionA.save();
    userASessionId = sessionA._id;
    userAToken = jwtService.generateAccessToken({
      userId: userAId.toString(),
      sessionId: userASessionId.toString(),
    });

    // 2. Create User B (Bob)
    const userB = await createTestUser({ email: "bob@nivora.in" });
    userBId = userB._id;
    const accountB = await createTestAccount(userBId);
    userBAccountId = accountB._id.toString();

    const sessionB = new SessionModel({
      userId: userBId,
      currentRefreshTokenHash: hashB,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent",
      status: "ACTIVE",
      createdAt: now,
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    await sessionB.save();
    userBSessionId = sessionB._id;
    userBToken = jwtService.generateAccessToken({
      userId: userBId.toString(),
      sessionId: userBSessionId.toString(),
    });

    // 3. Create test instrument
    const inst = await createTestInstrument({
      symbol: "RELIANCE",
      name: "Reliance Industries Ltd",
      lastPricePaise: 290000,
    });
    instrumentId1 = inst._id.toString();
  });

  after(async () => {
    server?.close();
    await teardownIntegrationTestDb();
  });

  describe("1. Multi-Tenant IDOR Protection Across Endpoints", () => {
    it("User B cannot read User A's practice account details with 403 ACCOUNT_OWNERSHIP_VIOLATION", async () => {
      const res = await fetch(`${baseUrl}/api/v1/accounts/${userAAccountId}`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error.code, "ACCOUNT_OWNERSHIP_VIOLATION");
      assert.ok(data.error.requestId);
    });

    it("User B cannot read User A's practice account cash balance with 403", async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/accounts/${userAAccountId}/balance`,
        { headers: { Authorization: `Bearer ${userBToken}` } }
      );
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error.code, "ACCOUNT_OWNERSHIP_VIOLATION");
    });

    it("User B cannot read User A's practice account cash ledger with 403", async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/accounts/${userAAccountId}/ledger`,
        { headers: { Authorization: `Bearer ${userBToken}` } }
      );
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error.code, "ACCOUNT_OWNERSHIP_VIOLATION");
    });

    it("User B cannot read User A's order by ID (ownership isolation returns 404)", async () => {
      // Alice submits an order
      const orderRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-order-task31-test-1",
        },
        body: JSON.stringify({
          instrumentId: instrumentId1,
          side: "BUY",
          quantity: 10,
        }),
      });
      assert.equal(orderRes.status, 201);
      const orderData = await orderRes.json();
      const aliceOrderId = orderData.data.order._id;
      const aliceTradeId = orderData.data.trade._id;

      // Bob tries to read Alice's order
      const bobOrderRes = await fetch(
        `${baseUrl}/api/v1/orders/${aliceOrderId}`,
        { headers: { Authorization: `Bearer ${userBToken}` } }
      );
      assert.equal(bobOrderRes.status, 404);
      const bobOrderData = await bobOrderRes.json();
      assert.equal(bobOrderData.error.code, "ORDER_NOT_FOUND");

      // Bob tries to read Alice's trade
      const bobTradeRes = await fetch(
        `${baseUrl}/api/v1/trades/${aliceTradeId}`,
        { headers: { Authorization: `Bearer ${userBToken}` } }
      );
      assert.equal(bobTradeRes.status, 404);
      const bobTradeData = await bobTradeRes.json();
      assert.equal(bobTradeData.error.code, "TRADE_NOT_FOUND");
    });

    it("User B cannot revoke User A's active session with 403 or 404", async () => {
      const res = await fetch(
        `${baseUrl}/auth/sessions/${userASessionId.toString()}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userBToken}` },
        }
      );
      assert.ok(res.status === 403 || res.status === 404);
      const sessionInDb = await SessionModel.findById(userASessionId);
      assert.equal(sessionInDb?.status, "ACTIVE");
    });

    it("User B cannot delete User A's watchlist items", async () => {
      // Add instrument to Alice's watchlist via API
      const addRes = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: instrumentId1 }),
      });
      assert.equal(addRes.status, 201);

      // Bob attempts to remove it using his auth token
      const res = await fetch(
        `${baseUrl}/api/v1/watchlist/items/${instrumentId1}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userBToken}` },
        }
      );
      // Bob doesn't have it in his watchlist, so returns 404
      assert.equal(res.status, 404);

      // Alice's item is still in DB
      const item = await WatchlistItemModel.findOne({
        userId: userAId,
        instrumentId: new Types.ObjectId(instrumentId1),
      });
      assert.ok(item !== null);
    });
  });

  describe("2. User Account Status Enforcement (Suspended Users)", () => {
    it("rejects suspended users with 403 USER_SUSPENDED on protected routes", async () => {
      // Suspend User B
      await UserModel.updateOne(
        { _id: userBId },
        { $set: { status: "SUSPENDED" } }
      );

      try {
        const res = await fetch(`${baseUrl}/api/v1/accounts/active`, {
          headers: { Authorization: `Bearer ${userBToken}` },
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, "USER_SUSPENDED");
      } finally {
        // Restore User B
        await UserModel.updateOne(
          { _id: userBId },
          { $set: { status: "ACTIVE" } }
        );
      }
    });
  });

  describe("3. Centralized Error Mapping & Correlation", () => {
    it("maps Mongoose CastError to 400 INVALID_IDENTIFIER with correlation requestId", async () => {
      const castRouter = Router();
      castRouter.get("/test-cast-error", () => {
        const error = new Error("Cast to ObjectId failed for value 'abc' at path '_id'") as any;
        error.name = "CastError";
        error.path = "_id";
        throw error;
      });

      const testApp = createApp({
        isProduction: false,
        allowedOrigins: [ALLOWED_ORIGIN],
        router: castRouter,
      });
      const customServer = testApp.listen(0);
      const addr = customServer.address();
      if (!addr || typeof addr === "string") throw new Error("Addr failed");
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const res = await fetch(`${url}/test-cast-error`);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, "INVALID_IDENTIFIER");
        assert.ok(data.error.requestId);
        assert.equal(data.error.requestId, res.headers.get("x-request-id"));
      } finally {
        customServer.close();
      }
    });

    it("maps MongoDB duplicate key errors to 409 with specific code", async () => {
      // Attempt to add duplicate instrument to Alice's watchlist
      const res = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: instrumentId1 }),
      });
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error.code, "WATCHLIST_ITEM_ALREADY_EXISTS");
      assert.ok(data.error.requestId);
    });

    it("attaches requestId to custom AppError instances", async () => {
      const customRouter = Router();
      customRouter.get("/test-custom-error", () => {
        throw new AppError(
          "CUSTOM_BUSINESS_ERROR",
          "A business rule was violated.",
          422,
          { rule: "LIMIT" }
        );
      });

      const testApp = createApp({
        isProduction: false,
        allowedOrigins: [ALLOWED_ORIGIN],
        router: customRouter,
      });
      const customServer = testApp.listen(0);
      const addr = customServer.address();
      if (!addr || typeof addr === "string") throw new Error("Addr failed");
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const res = await fetch(`${url}/test-custom-error`);
        assert.equal(res.status, 422);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error.code, "CUSTOM_BUSINESS_ERROR");
        assert.equal(data.error.message, "A business rule was violated.");
        assert.deepEqual(data.error.details, { rule: "LIMIT" });
        assert.ok(data.error.requestId);
        assert.equal(data.error.requestId, res.headers.get("x-request-id"));
      } finally {
        customServer.close();
      }
    });

    it("sanitizes 500 internal errors in production to avoid leaking details", async () => {
      const prodRouter = Router();
      prodRouter.get("/test-internal-error", () => {
        throw new Error("Secret database stack trace or internal password leak");
      });

      const prodApp = createApp({
        isProduction: true,
        allowedOrigins: [ALLOWED_ORIGIN],
        router: prodRouter,
      });
      const prodServer = prodApp.listen(0);
      const addr = prodServer.address();
      if (!addr || typeof addr === "string") throw new Error("Addr failed");
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const res = await fetch(`${url}/test-internal-error`);
        assert.equal(res.status, 500);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.error, "Internal Server Error");
      } finally {
        prodServer.close();
      }
    });
  });
});

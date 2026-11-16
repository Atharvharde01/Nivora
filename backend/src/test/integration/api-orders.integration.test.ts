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
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { PracticeAccountService } from "../../modules/practice-accounts/account.service";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { OrderController } from "../../modules/orders/order.controller";
import {
  clearDatabase,
  createTestAccount,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

describe("Task 26 — Trading & Order REST APIs (Real Replica-Set Integration)", () => {
  const TEST_JWT_SECRET =
    "integration_test_jwt_access_secret_key_minimum_32_characters";
  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;
  let authToken: string;
  let testUserId: Types.ObjectId;
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

    const quoteService = new InstrumentQuoteService();
    const practiceAccountService = new PracticeAccountService();
    const orderExecutionService = new OrderExecutionService({ quoteService });
    const orderController = new OrderController({
      orderExecutionService,
      practiceAccountService,
    });

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      orderController,
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

    // 1. Primary test user + active practice account
    const user = await createTestUser();
    testUserId = user._id;
    await createTestAccount(testUserId);

    const session = new SessionModel({
      userId: user._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "OrderIntegrationTest/1.0",
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

    // 2. Second test user for isolation checks
    const otherUser = await createTestUser();
    otherUserId = otherUser._id;
    await createTestAccount(otherUserId);

    const otherSession = new SessionModel({
      userId: otherUser._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "OrderIntegrationTest/1.0",
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

  describe("1. Authentication & Idempotency Security Enforcement", () => {
    it("rejects unauthenticated requests to order endpoints with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error.code, "UNAUTHORIZED");
    });

    it("rejects requests missing or having invalid Idempotency-Key header with 400", async () => {
      const inst = await createTestInstrument();

      // Missing header
      const missingRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });
      assert.equal(missingRes.status, 400);
      const missingJson = await missingRes.json();
      assert.equal(missingJson.error.code, "INVALID_IDEMPOTENCY_KEY");

      // Short header (< 8 chars)
      const shortRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "short",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });
      assert.equal(shortRes.status, 400);
      const shortJson = await shortRes.json();
      assert.equal(shortJson.error.code, "INVALID_IDEMPOTENCY_KEY");
    });

    it("strictly rejects client-supplied price injection with 400 CLIENT_PRICE_NOT_ALLOWED", async () => {
      const inst = await createTestInstrument();
      const forbiddenPayloads = [
        { price: 100 },
        { pricePaise: 10000 },
        { executionPricePaise: 10000 },
        { bidPricePaise: 10000 },
        { askPricePaise: 10000 },
        { totalValuePaise: 100000 },
      ];

      for (const forbidden of forbiddenPayloads) {
        const res = await fetch(`${baseUrl}/api/v1/orders`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "valid-idempotency-key-12345",
          },
          body: JSON.stringify({
            instrumentId: inst._id.toString(),
            side: "BUY",
            quantity: 5,
            ...forbidden,
          }),
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.error.code, "CLIENT_PRICE_NOT_ALLOWED");
      }
    });

    it("rejects invalid side, quantity and instrumentId with 400", async () => {
      const inst = await createTestInstrument();

      // Invalid side
      const badSide = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "valid-key-side-test",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "HOLD",
          quantity: 5,
        }),
      });
      assert.equal(badSide.status, 400);
      const badSideJson = await badSide.json();
      assert.equal(badSideJson.error.code, "INVALID_ORDER_SIDE");

      // Invalid quantity
      const badQty = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "valid-key-qty-test",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: -1,
        }),
      });
      assert.equal(badQty.status, 400);
      const badQtyJson = await badQty.json();
      assert.equal(badQtyJson.error.code, "INVALID_QUANTITY");
    });
  });

  describe("2. Simulated Market Order Execution (BUY & SELL)", () => {
    it("executes BUY order at ask price, returns 201, and supports idempotent replay with 200", async () => {
      const inst = await createTestInstrument({
        symbol: "TCS",
        lastPricePaise: 350_000,
        bidPricePaise: 349_900,
        askPricePaise: 350_100,
      });

      const key = "idempotency-key-buy-tcs-001";

      // 1. Initial BUY
      const buyRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });

      assert.equal(buyRes.status, 201);
      const buyJson = await buyRes.json();
      assert.equal(buyJson.success, true);
      assert.equal(buyJson.data.status, "EXECUTED");
      assert.equal(buyJson.data.wasIdempotentReplay, false);
      assert.equal(buyJson.data.order.executedQuantity, 10);
      assert.equal(buyJson.data.order.executionPricePaise, 350_100);
      assert.equal(buyJson.data.order.totalValuePaise, 3_501_000);
      assert.ok(buyJson.data.trade);
      assert.equal(buyJson.data.trade.executionPricePaise, 350_100);

      // 2. Idempotent Replay with same key
      const replayRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });

      assert.equal(replayRes.status, 200);
      const replayJson = await replayRes.json();
      assert.equal(replayJson.success, true);
      assert.equal(replayJson.data.status, "EXECUTED");
      assert.equal(replayJson.data.wasIdempotentReplay, true);
      assert.equal(replayJson.data.order._id, buyJson.data.order._id);

      // 3. Conflict: same key with mismatched payload
      const conflictRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 20, // different quantity!
        }),
      });

      assert.equal(conflictRes.status, 409);
      const conflictJson = await conflictRes.json();
      assert.equal(conflictJson.error.code, "IDEMPOTENCY_KEY_CONFLICT");
    });

    it("executes partial SELL at bid price, records realized P&L, and returns 201", async () => {
      const inst = await createTestInstrument({
        symbol: "INFY",
        lastPricePaise: 150_000,
        bidPricePaise: 149_900,
        askPricePaise: 150_100,
      });

      // BUY 10 shares
      await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "buy-infy-for-sell-test-01",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });

      // SELL 4 shares
      const sellRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "sell-infy-partial-test-01",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "SELL",
          quantity: 4,
        }),
      });

      assert.equal(sellRes.status, 201);
      const sellJson = await sellRes.json();
      assert.equal(sellJson.success, true);
      assert.equal(sellJson.data.status, "EXECUTED");
      assert.equal(sellJson.data.order.executedQuantity, 4);
      assert.equal(sellJson.data.order.executionPricePaise, 149_900);
      assert.equal(sellJson.data.order.totalValuePaise, 4 * 149_900);
      assert.ok(sellJson.data.trade);
    });

    it("creates terminal REJECTED order when funds are insufficient", async () => {
      const inst = await createTestInstrument({
        lastPricePaise: 500_000,
        bidPricePaise: 499_900,
        askPricePaise: 500_100,
      });

      // Attempt to buy shares that cost way more than ₹10,00,000
      const rejectRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "buy-overspend-rejection-key-1",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 100_000, // 100,000 * 5001 = 500,100,000 paise > 100,000,000
        }),
      });

      assert.equal(rejectRes.status, 201);
      const rejectJson = await rejectRes.json();
      assert.equal(rejectJson.data.status, "REJECTED");
      assert.equal(rejectJson.data.rejectionCode, "INSUFFICIENT_FUNDS");
      assert.equal(rejectJson.data.order.status, "REJECTED");
      assert.equal(rejectJson.data.trade, null);
    });

    it("creates terminal REJECTED order when selling more shares than held", async () => {
      const inst = await createTestInstrument();

      const oversellRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "oversell-rejection-key-1234",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "SELL",
          quantity: 50, // user owns 0 shares
        }),
      });

      assert.equal(oversellRes.status, 201);
      const oversellJson = await oversellRes.json();
      assert.equal(oversellJson.data.status, "REJECTED");
      assert.equal(oversellJson.data.rejectionCode, "INSUFFICIENT_QUANTITY");
      assert.equal(oversellJson.data.trade, null);
    });
  });

  describe("3. Order History & Ownership Scoping", () => {
    it("retrieves paginated orders strictly for the authenticated user", async () => {
      const inst = await createTestInstrument({ symbol: "WIPRO" });

      // User 1 places an order
      const res1 = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "user1-wipro-order-key-1",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 5,
        }),
      });
      const json1 = await res1.json();
      const orderId1 = json1.data.order._id;

      // User 2 places an order
      await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${otherAuthToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "user2-wipro-order-key-1",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 2,
        }),
      });

      // User 1 queries order list
      const listRes = await fetch(`${baseUrl}/api/v1/orders`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      assert.equal(listJson.data.pagination.total, 1);
      assert.equal(listJson.data.items[0]._id, orderId1);

      // User 1 retrieves own order by ID
      const singleRes = await fetch(`${baseUrl}/api/v1/orders/${orderId1}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(singleRes.status, 200);
      const singleJson = await singleRes.json();
      assert.equal(singleJson.data.order._id, orderId1);

      // User 2 attempts to retrieve User 1's order -> 404 (ownership isolation)
      const foreignRes = await fetch(`${baseUrl}/api/v1/orders/${orderId1}`, {
        headers: { Authorization: `Bearer ${otherAuthToken}` },
      });
      assert.equal(foreignRes.status, 404);
    });
  });
});

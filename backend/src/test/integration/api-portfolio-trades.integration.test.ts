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

describe("Task 27 — Trades & Portfolio REST APIs (Real Replica-Set Integration)", () => {
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
    const portfolioService = new PortfolioService({
      quoteService,
      accountService: practiceAccountService,
    });
    const portfolioController = new PortfolioController({ portfolioService });
    const tradeController = new TradeController();

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      orderController,
      portfolioController,
      tradeController,
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

    // 1. Primary test user + account
    const user = await createTestUser();
    testUserId = user._id;
    await createTestAccount(testUserId);

    const session = new SessionModel({
      userId: user._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "PortfolioIntegrationTest/1.0",
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

    // 2. Secondary test user for isolation tests
    const otherUser = await createTestUser();
    otherUserId = otherUser._id;
    await createTestAccount(otherUserId);

    const otherSession = new SessionModel({
      userId: otherUser._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "PortfolioIntegrationTest/1.0",
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
    it("rejects unauthenticated requests to portfolio and trades endpoints with 401", async () => {
      const portRes = await fetch(`${baseUrl}/api/v1/portfolio`);
      assert.equal(portRes.status, 401);

      const tradeRes = await fetch(`${baseUrl}/api/v1/trades`);
      assert.equal(tradeRes.status, 401);
    });
  });

  describe("2. Portfolio Valuation & Position Retrieval", () => {
    it("returns clean portfolio summary and reflects live valuation after trades", async () => {
      // 1. Initially empty portfolio
      const emptyRes = await fetch(`${baseUrl}/api/v1/portfolio`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(emptyRes.status, 200);
      const emptyJson = await emptyRes.json();
      assert.equal(emptyJson.success, true);
      assert.equal(emptyJson.data.summary.cashBalancePaise, 100_000_000);
      assert.equal(emptyJson.data.summary.totalInvestedPaise, 0);
      assert.equal(emptyJson.data.summary.currentMarketValuePaise, 0);
      assert.equal(emptyJson.data.summary.activePositionsCount, 0);
      assert.equal(emptyJson.data.positions.length, 0);

      // 2. Buy shares of an instrument
      const inst = await createTestInstrument({
        symbol: "RELIANCE",
        lastPricePaise: 250_000,
        bidPricePaise: 249_900,
        askPricePaise: 250_000,
      });

      await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "buy-reliance-for-portfolio-01",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 10,
        }),
      });

      // 3. Query portfolio after BUY
      const postBuyRes = await fetch(`${baseUrl}/api/v1/portfolio`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(postBuyRes.status, 200);
      const postBuyJson = await postBuyRes.json();
      assert.equal(postBuyJson.data.summary.cashBalancePaise, 100_000_000 - 2_500_000);
      assert.equal(postBuyJson.data.summary.totalInvestedPaise, 2_500_000);
      assert.equal(postBuyJson.data.summary.currentMarketValuePaise, 2_500_000);
      assert.equal(postBuyJson.data.summary.activePositionsCount, 1);
      assert.equal(postBuyJson.data.positions.length, 1);
      assert.equal(postBuyJson.data.positions[0].symbol, "RELIANCE");
      assert.equal(postBuyJson.data.positions[0].quantity, 10);
      assert.equal(postBuyJson.data.positions[0].averageBuyPricePaise, 250_000);

      // 4. Query specific position
      const posRes = await fetch(
        `${baseUrl}/api/v1/portfolio/positions/${inst._id.toString()}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      assert.equal(posRes.status, 200);
      const posJson = await posRes.json();
      assert.equal(posJson.data.position.symbol, "RELIANCE");
      assert.equal(posJson.data.position.quantity, 10);

      // 5. Query nonexistent position -> 404
      const nonExistentId = new Types.ObjectId().toString();
      const notFoundPos = await fetch(
        `${baseUrl}/api/v1/portfolio/positions/${nonExistentId}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      assert.equal(notFoundPos.status, 404);
      const notFoundJson = await notFoundPos.json();
      assert.equal(notFoundJson.error.code, "POSITION_NOT_FOUND");
    });
  });

  describe("3. Trade Execution History & Multi-Tenant Isolation", () => {
    it("lists paginated trades and enforces user ownership on individual trade lookup", async () => {
      const inst = await createTestInstrument({
        symbol: "HDFCBANK",
        lastPricePaise: 160_000,
        bidPricePaise: 159_900,
        askPricePaise: 160_100,
      });

      // User 1 executes a BUY
      const buyRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "user1-hdfc-buy-trade-01",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "BUY",
          quantity: 20,
        }),
      });
      const buyJson = await buyRes.json();
      const tradeId1 = buyJson.data.trade._id;

      // User 1 executes a partial SELL
      const sellRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "user1-hdfc-sell-trade-01",
        },
        body: JSON.stringify({
          instrumentId: inst._id.toString(),
          side: "SELL",
          quantity: 5,
        }),
      });
      const sellJson = await sellRes.json();
      const tradeId2 = sellJson.data.trade._id;

      // User 1 queries trade history
      const tradesRes = await fetch(`${baseUrl}/api/v1/trades`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(tradesRes.status, 200);
      const tradesJson = await tradesRes.json();
      assert.equal(tradesJson.data.pagination.total, 2);
      assert.equal(tradesJson.data.items.length, 2);
      assert.equal(tradesJson.data.items[0]._id, tradeId2); // Most recent first
      assert.equal(tradesJson.data.items[1]._id, tradeId1);

      // Filter by side = BUY
      const buyOnlyRes = await fetch(`${baseUrl}/api/v1/trades?side=BUY`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(buyOnlyRes.status, 200);
      const buyOnlyJson = await buyOnlyRes.json();
      assert.equal(buyOnlyJson.data.pagination.total, 1);
      assert.equal(buyOnlyJson.data.items[0]._id, tradeId1);

      // Query single trade by ID
      const singleTradeRes = await fetch(`${baseUrl}/api/v1/trades/${tradeId1}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(singleTradeRes.status, 200);
      const singleTradeJson = await singleTradeRes.json();
      assert.equal(singleTradeJson.data.trade.symbol, "HDFCBANK");
      assert.equal(singleTradeJson.data.trade.side, "BUY");
      assert.equal(singleTradeJson.data.trade.quantity, 20);

      // Secondary User attempts to access User 1's trade -> 404
      const foreignTradeRes = await fetch(
        `${baseUrl}/api/v1/trades/${tradeId1}`,
        { headers: { Authorization: `Bearer ${otherAuthToken}` } }
      );
      assert.equal(foreignTradeRes.status, 404);
      const foreignTradeJson = await foreignTradeRes.json();
      assert.equal(foreignTradeJson.error.code, "TRADE_NOT_FOUND");
    });
  });
});

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
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
import { UserModel } from "../../modules/users/user.model";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { InstrumentController } from "../../modules/instruments/instrument.controller";
import { WatchlistService } from "../../modules/watchlist/watchlist.service";
import { WatchlistController } from "../../modules/watchlist/watchlist.controller";
import { PracticeAccountService } from "../../modules/practice-accounts/account.service";
import { AccountController } from "../../modules/practice-accounts/account.controller";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { OrderController } from "../../modules/orders/order.controller";
import { PortfolioService } from "../../modules/portfolio/portfolio.service";
import { PortfolioController } from "../../modules/portfolio/portfolio.controller";
import { TradeController } from "../../modules/trades/trade.controller";
import { HoldingModel } from "../../modules/holdings/holding.model";
import { TradeModel } from "../../modules/trades/trade.model";
import { OrderModel } from "../../modules/orders/order.model";
import { LedgerEntryModel } from "../../modules/ledger/ledger.model";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import {
  clearDatabase,
  createTestAccount,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { generateCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../../modules/auth/csrf.utils";

describe("Task 32 — Full Backend API Regression & Financial Integrity (Integration)", () => {
  const TEST_JWT_SECRET = "test_regression_jwt_secret_min_32_characters_ok";
  const ALLOWED_ORIGIN = "http://localhost:3000";

  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;
  let mockEmailService: MockEmailService;

  // Primary Test User (Alice)
  let userAId: Types.ObjectId;
  let userAToken: string;
  let userASessionId: Types.ObjectId;
  let userAAccountId: string;

  // Secondary Test User (Bob)
  let userBId: Types.ObjectId;
  let userBToken: string;
  let userBSessionId: Types.ObjectId;
  let userBAccountId: string;

  // Tradable instruments
  let instRelianceId: string;
  let instTcsId: string;

  before(async () => {
    await setupIntegrationTestDb();

    jwtService = new JwtService({ accessSecret: TEST_JWT_SECRET });
    mockEmailService = new MockEmailService();
    const otpService = new OtpService({
      hmacSecret: "test_hmac_secret_key_minimum_32_characters",
      emailService: mockEmailService,
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
    if (!addr || typeof addr === "string") throw new Error("Failed to get server address");
    baseUrl = `http://127.0.0.1:${addr.port}`;

    await clearDatabase();

    // 1. Create Alice (User A)
    const userA = await createTestUser({ email: "alice.regression@nivora.in" });
    userAId = userA._id;
    const accountA = await createTestAccount(userAId);
    userAAccountId = accountA._id.toString();

    const now = new Date();
    const sessionA = new SessionModel({
      userId: userAId,
      currentRefreshTokenHash: "a".repeat(64),
      ipAddress: "127.0.0.1",
      userAgent: "RegressionAgent",
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

    // 2. Create Bob (User B)
    const userB = await createTestUser({ email: "bob.regression@nivora.in" });
    userBId = userB._id;
    const accountB = await createTestAccount(userBId);
    userBAccountId = accountB._id.toString();

    const sessionB = new SessionModel({
      userId: userBId,
      currentRefreshTokenHash: "b".repeat(64),
      ipAddress: "127.0.0.1",
      userAgent: "RegressionAgent",
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

    // 3. Create test instruments
    const inst1 = await createTestInstrument({
      symbol: "RELIANCE",
      name: "Reliance Industries Ltd",
      exchange: "NSE",
      lastPricePaise: 295000,
      bidPricePaise: 294900,
      askPricePaise: 295100,
      isTradable: true,
    });
    instRelianceId = inst1._id.toString();

    const inst2 = await createTestInstrument({
      symbol: "TCS",
      name: "Tata Consultancy Services Ltd",
      exchange: "BSE",
      lastPricePaise: 382000,
      bidPricePaise: 381800,
      askPricePaise: 382200,
      isTradable: true,
    });
    instTcsId = inst2._id.toString();
  });

  after(async () => {
    server?.close();
    await teardownIntegrationTestDb();
  });

  // ==========================================
  // SECTION 1: AUTHENTICATION & SESSION REGRESSION
  // ==========================================
  describe("1. Authentication & Session Security Regression", () => {
    it("requests OTP and rejects invalid OTP verification with 400 INVALID_OTP", async () => {
      const email = "newtrader@nivora.in";
      const reqRes = await fetch(`${baseUrl}/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      assert.equal(reqRes.status, 200);
      const reqJson = await reqRes.json();
      assert.equal(reqJson.success, true);

      // Verify with wrong OTP
      const verifyRes = await fetch(`${baseUrl}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: "000000" }),
      });
      assert.equal(verifyRes.status, 400);
      const verifyJson = await verifyRes.json();
      assert.equal(verifyJson.error.code, "INVALID_OTP");
    });

    it("enforces session-bound CSRF token validation", () => {
      const sessionId = userASessionId.toString();
      const secret = TEST_JWT_SECRET;
      const boundToken = generateCsrfToken(sessionId, secret);

      assert.ok(boundToken.includes("."));
      const [salt, hmac] = boundToken.split(".");
      assert.equal(salt.length, 32);
      assert.equal(hmac.length, 64);
    });

    it("GET /auth/me returns authenticated user identity", async () => {
      const res = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.user.email, "alice.regression@nivora.in");
      assert.equal(json.session.status, "ACTIVE");
    });

    it("rejects request with expired or invalid JWT token with 401 UNAUTHORIZED", async () => {
      const res = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: "Bearer invalid.fake.token" },
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error.code, "UNAUTHORIZED");
    });
  });

  // ==========================================
  // SECTION 2: INSTRUMENT & WATCHLIST REGRESSION
  // ==========================================
  describe("2. Instrument & Watchlist Regression", () => {
    it("lists instruments with search and exchange filters", async () => {
      const res = await fetch(`${baseUrl}/api/v1/instruments?search=RELIANCE&exchange=NSE`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.items.length >= 1);
      assert.equal(json.data.items[0].symbol, "RELIANCE");
    });

    it("retrieves simulated quote snapshot with bid/ask spread invariants", async () => {
      const res = await fetch(`${baseUrl}/api/v1/instruments/${instRelianceId}/quote`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      const quote = json.data.quote;
      assert.ok(quote.bidPricePaise > 0);
      assert.ok(quote.askPricePaise > 0);
      assert.ok(quote.bidPricePaise <= quote.askPricePaise);
    });

    it("manages watchlist lifecycle: add, duplicate rejection, and reordering", async () => {
      // 1. Add Reliance to Alice's watchlist
      const addRes1 = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: instRelianceId }),
      });
      assert.equal(addRes1.status, 201);

      // 2. Add TCS to Alice's watchlist
      const addRes2 = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: instTcsId }),
      });
      assert.equal(addRes2.status, 201);

      // 3. Duplicate rejection
      const dupRes = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: instRelianceId }),
      });
      assert.equal(dupRes.status, 409);
      const dupJson = await dupRes.json();
      assert.equal(dupJson.error.code, "WATCHLIST_ITEM_ALREADY_EXISTS");

      // 4. Retrieve watchlist
      const listRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      assert.equal(listJson.data.count, 2);

      // 5. Reorder watchlist
      const reorderRes = await fetch(`${baseUrl}/api/v1/watchlist/reorder`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instrumentIds: [instTcsId, instRelianceId],
        }),
      });
      assert.equal(reorderRes.status, 200);
      const reorderJson = await reorderRes.json();
      assert.equal(reorderJson.data.items[0].instrumentId, instTcsId);
      assert.equal(reorderJson.data.items[1].instrumentId, instRelianceId);
    });
  });

  // ==========================================
  // SECTION 3: TRADING & FINANCIAL INTEGRITY REGRESSION
  // ==========================================
  describe("3. Trading Execution & Financial Integrity Regression (Replica-Set)", () => {
    let openingCashPaise: number;
    let buyExecutionPricePaise: number;
    let buyTotalValuePaise: number;
    const BUY_QTY = 10;
    const SELL_QTY = 4;
    let sellExecutionPricePaise: number;
    let sellTotalProceedsPaise: number;
    let realizedPnLPaise: number;

    it("records initial active practice account balance of 100,000,000 paise (₹10,00,000)", async () => {
      const balRes = await fetch(`${baseUrl}/api/v1/accounts/active`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(balRes.status, 200);
      const balJson = await balRes.json();
      openingCashPaise = balJson.data.account.cashBalancePaise;
      assert.equal(openingCashPaise, 100_000_000);
    });

    it("rejects client-supplied price fields with 400 CLIENT_PRICE_NOT_ALLOWED", async () => {
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "client-price-injection-test-key",
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "BUY",
          quantity: 1,
          executionPricePaise: 100, // Malicious client attempt
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, "CLIENT_PRICE_NOT_ALLOWED");
    });

    it("executes BUY at authoritative ask price, debits balance, and creates holding + ledger record", async () => {
      const idempotencyKey = "alice-regression-buy-order-1";
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "BUY",
          quantity: BUY_QTY,
        }),
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.order.status, "EXECUTED");
      assert.equal(json.data.order.side, "BUY");
      assert.equal(json.data.order.quantity, BUY_QTY);

      buyExecutionPricePaise = json.data.order.executionPricePaise;
      buyTotalValuePaise = json.data.order.totalValuePaise;
      assert.equal(buyTotalValuePaise, buyExecutionPricePaise * BUY_QTY);

      // Verify cash balance deducted exactly via active account endpoint
      const balCheckRes = await fetch(`${baseUrl}/api/v1/accounts/active`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      const balCheckJson = await balCheckRes.json();
      const expectedBalance = openingCashPaise - buyTotalValuePaise;
      assert.equal(balCheckJson.data.account.cashBalancePaise, expectedBalance);

      // Verify holding created in DB
      const holdingInDb = await HoldingModel.findOne({
        userId: userAId,
        instrumentId: new Types.ObjectId(instRelianceId),
      });
      assert.ok(holdingInDb);
      assert.equal(holdingInDb.quantity, BUY_QTY);
      assert.equal(holdingInDb.averageBuyPricePaise, buyExecutionPricePaise);

      // Verify immutable DEBIT cash ledger entry
      const ledgerEntry = await LedgerEntryModel.findOne({
        userId: userAId,
        referenceId: json.data.trade._id,
      });
      assert.ok(ledgerEntry);
      assert.equal(ledgerEntry.direction, "DEBIT");
      assert.equal(ledgerEntry.amountPaise, buyTotalValuePaise);
      assert.equal(ledgerEntry.balanceAfterPaise, expectedBalance);
    });

    it("replays BUY idempotently when re-submitted with exact same idempotency key", async () => {
      const idempotencyKey = "alice-regression-buy-order-1";
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "BUY",
          quantity: BUY_QTY,
        }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.wasIdempotentReplay, true);
      assert.equal(json.data.order.totalValuePaise, buyTotalValuePaise);
    });

    it("rejects conflicting order intent with same idempotency key with 409 IDEMPOTENCY_KEY_CONFLICT", async () => {
      const idempotencyKey = "alice-regression-buy-order-1";
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          instrumentId: instTcsId, // Conflicting instrument
          side: "BUY",
          quantity: 5,
        }),
      });
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.error.code, "IDEMPOTENCY_KEY_CONFLICT");
    });

    it("executes partial SELL at authoritative bid price, credits cash balance, and records realized P&L", async () => {
      const idempotencyKey = "alice-regression-sell-order-1";
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "SELL",
          quantity: SELL_QTY,
        }),
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.order.status, "EXECUTED");
      assert.equal(json.data.order.side, "SELL");
      assert.equal(json.data.order.quantity, SELL_QTY);

      sellExecutionPricePaise = json.data.order.executionPricePaise;
      sellTotalProceedsPaise = json.data.order.totalValuePaise;
      realizedPnLPaise = json.data.trade.realizedPnLPaise;

      // Verify holding decremented
      const holdingInDb = await HoldingModel.findOne({
        userId: userAId,
        instrumentId: new Types.ObjectId(instRelianceId),
      });
      assert.ok(holdingInDb);
      assert.equal(holdingInDb.quantity, BUY_QTY - SELL_QTY);

      // Verify immutable CREDIT ledger entry
      const ledgerEntry = await LedgerEntryModel.findOne({
        userId: userAId,
        referenceId: json.data.trade._id,
      });
      assert.ok(ledgerEntry);
      assert.equal(ledgerEntry.direction, "CREDIT");
      assert.equal(ledgerEntry.amountPaise, sellTotalProceedsPaise);
    });

    it("rejects SELL when requested quantity exceeds current holding with 201 REJECTED (INSUFFICIENT_QUANTITY)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-oversell-test-key",
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "SELL",
          quantity: 9999, // Exceeds holding
        }),
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.status, "REJECTED");
      assert.equal(json.data.rejectionCode, "INSUFFICIENT_QUANTITY");
      assert.equal(json.data.trade, null);
    });

    it("executes full exit on remaining shares and retains zero-quantity holding (never deletes document)", async () => {
      const remainingQty = BUY_QTY - SELL_QTY; // 6 shares
      const res = await fetch(`${baseUrl}/api/v1/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-full-exit-sell-order",
        },
        body: JSON.stringify({
          instrumentId: instRelianceId,
          side: "SELL",
          quantity: remainingQty,
        }),
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.status, "EXECUTED");

      // Verify holding document still exists in MongoDB with zero quantity
      const holdingInDb = await HoldingModel.findOne({
        userId: userAId,
        instrumentId: new Types.ObjectId(instRelianceId),
      });
      assert.ok(holdingInDb !== null);
      assert.equal(holdingInDb.quantity, 0);
      assert.equal(holdingInDb.totalInvestedPaise, 0);
    });
  });

  // ==========================================
  // SECTION 4: PORTFOLIO & VALUATION REGRESSION
  // ==========================================
  describe("4. Portfolio & Valuation Regression", () => {
    it("GET /api/v1/portfolio computes accurate portfolio valuation and realized P&L", async () => {
      const res = await fetch(`${baseUrl}/api/v1/portfolio`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      const summary = json.data.summary;
      assert.ok(typeof summary.cashBalancePaise === "number");
      assert.ok(typeof summary.realizedPnlPaise === "number");
      assert.equal(summary.activePositionsCount, 0);
    });

    it("GET /api/v1/trades returns paginated trade history with quote snapshots", async () => {
      const res = await fetch(`${baseUrl}/api/v1/trades?page=1&limit=10`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.items.length >= 3); // 1 BUY + 2 SELLs
      const firstTrade = json.data.items[0];
      assert.ok(firstTrade.executionPricePaise > 0);
      assert.ok(firstTrade.quoteSnapshot.bidPricePaise <= firstTrade.quoteSnapshot.askPricePaise);
    });
  });

  // ==========================================
  // SECTION 5: PRACTICE ACCOUNT RESET & CONTRACT REGRESSION
  // ==========================================
  describe("5. Practice Account Lifecycle & Reset Contract Regression", () => {
    it("rejects reset request missing confirmation or using wrong string with 400 CONFIRMATION_REQUIRED", async () => {
      const res = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-bad-reset-confirmation",
        },
        body: JSON.stringify({
          confirmation: "WRONG_STRING",
          expectedActiveAccountId: userAAccountId,
        }),
      });
      assert.equal(res.status, 400);
    });

    it("rejects reset request with stale expectedActiveAccountId with 409 STALE_ACCOUNT_ID", async () => {
      const staleId = new Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-stale-account-reset-attempt",
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: staleId,
        }),
      });
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.error.code, "STALE_ACCOUNT_ID");
    });

    it("atomically resets practice account: archives account #1, creates active account #2 with 100,000,000 paise, and preserves watchlist", async () => {
      const res = await fetch(`${baseUrl}/api/v1/accounts/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "alice-valid-reset-contract-1",
        },
        body: JSON.stringify({
          confirmation: "RESET_PRACTICE_ACCOUNT",
          expectedActiveAccountId: userAAccountId,
        }),
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.archivedAccount.status, "ARCHIVED");
      assert.equal(json.data.activeAccount.status, "ACTIVE");
      assert.equal(json.data.activeAccount.accountNumber, 2);
      assert.equal(json.data.activeAccount.cashBalancePaise, 100_000_000);

      // Verify Alice's watchlist was preserved
      const wlRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      const wlJson = await wlRes.json();
      assert.equal(wlJson.data.count, 2);
    });
  });

  // ==========================================
  // SECTION 6: STRICT MULTI-TENANT IDOR REGRESSION
  // ==========================================
  describe("6. Cross-User IDOR Security Regression", () => {
    it("User B cannot read User A's archived or active practice accounts with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/accounts/${userAAccountId}`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, "ACCOUNT_OWNERSHIP_VIOLATION");
    });

    it("User B cannot read User A's cash ledger with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/accounts/${userAAccountId}/ledger`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, "ACCOUNT_OWNERSHIP_VIOLATION");
    });
  });

  // ==========================================
  // SECTION 7: STRICT MATHEMATICAL FINANCIAL RECONCILIATION
  // ==========================================
  describe("7. Mathematical Financial Reconciliation Audit", () => {
    it("reconciles cash balance against immutable ledger history down to the exact paise", async () => {
      // Fetch archived account #1 ledger
      const archivedAccount = await PracticeAccountModel.findById(userAAccountId);
      assert.ok(archivedAccount);
      assert.equal(archivedAccount.status, "ARCHIVED");

      const ledgerEntries = await LedgerEntryModel.find({
        practiceAccountId: archivedAccount._id,
      }).sort({ createdAt: 1, _id: 1 });

      let calculatedCashPaise = 0;
      for (const entry of ledgerEntries) {
        if (entry.direction === "CREDIT") {
          calculatedCashPaise += entry.amountPaise;
        } else if (entry.direction === "DEBIT") {
          calculatedCashPaise -= entry.amountPaise;
        }
        assert.equal(calculatedCashPaise, entry.balanceAfterPaise);
      }

      assert.equal(calculatedCashPaise, archivedAccount.cashBalancePaise);
    });

    it("confirms 1-to-1 integrity between executed orders, trades, and cash ledger debits/credits", async () => {
      const orders = await OrderModel.find({
        userId: userAId,
        practiceAccountId: new Types.ObjectId(userAAccountId),
        status: "EXECUTED",
      });
      const trades = await TradeModel.find({
        userId: userAId,
        practiceAccountId: new Types.ObjectId(userAAccountId),
      });

      assert.equal(orders.length, trades.length);

      for (const order of orders) {
        const matchingTrade = trades.find((t) => t.orderId.toString() === order._id.toString());
        assert.ok(matchingTrade !== undefined);
        assert.equal(matchingTrade.quantity, order.quantity);
        assert.equal(matchingTrade.totalValuePaise, order.totalValuePaise);
      }
    });
  });
});

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
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { WatchlistItemModel } from "../../modules/watchlist/watchlist.model";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { InstrumentController } from "../../modules/instruments/instrument.controller";
import { WatchlistService } from "../../modules/watchlist/watchlist.service";
import { WatchlistController } from "../../modules/watchlist/watchlist.controller";
import {
  clearDatabase,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

describe("Task 25 — Instruments & Watchlist REST APIs (Real Replica-Set Integration)", () => {
  const TEST_JWT_SECRET =
    "integration_test_jwt_access_secret_key_minimum_32_characters";
  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;
  let authToken: string;
  let testUserId: Types.ObjectId;

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
    const instrumentController = new InstrumentController({ quoteService });
    const watchlistService = new WatchlistService({ quoteService });
    const watchlistController = new WatchlistController({ watchlistService });

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
      instrumentController,
      watchlistController,
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

    const user = await createTestUser();
    testUserId = user._id;

    const session = new SessionModel({
      userId: user._id,
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "IntegrationTestAgent/1.0",
      currentRefreshTokenHash: "a".repeat(64),
      idleExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastActiveAt: new Date(),
    });
    await session.save();

    authToken = jwtService.generateAccessToken({
      userId: user._id.toString(),
      sessionId: session._id.toString(),
    });
  });

  describe("1. Authentication Enforcement", () => {
    it("rejects unauthenticated requests to /api/v1/instruments with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/instruments`);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, "UNAUTHORIZED");
    });

    it("rejects unauthenticated requests to /api/v1/watchlist with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/watchlist`);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, "UNAUTHORIZED");
    });
  });

  describe("2. Instrument Search, Retrieval & Quotes", () => {
    it("returns paginated instruments with search and exchange filters", async () => {
      await createTestInstrument({ symbol: "INFY", name: "Infosys Ltd", exchange: "NSE" });
      await createTestInstrument({ symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" });
      await createTestInstrument({ symbol: "RELIANCE", name: "Reliance Industries", exchange: "BSE" });

      // All instruments
      const allRes = await fetch(`${baseUrl}/api/v1/instruments`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(allRes.status, 200);
      const allJson = await allRes.json();
      assert.equal(allJson.success, true);
      assert.equal(allJson.data.pagination.total, 3);
      assert.equal(allJson.data.items.length, 3);

      // Search filter
      const searchRes = await fetch(`${baseUrl}/api/v1/instruments?q=infosys`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(searchRes.status, 200);
      const searchJson = await searchRes.json();
      assert.equal(searchJson.data.items.length, 1);
      assert.equal(searchJson.data.items[0].symbol, "INFY");

      // Exchange filter
      const bseRes = await fetch(`${baseUrl}/api/v1/instruments?exchange=BSE`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(bseRes.status, 200);
      const bseJson = await bseRes.json();
      assert.equal(bseJson.data.items.length, 1);
      assert.equal(bseJson.data.items[0].symbol, "RELIANCE");
    });

    it("retrieves instrument by ID and returns 404 for nonexistent ID", async () => {
      const inst = await createTestInstrument({ symbol: "HDFCBANK" });

      const res = await fetch(`${baseUrl}/api/v1/instruments/${inst._id.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.instrument.symbol, "HDFCBANK");

      const nonExistent = new Types.ObjectId().toString();
      const notFoundRes = await fetch(`${baseUrl}/api/v1/instruments/${nonExistent}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(notFoundRes.status, 404);
    });

    it("retrieves simulated quote snapshot with bid/ask prices", async () => {
      const inst = await createTestInstrument({
        symbol: "SBIN",
        lastPricePaise: 820_000,
        bidPricePaise: 819_900,
        askPricePaise: 820_100,
      });

      const res = await fetch(
        `${baseUrl}/api/v1/instruments/${inst._id.toString()}/quote`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.quote.symbol, "SBIN");
      assert.equal(json.data.quote.lastPricePaise, 820_000);
      assert.equal(json.data.quote.bidPricePaise, 819_900);
      assert.equal(json.data.quote.askPricePaise, 820_100);
      assert.equal(json.data.quote.quoteSource, "SIMULATED");
    });
  });

  describe("3. Watchlist Lifecycle (CRUD, Reordering & Capacity)", () => {
    it("adds instruments, prevents duplicates, enriches with quotes, and deletes cleanly", async () => {
      const inst1 = await createTestInstrument({ symbol: "TATAMOTORS" });
      const inst2 = await createTestInstrument({ symbol: "WIPRO" });

      // Initially empty
      const emptyRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(emptyRes.status, 200);
      const emptyJson = await emptyRes.json();
      assert.equal(emptyJson.data.count, 0);

      // Add item 1
      const add1 = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: inst1._id.toString() }),
      });
      assert.equal(add1.status, 201);
      const add1Json = await add1.json();
      assert.equal(add1Json.data.item.symbol, "TATAMOTORS");
      assert.equal(add1Json.data.item.sortOrder, 0);

      // Add duplicate item 1 -> 409
      const dup = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: inst1._id.toString() }),
      });
      assert.equal(dup.status, 409);

      // Add item 2
      const add2 = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: inst2._id.toString() }),
      });
      assert.equal(add2.status, 201);
      const add2Json = await add2.json();
      assert.equal(add2Json.data.item.symbol, "WIPRO");
      assert.equal(add2Json.data.item.sortOrder, 1);

      // Reorder items
      const reorderRes = await fetch(`${baseUrl}/api/v1/watchlist/reorder`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instrumentIds: [inst2._id.toString(), inst1._id.toString()],
        }),
      });
      assert.equal(reorderRes.status, 200);
      const reorderJson = await reorderRes.json();
      assert.equal(reorderJson.data.items[0].symbol, "WIPRO");
      assert.equal(reorderJson.data.items[0].sortOrder, 0);
      assert.equal(reorderJson.data.items[1].symbol, "TATAMOTORS");
      assert.equal(reorderJson.data.items[1].sortOrder, 1);

      // Remove item 2
      const deleteRes = await fetch(
        `${baseUrl}/api/v1/watchlist/items/${inst2._id.toString()}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      assert.equal(deleteRes.status, 200);

      // Verify compacted sort order
      const finalRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const finalJson = await finalRes.json();
      assert.equal(finalJson.data.count, 1);
      assert.equal(finalJson.data.items[0].symbol, "TATAMOTORS");
      assert.equal(finalJson.data.items[0].sortOrder, 0);
    });

    it("enforces 50-item maximum watchlist limit per user", async () => {
      // Seed 50 watchlist items
      const instruments: Array<Types.ObjectId> = [];
      const bulkWatchlist = [];
      for (let i = 0; i < 50; i++) {
        const instId = new Types.ObjectId();
        instruments.push(instId);
        bulkWatchlist.push({
          userId: testUserId,
          instrumentId: instId,
          symbolSnapshot: `SYM${i}`,
          sortOrder: i,
        });
      }
      await WatchlistItemModel.insertMany(bulkWatchlist);

      // Attempt 51st item
      const extraInst = await createTestInstrument({ symbol: "EXTRA" });
      const overLimitRes = await fetch(`${baseUrl}/api/v1/watchlist/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrumentId: extraInst._id.toString() }),
      });

      assert.equal(overLimitRes.status, 400);
      const overLimitJson = await overLimitRes.json();
      assert.equal(overLimitJson.error.code, "WATCHLIST_CAPACITY_EXCEEDED");
    });
  });
});

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose, { Types } from "mongoose";
import { createApp } from "../../app";
import { connectDatabase } from "../../config/database";
import { createAuthMiddleware } from "../../modules/auth/auth.middleware";
import { JwtService } from "../../modules/auth/jwt.service";
import { SessionModel } from "../../modules/auth/session.model";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { MarketCandleModel } from "../../modules/market-candles/market-candle.model";
import { MarketIndexCandleModel } from "../../modules/market-candles/market-index-candle.model";
import { MarketDataController } from "../../modules/market-indices/market-data.controller";
import { createMarketDataRouter } from "../../modules/market-indices/market-data.routes";
import { MarketIndexModel } from "../../modules/market-indices/market-index.model";
import { Router } from "express";
import { MarketSimulationEngine } from "../../modules/market-simulation/market-simulation.engine";
import {
  MarketSimulationRepositoryPort,
  MarketSimulationService,
  MongooseMarketSimulationRepository,
} from "../../modules/market-simulation/market-simulation.service";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { runDatabaseInitialization } from "../../../scripts/db-init";
import { runInstrumentSeed } from "../../../scripts/seed-instruments";
import { runMarketHistorySeed } from "../../../scripts/seed-market-history";
import {
  clearDatabase,
  createTestAccount,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

function createDeterministicRng(seed = 4040): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("Milestone 4 — Historical Candles & Synthetic Market Indices (Replica-Set Integration)", () => {
  let originalMongoUrl: string | undefined;
  let testNivoraUri: string;

  const initialSeedTime = new Date("2026-11-16T09:15:00.000Z");
  const testJwtSecret = "secret32charsminimum_1234567890!";

  const buildTestEnvConfig = () => ({
    nodeEnv: "development" as const,
    isProduction: false,
    port: 5000,
    mongoUrl: testNivoraUri,
    frontendUrl: "http://localhost:3000",
    dashboardUrl: "http://localhost:3001",
    allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
    otpSecret: testJwtSecret,
    brevoApiKey: "mock-key",
    brevoSenderEmail: "noreply@nivora.in",
    brevoSenderName: "NIVORA",
    jwtAccessSecret: testJwtSecret,
    jwtIssuer: "nivora-api",
    jwtAudience: "nivora-client",
  });

  before(async () => {
    originalMongoUrl = process.env.MONGO_URL;
    delete process.env.MONGO_URL;
    await setupIntegrationTestDb();
    await clearDatabase();

    const currentUri =
      mongoose.connection.getClient().options.srvHost ||
      (mongoose.connection as unknown as { _connectionString: string })
        ._connectionString;
    const parsedUrl = new URL(currentUri);
    parsedUrl.pathname = "/Nivora";
    testNivoraUri = parsedUrl.toString();

    await mongoose.disconnect();

    await runDatabaseInitialization({
      config: buildTestEnvConfig(),
      requireStrictRole: false,
      verbose: false,
    });
  });

  after(async () => {
    if (originalMongoUrl) {
      process.env.MONGO_URL = originalMongoUrl;
    }
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await connectDatabase(testNivoraUri, false);
    await clearDatabase();
    await mongoose.disconnect();

    await runInstrumentSeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      priceUpdatedAt: initialSeedTime,
      requireStrictRole: false,
      verbose: false,
    });

    await connectDatabase(testNivoraUri, false);
  });

  it("seeds synthetic market indices and historical candles idempotently (--dry-run vs --apply)", async () => {
    await mongoose.disconnect();

    // 1. Dry-run performs zero writes
    const dryRunRes = await runMarketHistorySeed({
      mode: "dry-run",
      config: buildTestEnvConfig(),
      dailyTradingDays: 6,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 15,
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(dryRunRes.mode, "dry-run");
    assert.equal(dryRunRes.finalCounts.marketIndices, 0);
    assert.equal(dryRunRes.finalCounts.marketCandles, 0);
    assert.equal(dryRunRes.finalCounts.marketIndexCandles, 0);

    // 2. Apply mode inserts 2 indices, equity candles (50 * 6 daily + 50 * 2 * 15 1m = 1800),
    // and index candles (2 * 6 daily + 2 * 2 * 15 1m = 72)
    const applyRes = await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 6,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 15,
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(applyRes.mode, "apply");
    assert.equal(applyRes.indicesInsertedCount, 2);
    assert.equal(applyRes.equityCandlesInsertedCount, 50 * 6 + 50 * 2 * 15);
    assert.equal(applyRes.indexCandlesInsertedCount, 2 * 6 + 2 * 2 * 15);
    assert.equal(applyRes.finalCounts.marketIndices, 2);
    assert.equal(applyRes.finalCounts.marketCandles, 1800);
    assert.equal(applyRes.finalCounts.marketIndexCandles, 72);

    // 3. Re-running apply mode is 100% idempotent (0 new inserts, all existing preserved)
    const secondApplyRes = await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 6,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 15,
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(secondApplyRes.indicesInsertedCount, 0);
    assert.equal(secondApplyRes.indicesSkippedCount, 2);
    assert.equal(secondApplyRes.equityCandlesInsertedCount, 0);
    assert.equal(secondApplyRes.equityCandlesSkippedCount, 1800);
    assert.equal(secondApplyRes.indexCandlesInsertedCount, 0);
    assert.equal(secondApplyRes.indexCandlesSkippedCount, 72);

    await connectDatabase(testNivoraUri, false);
  });

  it("atomically updates equity quotes, equity 1m/1d candles, synthetic indices, and index 1m/1d candles across multiple ticks in the same minute bucket", async () => {
    await mongoose.disconnect();
    await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 5,
      intradayTradingDays: 1,
      intradayMinutesPerDay: 5,
      requireStrictRole: false,
      verbose: false,
    });
    await connectDatabase(testNivoraUri, false);

    // Execute 3 ticks inside the same 1-minute bucket: 11:00:05Z, 11:00:25Z, 11:00:50Z
    const tickTimes = [
      new Date("2026-11-16T11:00:05.000Z"),
      new Date("2026-11-16T11:00:25.000Z"),
      new Date("2026-11-16T11:00:50.000Z"),
    ];
    let clockIdx = 0;

    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(777),
      clockProvider: () => tickTimes[clockIdx],
      initialSentiment: "BULLISH",
    });
    const service = new MarketSimulationService({ engine });

    const tick1 = await service.executeTick();
    clockIdx = 1;
    const tick2 = await service.executeTick();
    clockIdx = 2;
    const tick3 = await service.executeTick();

    assert.equal(tick1.executed, true);
    assert.equal(tick2.executed, true);
    assert.equal(tick3.executed, true);
    assert.equal(tick1.updatedIndexCount, 2);
    assert.equal(tick3.updatedIndexCount, 2);

    // Verify RELIANCE 1m candle for 11:00:00.000Z reflects open from tick1, close from tick3, and max/min across all 3 ticks
    const r1 = tick1.updates.find((u) => u.symbol === "RELIANCE")!;
    const r2 = tick2.updates.find((u) => u.symbol === "RELIANCE")!;
    const r3 = tick3.updates.find((u) => u.symbol === "RELIANCE")!;

    const relianceMinCandle = await MarketCandleModel.findOne({
      instrumentId: r1.instrumentId,
      interval: "1m",
      openTime: new Date("2026-11-16T11:00:00.000Z"),
    }).lean();

    assert.ok(relianceMinCandle);
    assert.equal(relianceMinCandle.openPaise, r1.nextLastPricePaise);
    assert.equal(relianceMinCandle.closePaise, r3.nextLastPricePaise);
    assert.equal(
      relianceMinCandle.highPaise,
      Math.max(
        r1.nextLastPricePaise,
        r2.nextLastPricePaise,
        r3.nextLastPricePaise
      )
    );
    assert.equal(
      relianceMinCandle.lowPaise,
      Math.min(
        r1.nextLastPricePaise,
        r2.nextLastPricePaise,
        r3.nextLastPricePaise
      )
    );

    // Verify NIFTY50 1m index candle for 11:00:00.000Z reflects open from tick1, close from tick3, and max/min across all 3 ticks
    const n1 = tick1.indexUpdates!.find((u) => u.symbol === "NIFTY50")!;
    const n2 = tick2.indexUpdates!.find((u) => u.symbol === "NIFTY50")!;
    const n3 = tick3.indexUpdates!.find((u) => u.symbol === "NIFTY50")!;

    const niftyDoc = await MarketIndexModel.findOne({
      symbol: "NIFTY50",
    }).lean();
    assert.ok(niftyDoc);
    assert.equal(niftyDoc.currentValue, n3.nextValue);
    assert.equal(niftyDoc.valueUpdatedAt.getTime(), tickTimes[2].getTime());

    const niftyMinCandle = await MarketIndexCandleModel.findOne({
      indexId: n1.indexId,
      interval: "1m",
      openTime: new Date("2026-11-16T11:00:00.000Z"),
    }).lean();

    assert.ok(niftyMinCandle);
    assert.equal(niftyMinCandle.openValue, n1.nextValue);
    assert.equal(niftyMinCandle.closeValue, n3.nextValue);
    assert.equal(
      niftyMinCandle.highValue,
      Math.max(n1.nextValue, n2.nextValue, n3.nextValue)
    );
    assert.equal(
      niftyMinCandle.lowValue,
      Math.min(n1.nextValue, n2.nextValue, n3.nextValue)
    );
  });

  it("updates seeded IST daily candles in-place on live ticks (never duplicates) and separates 18:29:59Z vs 18:30:00Z into distinct IST calendar days", async () => {
    await mongoose.disconnect();
    await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 5,
      intradayTradingDays: 1,
      intradayMinutesPerDay: 375,
      referenceDate: new Date("2026-11-16T00:00:00.000Z"),
      requireStrictRole: false,
      verbose: false,
    });
    await connectDatabase(testNivoraUri, false);

    const reliance = await InstrumentModel.findOne({ symbol: "RELIANCE" })
      .select({ _id: 1, symbol: 1 })
      .lean<{ _id: Types.ObjectId; symbol: string }>()
      .exec();
    assert.ok(reliance);

    const niftyIndex = await MarketIndexModel.findOne({ symbol: "NIFTY50" })
      .select({ _id: 1, symbol: 1 })
      .lean<{ _id: Types.ObjectId; symbol: string }>()
      .exec();
    assert.ok(niftyIndex);

    const nov16DailyOpenTime = new Date("2026-11-15T18:30:00.000Z"); // 2026-11-16 00:00:00 IST
    const nov17DailyOpenTime = new Date("2026-11-16T18:30:00.000Z"); // 2026-11-17 00:00:00 IST

    // Seeded Nov 16 daily candles exist at 2026-11-15T18:30:00.000Z before live ticks
    const seededRelianceDaily = await MarketCandleModel.findOne({
      instrumentId: reliance._id,
      interval: "1d",
      openTime: nov16DailyOpenTime,
    }).lean();
    assert.ok(seededRelianceDaily);

    const seededNiftyDaily = await MarketIndexCandleModel.findOne({
      indexId: niftyIndex._id,
      interval: "1d",
      openTime: nov16DailyOpenTime,
    }).lean();
    assert.ok(seededNiftyDaily);

    const initialDailyCountReliance = await MarketCandleModel.countDocuments({
      instrumentId: reliance._id,
      interval: "1d",
    });
    const initialDailyCountNifty = await MarketIndexCandleModel.countDocuments({
      indexId: niftyIndex._id,
      interval: "1d",
    });
    assert.equal(initialDailyCountReliance, 5);
    assert.equal(initialDailyCountNifty, 5);

    // Execute live ticks:
    // - Tick 1 at 2026-11-16T11:00:00Z (16:30:00 IST Nov 16) -> must update seeded Nov 16 document
    // - Tick 2 at 2026-11-16T18:29:59Z (23:59:59 IST Nov 16) -> must ALSO update seeded Nov 16 document
    // - Tick 3 at 2026-11-16T18:30:00Z (00:00:00 IST Nov 17) -> must create Nov 17 IST document
    // - Tick 4 at 2026-11-17T01:15:00Z (06:45:00 IST Nov 17, after UTC midnight) -> must update SAME Nov 17 IST document
    const clockSequence = [
      new Date("2026-11-16T11:00:00.000Z"),
      new Date("2026-11-16T18:29:59.000Z"),
      new Date("2026-11-16T18:30:00.000Z"),
      new Date("2026-11-17T01:15:00.000Z"),
    ];
    let clockIdx = 0;

    const service = new MarketSimulationService({
      engine: new MarketSimulationEngine({
        randomSource: createDeterministicRng(909),
        clockProvider: () => clockSequence[clockIdx],
        initialSentiment: "BULLISH",
      }),
    });

    const t1 = await service.executeTick();
    clockIdx = 1;
    const t2 = await service.executeTick();

    // Still strictly 5 daily docs for RELIANCE and NIFTY50 (updated seeded Nov 16 doc in place!)
    assert.equal(
      await MarketCandleModel.countDocuments({
        instrumentId: reliance._id,
        interval: "1d",
      }),
      5
    );
    assert.equal(
      await MarketIndexCandleModel.countDocuments({
        indexId: niftyIndex._id,
        interval: "1d",
      }),
      5
    );

    const relTick1 = t1.updates.find((u) => u.symbol === "RELIANCE")!;
    const relTick2 = t2.updates.find((u) => u.symbol === "RELIANCE")!;
    const niftyTick1 = t1.indexUpdates!.find((u) => u.symbol === "NIFTY50")!;
    const niftyTick2 = t2.indexUpdates!.find((u) => u.symbol === "NIFTY50")!;

    const updatedNov16Reliance = await MarketCandleModel.findOne({
      instrumentId: reliance._id,
      interval: "1d",
      openTime: nov16DailyOpenTime,
    }).lean();
    assert.ok(updatedNov16Reliance);
    assert.equal(
      updatedNov16Reliance._id.toString(),
      seededRelianceDaily._id.toString()
    );
    assert.equal(updatedNov16Reliance.openPaise, seededRelianceDaily.openPaise);
    assert.equal(updatedNov16Reliance.closePaise, relTick2.nextLastPricePaise);
    assert.equal(
      updatedNov16Reliance.highPaise,
      Math.max(
        seededRelianceDaily.highPaise,
        relTick1.nextLastPricePaise,
        relTick2.nextLastPricePaise
      )
    );
    assert.equal(
      updatedNov16Reliance.lowPaise,
      Math.min(
        seededRelianceDaily.lowPaise,
        relTick1.nextLastPricePaise,
        relTick2.nextLastPricePaise
      )
    );

    const updatedNov16Nifty = await MarketIndexCandleModel.findOne({
      indexId: niftyIndex._id,
      interval: "1d",
      openTime: nov16DailyOpenTime,
    }).lean();
    assert.ok(updatedNov16Nifty);
    assert.equal(
      updatedNov16Nifty._id.toString(),
      seededNiftyDaily._id.toString()
    );
    assert.equal(updatedNov16Nifty.openValue, seededNiftyDaily.openValue);
    assert.equal(updatedNov16Nifty.closeValue, niftyTick2.nextValue);
    assert.equal(
      updatedNov16Nifty.highValue,
      Math.max(
        seededNiftyDaily.highValue,
        niftyTick1.nextValue,
        niftyTick2.nextValue
      )
    );
    assert.equal(
      updatedNov16Nifty.lowValue,
      Math.min(
        seededNiftyDaily.lowValue,
        niftyTick1.nextValue,
        niftyTick2.nextValue
      )
    );

    // Tick 3 (18:30:00Z = Nov 17 00:00 IST) creates Nov 17 doc; Tick 4 (01:15:00Z Nov 17) updates that SAME Nov 17 doc
    clockIdx = 2;
    const t3 = await service.executeTick();
    clockIdx = 3;
    const t4 = await service.executeTick();

    assert.equal(
      await MarketCandleModel.countDocuments({
        instrumentId: reliance._id,
        interval: "1d",
      }),
      6
    );
    assert.equal(
      await MarketIndexCandleModel.countDocuments({
        indexId: niftyIndex._id,
        interval: "1d",
      }),
      6
    );

    const relTick3 = t3.updates.find((u) => u.symbol === "RELIANCE")!;
    const relTick4 = t4.updates.find((u) => u.symbol === "RELIANCE")!;

    const nov17Reliance = await MarketCandleModel.findOne({
      instrumentId: reliance._id,
      interval: "1d",
      openTime: nov17DailyOpenTime,
    }).lean();
    assert.ok(nov17Reliance);
    assert.equal(nov17Reliance.openPaise, relTick3.nextLastPricePaise);
    assert.equal(nov17Reliance.closePaise, relTick4.nextLastPricePaise);
  });

  it("rolls back equity quotes, equity candles, market indices, and index candles if an error occurs mid-tick", async () => {
    await mongoose.disconnect();
    await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 5,
      intradayTradingDays: 1,
      intradayMinutesPerDay: 5,
      requireStrictRole: false,
      verbose: false,
    });
    await connectDatabase(testNivoraUri, false);

    const beforeNifty = await MarketIndexModel.findOne({
      symbol: "NIFTY50",
    }).lean();
    assert.ok(beforeNifty);

    const realRepo = new MongooseMarketSimulationRepository();
    const failingRepo: MarketSimulationRepositoryPort = {
      findAllInstruments: (opts) => realRepo.findAllInstruments(opts),
      applyBulkQuoteUpdates: (updates, opts) =>
        realRepo.applyBulkQuoteUpdates(updates, opts),
      upsertBulkEquityCandles: (updates, ts, opts) =>
        realRepo.upsertBulkEquityCandles(updates, ts, opts),
      findAllMarketIndices: (opts) => realRepo.findAllMarketIndices(opts),
      applyBulkIndexUpdates: async (updates, opts) => {
        await realRepo.applyBulkIndexUpdates(updates, opts);
        throw new Error("SIMULATED_INDEX_CANDLE_WRITE_FAILURE");
      },
    };

    const failTickTime = new Date("2026-11-16T12:00:10.000Z");
    const service = new MarketSimulationService({
      engine: new MarketSimulationEngine({
        randomSource: createDeterministicRng(888),
        clockProvider: () => failTickTime,
      }),
      repository: failingRepo,
    });

    await assert.rejects(
      async () => {
        await service.executeTick();
      },
      { message: /SIMULATED_INDEX_CANDLE_WRITE_FAILURE/ }
    );

    const afterNifty = await MarketIndexModel.findOne({
      symbol: "NIFTY50",
    }).lean();
    assert.ok(afterNifty);
    assert.equal(afterNifty.currentValue, beforeNifty.currentValue);

    const abortedCandleCount = await MarketCandleModel.countDocuments({
      openTime: new Date("2026-11-16T12:00:00.000Z"),
    });
    assert.equal(abortedCandleCount, 0);
  });

  it("serves read-only market index and candle endpoints (/api/v1/market/...) and prevents indices from being traded", async () => {
    await mongoose.disconnect();
    await runMarketHistorySeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      dailyTradingDays: 10,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 30,
      requireStrictRole: false,
      verbose: false,
    });
    await connectDatabase(testNivoraUri, false);

    // Create authenticated test user & session
    const user = await createTestUser({
      email: "market.api.reader@nivora.app",
    });
    const account = await createTestAccount(user._id);
    const now = new Date();
    const sessionDoc = await SessionModel.create({
      userId: user._id,
      currentRefreshTokenHash: "a".repeat(64),
      status: "ACTIVE",
      ipAddress: "127.0.0.1",
      userAgent: "node-test",
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + 3_600_000),
      absoluteExpiresAt: new Date(now.getTime() + 7_200_000),
    });

    const jwtService = new JwtService({
      accessSecret: testJwtSecret,
      issuer: "nivora-api",
      audience: "nivora-client",
    });
    const accessToken = jwtService.generateAccessToken({
      userId: user._id.toString(),
      sessionId: sessionDoc._id.toString(),
    });

    const testRouter = Router();
    testRouter.use(
      "/api/v1/market",
      createAuthMiddleware(jwtService),
      createMarketDataRouter(new MarketDataController())
    );

    const app = createApp({
      isProduction: false,
      allowedOrigins: ["http://localhost:3000"],
      router: testRouter,
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
    };

    try {
      // 1. GET /api/v1/market/indices
      const listRes = await fetch(`${baseUrl}/api/v1/market/indices`, {
        headers: authHeaders,
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as any;
      assert.equal(listBody.success, true);
      assert.equal(listBody.data.items.length, 2);
      assert.equal(listBody.data.items[0].symbol, "NIFTY50");
      assert.equal(listBody.data.items[0].constituentCount, 50);
      assert.equal(listBody.data.items[0].source, "SIMULATED");
      assert.equal(listBody.data.items[1].symbol, "SENSEX");
      assert.equal(listBody.data.items[1].constituentCount, 30);

      // 2. GET /api/v1/market/indices/NIFTY50
      const detailRes = await fetch(
        `${baseUrl}/api/v1/market/indices/NIFTY50`,
        { headers: authHeaders }
      );
      assert.equal(detailRes.status, 200);
      const detailBody = (await detailRes.json()) as any;
      assert.equal(detailBody.data.index.symbol, "NIFTY50");
      assert.equal(detailBody.data.index.constituents.length, 50);

      // Unknown index symbol -> 400 INVALID_INDEX_SYMBOL
      const badSymRes = await fetch(
        `${baseUrl}/api/v1/market/indices/BANKNIFTY`,
        { headers: authHeaders }
      );
      assert.equal(badSymRes.status, 400);
      const badSymBody = (await badSymRes.json()) as any;
      assert.equal(badSymBody.error.code, "INVALID_INDEX_SYMBOL");

      // 3. GET /api/v1/market/indices/NIFTY50/candles across 1d, 1m, 5m, 15m, 1h
      for (const interval of ["1d", "1m", "5m", "15m", "1h"]) {
        const candleRes = await fetch(
          `${baseUrl}/api/v1/market/indices/NIFTY50/candles?interval=${interval}&limit=10`,
          { headers: authHeaders }
        );
        assert.equal(candleRes.status, 200);
        const candleBody = (await candleRes.json()) as any;
        assert.equal(candleBody.data.interval, interval);
        assert.ok(candleBody.data.candles.length >= 1);
        assert.ok(candleBody.data.candles.length <= 10);

        // Verify chronological ascending order and OHLC invariants
        const candles = candleBody.data.candles;
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i];
          assert.ok(c.lowValue <= c.openValue && c.openValue <= c.highValue);
          assert.ok(c.lowValue <= c.closeValue && c.closeValue <= c.highValue);
          if (i > 0) {
            assert.ok(
              new Date(c.openTime).getTime() >
                new Date(candles[i - 1].openTime).getTime()
            );
          }
        }
      }

      // 4. GET /api/v1/market/instruments/:instrumentId/candles across 1d, 1m, 5m, 15m, 1h
      const reliance = await InstrumentModel.findOne({
        symbol: "RELIANCE",
      })
        .select({ _id: 1, symbol: 1 })
        .lean<{ _id: Types.ObjectId; symbol: string }>()
        .exec();
      assert.ok(reliance);
      const relianceIdStr = reliance._id.toString();

      for (const interval of ["1d", "1m", "5m", "15m", "1h"]) {
        const eqRes = await fetch(
          `${baseUrl}/api/v1/market/instruments/${relianceIdStr}/candles?interval=${interval}&limit=10`,
          { headers: authHeaders }
        );
        assert.equal(eqRes.status, 200);
        const eqBody = (await eqRes.json()) as any;
        assert.equal(eqBody.data.instrument.symbol, "RELIANCE");
        assert.equal(eqBody.data.interval, interval);
        assert.ok(eqBody.data.candles.length >= 1);

        const candles = eqBody.data.candles;
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i];
          assert.ok(c.lowPaise <= c.openPaise && c.openPaise <= c.highPaise);
          assert.ok(c.lowPaise <= c.closePaise && c.closePaise <= c.highPaise);
        }
      }

      // Unknown instrument ObjectId -> 404 INSTRUMENT_NOT_FOUND
      const unknownId = new Types.ObjectId().toString();
      const notFoundRes = await fetch(
        `${baseUrl}/api/v1/market/instruments/${unknownId}/candles?interval=1d`,
        { headers: authHeaders }
      );
      assert.equal(notFoundRes.status, 404);

      // Date-only IST calendar query: from=2026-11-16&to=2026-11-16 returns ONLY 2026-11-16 IST daily bar (openTime 2026-11-15T18:30:00.000Z)
      const dateOnlyRes = await fetch(
        `${baseUrl}/api/v1/market/instruments/${relianceIdStr}/candles?interval=1d&from=2026-11-16&to=2026-11-16`,
        { headers: authHeaders }
      );
      assert.equal(dateOnlyRes.status, 200);
      const dateOnlyBody = (await dateOnlyRes.json()) as any;
      assert.equal(dateOnlyBody.data.candles.length, 1);
      assert.equal(
        dateOnlyBody.data.candles[0].openTime,
        "2026-11-15T18:30:00.000Z"
      );
      assert.equal(
        dateOnlyBody.data.candles[0].closeTime,
        "2026-11-16T18:30:00.000Z"
      );

      // Invalid interval -> 400 INVALID_CANDLE_INTERVAL
      const badIntervalRes = await fetch(
        `${baseUrl}/api/v1/market/instruments/${reliance._id.toString()}/candles?interval=2m`,
        { headers: authHeaders }
      );
      assert.equal(badIntervalRes.status, 400);
      const badIntervalBody = (await badIntervalRes.json()) as any;
      assert.equal(badIntervalBody.error.code, "INVALID_CANDLE_INTERVAL");

      // 5. Verify synthetic market indices cannot be bought or sold as tradable equities
      const niftyDoc = await MarketIndexModel.findOne({
        symbol: "NIFTY50",
      }).lean();
      assert.ok(niftyDoc);

      const orderService = new OrderExecutionService();
      await assert.rejects(
        async () => {
          await orderService.executeMarketOrder({
            userId: user._id,
            practiceAccountId: account._id,
            instrumentId: niftyDoc._id,
            side: "BUY",
            quantity: 1,
            idempotencyKey: "attempt-buy-nifty50-index",
          });
        },
        {
          message: /not found/i,
        }
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

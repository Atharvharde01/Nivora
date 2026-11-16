import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { connectDatabase } from "../../config/database";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { MarketSimulationEngine } from "../../modules/market-simulation/market-simulation.engine";
import { MarketSimulationScheduler } from "../../modules/market-simulation/market-simulation.scheduler";
import {
  MarketSimulationRepositoryPort,
  MarketSimulationService,
  MongooseMarketSimulationRepository,
} from "../../modules/market-simulation/market-simulation.service";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { runDatabaseInitialization } from "../../../scripts/db-init";
import { runInstrumentSeed } from "../../../scripts/seed-instruments";
import {
  clearDatabase,
  createTestAccount,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

function createDeterministicRng(seed = 2026): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("Milestone 3 — Simulated Equity Market Engine (Real Replica-Set Integration)", () => {
  let originalMongoUrl: string | undefined;
  let testNivoraUri: string;

  const initialSeedTime = new Date("2026-11-16T09:15:00.000Z");

  const buildTestEnvConfig = () => ({
    nodeEnv: "development" as const,
    isProduction: false,
    port: 5000,
    mongoUrl: testNivoraUri,
    frontendUrl: "http://localhost:3000",
    dashboardUrl: "http://localhost:3001",
    allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
    otpSecret: "secret32charsminimum_1234567890!",
    brevoApiKey: "mock-key",
    brevoSenderEmail: "noreply@nivora.in",
    brevoSenderName: "NIVORA",
    jwtAccessSecret: "secret32charsminimum_1234567890!",
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
      (mongoose.connection as unknown as { _connectionString: string })._connectionString;
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

    // Seed fresh 50-stock NSE catalog before each test
    await runInstrumentSeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      priceUpdatedAt: initialSeedTime,
      requireStrictRole: false,
      verbose: false,
    });

    await connectDatabase(testNivoraUri, false);
  });

  it("updates all 50 seeded tradable instruments atomically, advances priceUpdatedAt, and preserves previousClosePaise and identity fields", async () => {
    const beforeDocs = await InstrumentModel.find({}).sort({ symbol: 1 }).lean();
    assert.equal(beforeDocs.length, 50);

    const tickTime = new Date("2026-11-16T09:15:05.000Z");
    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(101),
      clockProvider: () => tickTime,
      initialSentiment: "BULLISH",
    });
    const service = new MarketSimulationService({ engine });

    const tickResult = await service.executeTick();
    assert.equal(tickResult.executed, true);
    assert.equal(tickResult.updatedCount, 50);
    assert.equal(tickResult.skippedNonTradableCount, 0);
    assert.equal(tickResult.updates.length, 50);

    const afterDocs = await InstrumentModel.find({}).sort({ symbol: 1 }).lean();
    assert.equal(afterDocs.length, 50);

    let changedPriceCount = 0;
    for (let i = 0; i < 50; i++) {
      const beforeDoc = beforeDocs[i];
      const afterDoc = afterDocs[i];

      // Identity and baseline fields must remain 100% unchanged
      assert.equal(afterDoc.symbol, beforeDoc.symbol);
      assert.equal(afterDoc.name, beforeDoc.name);
      assert.equal(afterDoc.exchange, beforeDoc.exchange);
      assert.equal(afterDoc.isTradable, beforeDoc.isTradable);
      assert.equal(afterDoc.isStarterWatchlist, beforeDoc.isStarterWatchlist);
      assert.equal(
        afterDoc.previousClosePaise,
        beforeDoc.previousClosePaise,
        `previousClosePaise must remain unchanged for ${afterDoc.symbol}`
      );

      // Quote timestamp must advance to tickTime
      assert.equal(afterDoc.priceUpdatedAt.getTime(), tickTime.getTime());

      // Spread invariants
      assert.ok(afterDoc.bidPricePaise > 0);
      assert.ok(afterDoc.askPricePaise > 0);
      assert.ok(afterDoc.bidPricePaise <= afterDoc.lastPricePaise);
      assert.ok(afterDoc.lastPricePaise <= afterDoc.askPricePaise);

      if (afterDoc.lastPricePaise !== beforeDoc.lastPricePaise) {
        changedPriceCount++;
      }
    }

    assert.ok(
      changedPriceCount >= 40,
      `Expected majority of 50 stocks to change price in BULLISH tick, got ${changedPriceCount}`
    );
  });

  it("skips non-tradable instruments and leaves their persisted quote and timestamp untouched", async () => {
    const relianceBefore = await InstrumentModel.findOneAndUpdate(
      { exchange: "NSE", symbol: "RELIANCE" },
      { $set: { isTradable: false } },
      { new: true }
    ).lean();
    assert.ok(relianceBefore);

    const tickTime = new Date("2026-11-16T09:16:00.000Z");
    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(202),
      clockProvider: () => tickTime,
      initialSentiment: "BEARISH",
    });
    const service = new MarketSimulationService({ engine });

    const tickResult = await service.executeTick();
    assert.equal(tickResult.executed, true);
    assert.equal(tickResult.updatedCount, 49);
    assert.equal(tickResult.skippedNonTradableCount, 1);

    const relianceAfter = await InstrumentModel.findOne({
      exchange: "NSE",
      symbol: "RELIANCE",
    }).lean();
    assert.ok(relianceAfter);
    assert.equal(relianceAfter.lastPricePaise, relianceBefore.lastPricePaise);
    assert.equal(relianceAfter.bidPricePaise, relianceBefore.bidPricePaise);
    assert.equal(relianceAfter.askPricePaise, relianceBefore.askPricePaise);
    assert.equal(
      relianceAfter.priceUpdatedAt.getTime(),
      initialSeedTime.getTime(),
      "Non-tradable instrument priceUpdatedAt must not advance"
    );
  });

  it("rolls back all instrument updates atomically if a transaction error occurs mid-tick", async () => {
    const beforeSnapshot = await InstrumentModel.find({}).sort({ symbol: 1 }).lean();

    const realRepo = new MongooseMarketSimulationRepository();
    const failingRepo: MarketSimulationRepositoryPort = {
      findAllInstruments: (opts) => realRepo.findAllInstruments(opts),
      applyBulkQuoteUpdates: async (updates, opts) => {
        // Perform partial write of the first 25 instruments inside the session, then fail!
        const firstHalf = updates.slice(0, 25);
        await realRepo.applyBulkQuoteUpdates(firstHalf, opts);
        throw new Error("SIMULATED_MID_TICK_DATABASE_FAILURE");
      },
    };

    const service = new MarketSimulationService({
      engine: new MarketSimulationEngine({
        randomSource: createDeterministicRng(303),
        clockProvider: () => new Date("2026-11-16T09:17:00.000Z"),
        initialSentiment: "BULLISH",
      }),
      repository: failingRepo,
    });

    await assert.rejects(
      async () => {
        await service.executeTick();
      },
      { message: /SIMULATED_MID_TICK_DATABASE_FAILURE/ }
    );

    // Verify all 50 instruments rolled back to their exact pre-tick prices and timestamps
    const afterSnapshot = await InstrumentModel.find({}).sort({ symbol: 1 }).lean();
    for (let i = 0; i < 50; i++) {
      assert.equal(
        afterSnapshot[i].lastPricePaise,
        beforeSnapshot[i].lastPricePaise,
        `Instrument ${afterSnapshot[i].symbol} was not rolled back!`
      );
      assert.equal(
        afterSnapshot[i].priceUpdatedAt.getTime(),
        beforeSnapshot[i].priceUpdatedAt.getTime()
      );
    }
  });

  it("prevents overlapping concurrent ticks and manages scheduler start/stop/disabled states safely", async () => {
    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(404),
      clockProvider: () => new Date("2026-11-16T09:18:00.000Z"),
    });
    const service = new MarketSimulationService({ engine });

    // Launch two concurrent executeTick() calls
    const [firstResult, secondResult] = await Promise.all([
      service.executeTick(),
      service.executeTick(),
    ]);

    assert.equal(firstResult.executed, true);
    assert.equal(secondResult.executed, false);
    assert.equal(secondResult.skippedReason, "TICK_IN_PROGRESS");

    // Disabled scheduler performs zero market writes
    const countBeforeDisabled = await InstrumentModel.findOne({ symbol: "TCS" }).lean();
    const disabledScheduler = new MarketSimulationScheduler({
      service,
      enabled: false,
      intervalMs: 500,
    });
    assert.equal(disabledScheduler.start(), false);
    await disabledScheduler.stop();
    const countAfterDisabled = await InstrumentModel.findOne({ symbol: "TCS" }).lean();
    assert.equal(countAfterDisabled?.lastPricePaise, countBeforeDisabled?.lastPricePaise);

    // Enabled scheduler runs and stops cleanly
    const activeScheduler = new MarketSimulationScheduler({
      service,
      enabled: true,
      intervalMs: 500,
    });
    assert.equal(activeScheduler.start(), true);
    assert.equal(activeScheduler.start(), true); // idempotent
    await new Promise((resolve) => setTimeout(resolve, 650));
    await activeScheduler.stop();
    assert.equal(activeScheduler.isRunning(), false);
    assert.ok(activeScheduler.getStatus().completedTicks >= 1);
  });

  it("integrates seamlessly with InstrumentQuoteService and OrderExecutionService (BUY at updated ask, SELL at updated bid)", async () => {
    const tickTime = new Date("2026-11-16T09:20:00.000Z");
    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(505),
      clockProvider: () => tickTime,
      initialSentiment: "BULLISH",
    });
    const simService = new MarketSimulationService({ engine });

    const tickResult = await simService.executeTick();
    assert.equal(tickResult.executed, true);

    const hdfcUpdate = tickResult.updates.find((u) => u.symbol === "HDFCBANK");
    assert.ok(hdfcUpdate, "HDFCBANK update must exist");

    // 1. InstrumentQuoteService retrieves the latest simulated quote without mutating priceUpdatedAt
    const quoteService = new InstrumentQuoteService({
      nowProvider: () => new Date("2026-11-16T09:20:02.000Z"),
    });
    const quoteSnapshot = await quoteService.getQuoteByInstrumentId(
      hdfcUpdate.instrumentId,
      { requireFresh: true, requireTradable: true }
    );

    assert.equal(quoteSnapshot.quoteSource, "SIMULATED");
    assert.equal(quoteSnapshot.lastPricePaise, hdfcUpdate.nextLastPricePaise);
    assert.equal(quoteSnapshot.bidPricePaise, hdfcUpdate.nextBidPricePaise);
    assert.equal(quoteSnapshot.askPricePaise, hdfcUpdate.nextAskPricePaise);
    assert.equal(quoteSnapshot.priceUpdatedAt.getTime(), tickTime.getTime());
    assert.equal(quoteSnapshot.isStale, false);

    // 2. OrderExecutionService executes BUY at the updated askPricePaise and SELL at updated bidPricePaise
    const user = await createTestUser({ email: "market.engine.trader@nivora.app" });
    const account = await createTestAccount(user._id);
    const orderService = new OrderExecutionService({ quoteService });

    const buyResult = await orderService.executeMarketOrder(
      {
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: hdfcUpdate.instrumentId,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "market-sim-buy-hdfc-001",
      },
      { now: new Date("2026-11-16T09:20:03.000Z") }
    );

    assert.equal(buyResult.status, "EXECUTED");
    assert.equal(
      buyResult.order.executionPricePaise,
      hdfcUpdate.nextAskPricePaise,
      "BUY must execute strictly at updated simulated askPricePaise"
    );

    // Execute a second market tick and then SELL at the new bidPricePaise
    const secondTickTime = new Date("2026-11-16T09:20:10.000Z");
    const secondTick = await simService.executeTick({ now: secondTickTime });
    const hdfcSecondUpdate = secondTick.updates.find((u) => u.symbol === "HDFCBANK")!;

    const sellResult = await orderService.executeMarketOrder(
      {
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: hdfcUpdate.instrumentId,
        side: "SELL",
        quantity: 5,
        idempotencyKey: "market-sim-sell-hdfc-001",
      },
      { now: new Date("2026-11-16T09:20:11.000Z") }
    );

    assert.equal(sellResult.status, "EXECUTED");
    assert.equal(
      sellResult.order.executionPricePaise,
      hdfcSecondUpdate.nextBidPricePaise,
      "SELL must execute strictly at updated simulated bidPricePaise"
    );
  });
});

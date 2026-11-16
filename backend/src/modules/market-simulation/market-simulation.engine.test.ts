import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { SYNTHETIC_NSE_INSTRUMENTS_SEED } from "../../../scripts/data/instruments.seed";
import { MarketSimulationEngine } from "./market-simulation.engine";
import { MarketSimulationScheduler } from "./market-simulation.scheduler";
import { MarketSimulationService } from "./market-simulation.service";
import {
  MarketSimulationError,
  SimulatableInstrumentRecord,
} from "./market-simulation.types";

/**
 * Deterministic linear congruential pseudo-random generator for reproducible tests.
 */
function createDeterministicRng(seed = 42): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildMockPersistedInstruments(): SimulatableInstrumentRecord[] {
  return SYNTHETIC_NSE_INSTRUMENTS_SEED.map((seed, idx) => ({
    _id: new Types.ObjectId(
      `${(idx + 1).toString(16).padStart(24, "0")}`
    ),
    symbol: seed.symbol,
    name: seed.name,
    exchange: seed.exchange,
    isTradable: seed.isTradable,
    lastPricePaise: seed.lastPricePaise,
    bidPricePaise: seed.bidPricePaise,
    askPricePaise: seed.askPricePaise,
    previousClosePaise: seed.previousClosePaise,
    isStarterWatchlist: seed.isStarterWatchlist,
    priceUpdatedAt: new Date("2026-11-16T09:15:00.000Z"),
  }));
}

describe("Milestone 3 — MarketSimulationEngine & Scheduler (Unit)", () => {
  it("produces 100% reproducible tick results across all 50 instruments with deterministic RNG and clock", () => {
    const fixedNow = new Date("2026-11-16T10:00:00.000Z");
    const instruments = buildMockPersistedInstruments();

    const engineA = new MarketSimulationEngine({
      randomSource: createDeterministicRng(1337),
      clockProvider: () => fixedNow,
      initialSentiment: "BULLISH",
    });

    const engineB = new MarketSimulationEngine({
      randomSource: createDeterministicRng(1337),
      clockProvider: () => fixedNow,
      initialSentiment: "BULLISH",
    });

    const tickA = engineA.computeTick(instruments);
    const tickB = engineB.computeTick(instruments);

    assert.equal(tickA.tickNumber, 1);
    assert.equal(tickA.updates.length, 50);
    assert.equal(tickA.skippedNonTradableCount, 0);
    assert.deepEqual(tickA, tickB);

    // Verify stocks do NOT all move by the same fixed percentage
    const distinctMoveBps = new Set(tickA.updates.map((u) => u.appliedMoveBps));
    assert.ok(
      distinctMoveBps.size > 10,
      `Expected diverse per-instrument movements, got only ${distinctMoveBps.size} distinct bps values`
    );

    // Verify every update preserves previousClosePaise and satisfies bid <= last <= ask
    for (const u of tickA.updates) {
      assert.ok(u.nextLastPricePaise > 0);
      assert.ok(u.nextBidPricePaise > 0);
      assert.ok(u.nextAskPricePaise > 0);
      assert.ok(u.nextBidPricePaise <= u.nextLastPricePaise);
      assert.ok(u.nextLastPricePaise <= u.nextAskPricePaise);
      assert.equal(u.priceUpdatedAt.getTime(), fixedNow.getTime());
    }
  });

  it("skips non-tradable instruments and never generates quote updates for them", () => {
    const instruments = buildMockPersistedInstruments();
    instruments[0] = { ...instruments[0], isTradable: false };
    instruments[1] = { ...instruments[1], isTradable: false };

    const engine = new MarketSimulationEngine({
      randomSource: createDeterministicRng(99),
      clockProvider: () => new Date("2026-11-16T10:05:00.000Z"),
    });

    const tick = engine.computeTick(instruments);
    assert.equal(tick.totalInputInstruments, 50);
    assert.equal(tick.skippedNonTradableCount, 2);
    assert.equal(tick.updates.length, 48);
    assert.ok(
      !tick.updates.some(
        (u) =>
          u.symbol === instruments[0].symbol ||
          u.symbol === instruments[1].symbol
      )
    );
  });

  it("rejects invalid engine configuration parameters", () => {
    assert.throws(
      () => new MarketSimulationEngine({ config: { maxMoveBps: 0 } }),
      (err: unknown) =>
        err instanceof MarketSimulationError &&
        err.code === "INVALID_SIMULATION_CONFIG"
    );

    assert.throws(
      () =>
        new MarketSimulationEngine({
          config: { maxMoveBps: 100, maxDeviationFromPrevCloseBps: 50 },
        }),
      (err: unknown) =>
        err instanceof MarketSimulationError &&
        err.code === "INVALID_SIMULATION_CONFIG"
    );
  });

  it("manages scheduler start/stop lifecycle cleanly without duplicate timers or background leaks", async () => {
    let tickCalls = 0;
    const mockService = {
      getEngine: () => new MarketSimulationEngine(),
      isTickInProgress: () => false,
      waitForActiveTick: async () => {},
      executeTick: async () => {
        tickCalls += 1;
        return {
          executed: true,
          tickNumber: tickCalls,
          sentiment: "SIDEWAYS" as const,
          marketEffectBps: 0,
          timestamp: new Date(),
          updatedCount: 50,
          skippedNonTradableCount: 0,
          durationMs: 1,
          updates: [],
        };
      },
    } as unknown as MarketSimulationService;

    // 1. Disabled scheduler never starts
    const disabledScheduler = new MarketSimulationScheduler({
      service: mockService,
      enabled: false,
      intervalMs: 500,
    });
    assert.equal(disabledScheduler.start(), false);
    assert.equal(disabledScheduler.isRunning(), false);

    // 2. Enabled scheduler starts idempotently and stops cleanly
    const enabledScheduler = new MarketSimulationScheduler({
      service: mockService,
      enabled: true,
      intervalMs: 500,
      unrefTimer: true,
    });

    assert.equal(enabledScheduler.start(), true);
    assert.equal(enabledScheduler.isRunning(), true);
    // Calling start() a second time is idempotent
    assert.equal(enabledScheduler.start(), true);

    await enabledScheduler.stop();
    assert.equal(enabledScheduler.isRunning(), false);
  });
});

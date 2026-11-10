import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  DEFAULT_SIMULATED_QUOTE_MAX_AGE_MS,
  InstrumentQuoteService,
  validateInstrumentQuoteRecord,
} from "./instrument-quote.service";
import {
  InstrumentQuoteError,
  InstrumentQuoteLookupPort,
  PersistedInstrumentQuoteRecord,
  SIMULATED_QUOTE_SOURCE,
} from "./instrument-quote.types";

function makePersistedRecord(
  overrides: Partial<PersistedInstrumentQuoteRecord> = {}
): PersistedInstrumentQuoteRecord {
  return {
    _id: new Types.ObjectId("65f1a2b3c4d5e6f7a8b9c0d1"),
    symbol: "RELIANCE",
    exchange: "NSE",
    isTradable: true,
    lastPricePaise: 250_250,
    bidPricePaise: 250_000,
    askPricePaise: 250_500,
    previousClosePaise: 248_000,
    priceUpdatedAt: new Date("2026-11-10T10:00:00.000Z"),
    ...overrides,
  };
}

function createMockRepository(
  record: PersistedInstrumentQuoteRecord | null
): InstrumentQuoteLookupPort & { calls: Types.ObjectId[] } {
  const calls: Types.ObjectId[] = [];
  return {
    calls,
    async findById(instrumentId: Types.ObjectId) {
      calls.push(instrumentId);
      return record;
    },
  };
}

describe("Task 17 — Instrument Quote Service", () => {
  const fixedNow = new Date("2026-11-10T10:05:00.000Z"); // 5 minutes after 10:00:00Z

  it("returns a valid simulated quote snapshot with quoteSource = SIMULATED", async () => {
    const persisted = makePersistedRecord({
      symbol: "  tcs  ",
      exchange: "nse" as any,
    });
    const repo = createMockRepository(persisted);
    const service = new InstrumentQuoteService({
      repository: repo,
      nowProvider: () => fixedNow,
    });

    const quote = await service.getQuoteByInstrumentId(persisted._id);
    assert.equal(quote.instrumentId.toString(), persisted._id.toString());
    assert.equal(quote.symbol, "TCS");
    assert.equal(quote.exchange, "NSE");
    assert.equal(quote.isTradable, true);
    assert.equal(quote.lastPricePaise, 250_250);
    assert.equal(quote.bidPricePaise, 250_000);
    assert.equal(quote.askPricePaise, 250_500);
    assert.equal(quote.previousClosePaise, 248_000);
    assert.equal(quote.quoteSource, SIMULATED_QUOTE_SOURCE);
    assert.equal(quote.quoteSource, "SIMULATED");
    assert.equal(quote.quoteAgeMs, 5 * 60 * 1_000);
    assert.equal(quote.isStale, false);
    assert.equal(repo.calls.length, 1);
  });

  it("accepts lastPricePaise below bidPricePaise or above askPricePaise as long as bid <= ask", async () => {
    const belowBid = makePersistedRecord({
      lastPricePaise: 249_000,
      bidPricePaise: 250_000,
      askPricePaise: 250_500,
    });
    const aboveAsk = makePersistedRecord({
      lastPricePaise: 252_000,
      bidPricePaise: 250_000,
      askPricePaise: 250_500,
    });

    const snapBelow = validateInstrumentQuoteRecord(belowBid, { now: fixedNow });
    assert.equal(snapBelow.lastPricePaise, 249_000);

    const snapAbove = validateInstrumentQuoteRecord(aboveAsk, { now: fixedNow });
    assert.equal(snapAbove.lastPricePaise, 252_000);
  });

  it("throws INSTRUMENT_NOT_FOUND when the instrument does not exist and INVALID_INSTRUMENT_ID on bad IDs", async () => {
    const repo = createMockRepository(null);
    const service = new InstrumentQuoteService({
      repository: repo,
      nowProvider: () => fixedNow,
    });

    await assert.rejects(
      () => service.getQuoteByInstrumentId(new Types.ObjectId()),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INSTRUMENT_NOT_FOUND"
    );

    await assert.rejects(
      () => service.getQuoteByInstrumentId("not-a-valid-object-id"),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INVALID_INSTRUMENT_ID"
    );
  });

  it("rejects invalid lastPricePaise, bidPricePaise, askPricePaise, and bid > ask", async () => {
    const badNumbers = [
      0,
      -100,
      125.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const bad of badNumbers) {
      for (const field of [
        "lastPricePaise",
        "bidPricePaise",
        "askPricePaise",
      ] as const) {
        const record = makePersistedRecord({ [field]: bad });
        assert.throws(
          () => validateInstrumentQuoteRecord(record, { now: fixedNow }),
          (err: unknown) =>
            err instanceof InstrumentQuoteError &&
            err.code === "INVALID_QUOTE_DATA"
        );
      }
    }

    // bidPricePaise > askPricePaise
    const invertedSpread = makePersistedRecord({
      bidPricePaise: 251_000,
      askPricePaise: 250_500,
    });
    assert.throws(
      () => validateInstrumentQuoteRecord(invertedSpread, { now: fixedNow }),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INVALID_QUOTE_DATA"
    );
  });

  it("rejects invalid or future priceUpdatedAt timestamps", () => {
    const invalidDateRecord = makePersistedRecord({
      priceUpdatedAt: new Date("invalid-date"),
    });
    assert.throws(
      () => validateInstrumentQuoteRecord(invalidDateRecord, { now: fixedNow }),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INVALID_QUOTE_DATA"
    );

    const futureDateRecord = makePersistedRecord({
      priceUpdatedAt: new Date(fixedNow.getTime() + 1_000),
    });
    assert.throws(
      () => validateInstrumentQuoteRecord(futureDateRecord, { now: fixedNow }),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INVALID_QUOTE_DATA"
    );
  });

  it("detects stale quotes and enforces exact freshness boundary", async () => {
    const maxAgeMs = 60_000; // 60 seconds
    const quoteTime = new Date("2026-11-10T10:00:00.000Z");
    const record = makePersistedRecord({ priceUpdatedAt: quoteTime });
    const repo = createMockRepository(record);

    // 1. Exactly at boundary (quoteAgeMs === maxAgeMs = 60_000): fresh (isStale === false)
    const boundaryNow = new Date(quoteTime.getTime() + maxAgeMs);
    const serviceAtBoundary = new InstrumentQuoteService({
      repository: repo,
      nowProvider: () => boundaryNow,
      defaultMaxQuoteAgeMs: maxAgeMs,
    });
    const freshBoundaryQuote = await serviceAtBoundary.getQuoteByInstrumentId(
      record._id,
      { requireFresh: true }
    );
    assert.equal(freshBoundaryQuote.quoteAgeMs, maxAgeMs);
    assert.equal(freshBoundaryQuote.isStale, false);

    // 2. 1 ms past boundary (quoteAgeMs = 60_001 > 60_000): stale (isStale === true)
    const pastBoundaryNow = new Date(quoteTime.getTime() + maxAgeMs + 1);
    const servicePastBoundary = new InstrumentQuoteService({
      repository: repo,
      nowProvider: () => pastBoundaryNow,
      defaultMaxQuoteAgeMs: maxAgeMs,
    });

    // When requireFresh is false/omitted, returns snapshot with isStale = true
    const staleSnapshot = await servicePastBoundary.getQuoteByInstrumentId(
      record._id
    );
    assert.equal(staleSnapshot.isStale, true);
    assert.equal(staleSnapshot.quoteAgeMs, maxAgeMs + 1);

    // When requireFresh is true, throws STALE_QUOTE
    await assert.rejects(
      () =>
        servicePastBoundary.getQuoteByInstrumentId(record._id, {
          requireFresh: true,
        }),
      (err: unknown) =>
        err instanceof InstrumentQuoteError && err.code === "STALE_QUOTE"
    );
  });

  it("distinguishes tradable vs non-tradable instruments and resolves BUY/SELL executable quotes", async () => {
    const nonTradable = makePersistedRecord({ isTradable: false });
    const nonTradableService = new InstrumentQuoteService({
      repository: createMockRepository(nonTradable),
      nowProvider: () => fixedNow,
    });

    // Passive read succeeds with isTradable: false
    const passiveSnapshot = await nonTradableService.getQuoteByInstrumentId(
      nonTradable._id
    );
    assert.equal(passiveSnapshot.isTradable, false);

    // Requiring tradability throws INSTRUMENT_UNAVAILABLE
    await assert.rejects(
      () =>
        nonTradableService.getQuoteByInstrumentId(nonTradable._id, {
          requireTradable: true,
        }),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INSTRUMENT_UNAVAILABLE"
    );
    await assert.rejects(
      () => nonTradableService.getExecutableQuote(nonTradable._id, "BUY"),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INSTRUMENT_UNAVAILABLE"
    );

    // Tradable instrument resolves BUY at askPricePaise and SELL at bidPricePaise
    const tradable = makePersistedRecord({
      isTradable: true,
      lastPricePaise: 250_250,
      bidPricePaise: 250_000,
      askPricePaise: 250_500,
    });
    const tradableService = new InstrumentQuoteService({
      repository: createMockRepository(tradable),
      nowProvider: () => fixedNow,
      defaultMaxQuoteAgeMs: DEFAULT_SIMULATED_QUOTE_MAX_AGE_MS,
    });

    const buyExec = await tradableService.getExecutableQuote(
      tradable._id,
      "BUY"
    );
    assert.equal(buyExec.executionPricePaise, 250_500);
    assert.equal(buyExec.snapshot.quoteSource, "SIMULATED");
    assert.deepEqual(buyExec.tradeQuoteSnapshot, {
      lastPricePaise: 250_250,
      bidPricePaise: 250_000,
      askPricePaise: 250_500,
      priceUpdatedAt: tradable.priceUpdatedAt,
    });

    const sellExec = await tradableService.getExecutableQuote(
      tradable._id,
      "SELL"
    );
    assert.equal(sellExec.executionPricePaise, 250_000);
    assert.equal(sellExec.snapshot.quoteSource, "SIMULATED");
  });

  it("never mutates persisted instrument prices or priceUpdatedAt during quote retrieval", async () => {
    const originalTimestamp = new Date("2026-11-10T10:00:00.000Z");
    const persisted = makePersistedRecord({
      lastPricePaise: 150_000,
      bidPricePaise: 149_900,
      askPricePaise: 150_100,
      priceUpdatedAt: new Date(originalTimestamp.getTime()),
    });

    const service = new InstrumentQuoteService({
      repository: createMockRepository(persisted),
      nowProvider: () => fixedNow,
    });

    const snapshot = await service.getQuoteByInstrumentId(persisted._id);

    // Attempting to mutate the returned snapshot throws because it is frozen,
    // and the underlying persisted record remains completely unchanged.
    assert.throws(() => {
      (snapshot as any).lastPricePaise = 999_999;
    });
    snapshot.priceUpdatedAt.setFullYear(2099);

    assert.equal(persisted.lastPricePaise, 150_000);
    assert.equal(persisted.bidPricePaise, 149_900);
    assert.equal(persisted.askPricePaise, 150_100);
    assert.equal(
      persisted.priceUpdatedAt.getTime(),
      originalTimestamp.getTime()
    );
  });
});

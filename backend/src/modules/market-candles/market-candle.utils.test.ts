import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { MarketCandleModel } from "./market-candle.model";
import { MarketIndexCandleModel } from "./market-index-candle.model";
import { MarketCandleError } from "./market-candle.types";
import {
  aggregateEquityCandlesToInterval,
  aggregateIndexCandlesToInterval,
  assertValidCandleInterval,
  assertValidOhlcValues,
  getCandleTimeBucket,
  getIstDailyBucket,
  parseMarketQueryDate,
} from "./market-candle.utils";

describe("Milestone 4 — Market Candles & Aggregation Utilities (Unit)", () => {
  it("computes aligned UTC buckets for 1m, 5m, 15m, session-anchored 1h (09:15 IST), and IST 1d intervals", () => {
    const sampleTime = new Date("2026-11-16T09:37:42.819Z"); // 15:07:42.819 IST

    const b1m = getCandleTimeBucket(sampleTime, "1m");
    assert.equal(b1m.openTime.toISOString(), "2026-11-16T09:37:00.000Z");
    assert.equal(b1m.closeTime.toISOString(), "2026-11-16T09:38:00.000Z");
    assert.equal(b1m.durationMs, 60_000);

    const b5m = getCandleTimeBucket(sampleTime, "5m");
    assert.equal(b5m.openTime.toISOString(), "2026-11-16T09:35:00.000Z");
    assert.equal(b5m.closeTime.toISOString(), "2026-11-16T09:40:00.000Z");
    assert.equal(b5m.durationMs, 300_000);

    const b15m = getCandleTimeBucket(sampleTime, "15m");
    assert.equal(b15m.openTime.toISOString(), "2026-11-16T09:30:00.000Z");
    assert.equal(b15m.closeTime.toISOString(), "2026-11-16T09:45:00.000Z");
    assert.equal(b15m.durationMs, 900_000);

    // 15:07:42 IST falls inside 14:15-15:15 IST (= 08:45:00Z-09:45:00Z)
    const b1h = getCandleTimeBucket(sampleTime, "1h");
    assert.equal(b1h.openTime.toISOString(), "2026-11-16T08:45:00.000Z");
    assert.equal(b1h.closeTime.toISOString(), "2026-11-16T09:45:00.000Z");
    assert.equal(b1h.durationMs, 3_600_000);

    // 16 Nov 2026 IST daily bucket -> 2026-11-15T18:30:00.000Z to 2026-11-16T18:30:00.000Z
    const b1d = getCandleTimeBucket(sampleTime, "1d");
    assert.equal(b1d.openTime.toISOString(), "2026-11-15T18:30:00.000Z");
    assert.equal(b1d.closeTime.toISOString(), "2026-11-16T18:30:00.000Z");
    assert.equal(b1d.durationMs, 86_400_000);
  });

  it("places 18:29:59Z and 18:30:00Z into distinct IST daily buckets and handles UTC-midnight rollover without date shift", () => {
    const beforeIstMidnight = getIstDailyBucket(
      new Date("2026-11-16T18:29:59.000Z")
    ); // 2026-11-16 23:59:59 IST
    const atIstMidnight = getIstDailyBucket(
      new Date("2026-11-16T18:30:00.000Z")
    ); // 2026-11-17 00:00:00 IST
    const afterUtcMidnight = getIstDailyBucket(
      new Date("2026-11-17T01:15:00.000Z")
    ); // 2026-11-17 06:45:00 IST

    assert.equal(beforeIstMidnight.tradingDateIst, "2026-11-16");
    assert.equal(
      beforeIstMidnight.openTime.toISOString(),
      "2026-11-15T18:30:00.000Z"
    );
    assert.equal(
      beforeIstMidnight.closeTime.toISOString(),
      "2026-11-16T18:30:00.000Z"
    );

    assert.equal(atIstMidnight.tradingDateIst, "2026-11-17");
    assert.equal(
      atIstMidnight.openTime.toISOString(),
      "2026-11-16T18:30:00.000Z"
    );
    assert.equal(
      atIstMidnight.closeTime.toISOString(),
      "2026-11-17T18:30:00.000Z"
    );

    // Before vs after UTC midnight on the same IST morning share the exact same IST daily bucket
    assert.equal(afterUtcMidnight.tradingDateIst, "2026-11-17");
    assert.equal(
      afterUtcMidnight.openTime.getTime(),
      atIstMidnight.openTime.getTime()
    );

    // Date-only query parsing adheres strictly to IST calendar boundaries
    const queryStart = parseMarketQueryDate("2026-11-16", "start");
    const queryEnd = parseMarketQueryDate("2026-11-16", "end");
    assert.equal(queryStart?.toISOString(), "2026-11-15T18:30:00.000Z");
    assert.equal(queryEnd?.toISOString(), "2026-11-16T18:29:59.999Z");
    assert.equal(parseMarketQueryDate("2026-02-30", "start"), null);
  });

  it("enforces OHLC invariants and rejects invalid intervals, timestamps, or non-integer values", () => {
    assert.throws(
      () => assertValidCandleInterval("3m"),
      (err: unknown) =>
        err instanceof MarketCandleError &&
        err.code === "INVALID_CANDLE_INTERVAL"
    );

    assert.throws(
      () => getCandleTimeBucket(new Date("invalid"), "1m"),
      (err: unknown) =>
        err instanceof MarketCandleError &&
        err.code === "INVALID_CANDLE_TIMESTAMP"
    );

    assert.doesNotThrow(() =>
      assertValidOhlcValues(10000, 10500, 9800, 10200, "paise")
    );

    assert.throws(
      () => assertValidOhlcValues(10000.5, 10500, 9800, 10200, "paise"),
      (err: unknown) =>
        err instanceof MarketCandleError && err.code === "INVALID_CANDLE_OHLC"
    );

    assert.throws(
      () => assertValidOhlcValues(0, 10500, 0, 10200, "paise"),
      (err: unknown) =>
        err instanceof MarketCandleError && err.code === "INVALID_CANDLE_OHLC"
    );

    assert.throws(
      () => assertValidOhlcValues(10000, 10500, 10100, 10200, "paise"),
      (err: unknown) =>
        err instanceof MarketCandleError && err.code === "INVALID_CANDLE_OHLC"
    );

    assert.throws(
      () => assertValidOhlcValues(10000, 10100, 9800, 10200, "paise"),
      (err: unknown) =>
        err instanceof MarketCandleError && err.code === "INVALID_CANDLE_OHLC"
    );
  });

  it("validates MarketCandleModel and MarketIndexCandleModel Mongoose schemas strictly", () => {
    const instrumentId = new Types.ObjectId();
    const indexId = new Types.ObjectId();
    const openTime = new Date("2026-11-16T03:45:00.000Z");
    const closeTime = new Date("2026-11-16T03:46:00.000Z");

    const validEquityCandle = new MarketCandleModel({
      instrumentId,
      interval: "1m",
      openTime,
      closeTime,
      openPaise: 254000,
      highPaise: 254500,
      lowPaise: 253800,
      closePaise: 254200,
      source: "SIMULATED",
    });
    assert.equal(validEquityCandle.validateSync(), undefined);

    const badEquityCandle = new MarketCandleModel({
      instrumentId,
      interval: "1m",
      openTime,
      closeTime,
      openPaise: 254000,
      highPaise: 254100,
      lowPaise: 253800,
      closePaise: 254500,
      source: "SIMULATED",
    });
    assert.ok(badEquityCandle.validateSync() !== undefined);

    const validIndexCandle = new MarketIndexCandleModel({
      indexId,
      interval: "1m",
      openTime,
      closeTime,
      openValue: 2400000,
      highValue: 2405000,
      lowValue: 2398000,
      closeValue: 2402500,
      source: "SIMULATED",
    });
    assert.equal(validIndexCandle.validateSync(), undefined);

    const badIndexCandle = new MarketIndexCandleModel({
      indexId,
      interval: "1m",
      openTime,
      closeTime: openTime,
      openValue: 2400000,
      highValue: 2405000,
      lowValue: 2398000,
      closeValue: 2402500,
      source: "SIMULATED",
    });
    assert.ok(badIndexCandle.validateSync() !== undefined);
  });

  it("aggregates full 375-minute Indian trading session (03:45Z-10:00Z) into 5m, 15m, session-anchored 1h (including 15:15-15:30 IST partial candle), and IST 1d intervals", () => {
    const instrumentId = new Types.ObjectId();
    const indexId = new Types.ObjectId();
    const sessionStartMs = new Date("2026-11-16T03:45:00.000Z").getTime();

    // Generate all 375 1-minute candles (03:45:00Z to 10:00:00Z = 09:15 to 15:30 IST)
    const equityOneMin = [];
    const indexOneMin = [];

    for (let i = 0; i < 375; i++) {
      const openTime = new Date(sessionStartMs + i * 60_000);
      const closeTime = new Date(sessionStartMs + (i + 1) * 60_000);
      const openPaise = 100000 + i * 10;
      const closePaise = 100000 + (i + 1) * 10;
      const highPaise = closePaise + 25;
      const lowPaise = openPaise - 15;

      equityOneMin.push({
        instrumentId,
        openTime,
        closeTime,
        openPaise,
        highPaise,
        lowPaise,
        closePaise,
      });

      indexOneMin.push({
        indexId,
        openTime,
        closeTime,
        openValue: 2400000 + i * 100,
        highValue: 2400000 + (i + 1) * 100 + 50,
        lowValue: 2400000 + i * 100 - 50,
        closeValue: 2400000 + (i + 1) * 100,
      });
    }

    // 1. 5m rollup -> 75 bars (03:45Z .. 10:00Z)
    const eq5m = aggregateEquityCandlesToInterval(equityOneMin, "5m");
    assert.equal(eq5m.length, 75);
    assert.equal(eq5m[0].openTime.toISOString(), "2026-11-16T03:45:00.000Z");
    assert.equal(eq5m[0].closeTime.toISOString(), "2026-11-16T03:50:00.000Z");
    assert.equal(eq5m[74].openTime.toISOString(), "2026-11-16T09:55:00.000Z");
    assert.equal(eq5m[74].closeTime.toISOString(), "2026-11-16T10:00:00.000Z");

    // 2. 15m rollup -> 25 bars
    const eq15m = aggregateEquityCandlesToInterval(equityOneMin, "15m");
    assert.equal(eq15m.length, 25);
    assert.equal(eq15m[0].openTime.toISOString(), "2026-11-16T03:45:00.000Z");
    assert.equal(eq15m[24].closeTime.toISOString(), "2026-11-16T10:00:00.000Z");

    // 3. Session-anchored 1h rollup -> exact 7 bars anchored to 09:15 IST (03:45Z), with 7th partial bar 09:45Z-10:00Z
    const expectedHourlyBounds: Array<[string, string]> = [
      ["2026-11-16T03:45:00.000Z", "2026-11-16T04:45:00.000Z"], // 09:15-10:15 IST
      ["2026-11-16T04:45:00.000Z", "2026-11-16T05:45:00.000Z"], // 10:15-11:15 IST
      ["2026-11-16T05:45:00.000Z", "2026-11-16T06:45:00.000Z"], // 11:15-12:15 IST
      ["2026-11-16T06:45:00.000Z", "2026-11-16T07:45:00.000Z"], // 12:15-13:15 IST
      ["2026-11-16T07:45:00.000Z", "2026-11-16T08:45:00.000Z"], // 13:15-14:15 IST
      ["2026-11-16T08:45:00.000Z", "2026-11-16T09:45:00.000Z"], // 14:15-15:15 IST
      ["2026-11-16T09:45:00.000Z", "2026-11-16T10:00:00.000Z"], // 15:15-15:30 IST (partial final candle)
    ];

    const eq1h = aggregateEquityCandlesToInterval(equityOneMin, "1h");
    const idx1h = aggregateIndexCandlesToInterval(indexOneMin, "1h");
    assert.equal(eq1h.length, 7);
    assert.equal(idx1h.length, 7);

    for (let h = 0; h < 7; h++) {
      assert.equal(eq1h[h].openTime.toISOString(), expectedHourlyBounds[h][0]);
      assert.equal(eq1h[h].closeTime.toISOString(), expectedHourlyBounds[h][1]);
      assert.equal(idx1h[h].openTime.toISOString(), expectedHourlyBounds[h][0]);
      assert.equal(idx1h[h].closeTime.toISOString(), expectedHourlyBounds[h][1]);
    }
    // Check OHLC of partial 7th bar (minutes 360..374)
    assert.equal(eq1h[6].openPaise, equityOneMin[360].openPaise);
    assert.equal(eq1h[6].closePaise, equityOneMin[374].closePaise);

    // 4. IST 1d rollup -> 2026-11-15T18:30:00.000Z to 2026-11-16T18:30:00.000Z
    const eq1d = aggregateEquityCandlesToInterval(equityOneMin, "1d");
    const idx1d = aggregateIndexCandlesToInterval(indexOneMin, "1d");
    assert.equal(eq1d.length, 1);
    assert.equal(eq1d[0].openTime.toISOString(), "2026-11-15T18:30:00.000Z");
    assert.equal(eq1d[0].closeTime.toISOString(), "2026-11-16T18:30:00.000Z");
    assert.equal(eq1d[0].openPaise, equityOneMin[0].openPaise);
    assert.equal(eq1d[0].closePaise, equityOneMin[374].closePaise);

    assert.equal(idx1d.length, 1);
    assert.equal(idx1d[0].openTime.toISOString(), "2026-11-15T18:30:00.000Z");
    assert.equal(idx1d[0].closeTime.toISOString(), "2026-11-16T18:30:00.000Z");

    // 5. If 24x7 live 1m candle extends past 10:00Z into 10:05Z (within 09:45Z-10:45Z slot), 7th bar expands to 10:45Z
    const extendedOneMin = [
      ...equityOneMin,
      {
        instrumentId,
        openTime: new Date("2026-11-16T10:05:00.000Z"),
        closeTime: new Date("2026-11-16T10:06:00.000Z"),
        openPaise: 103760,
        highPaise: 103800,
        lowPaise: 103700,
        closePaise: 103790,
      },
    ];
    const extended1h = aggregateEquityCandlesToInterval(extendedOneMin, "1h");
    assert.equal(extended1h[6].openTime.toISOString(), "2026-11-16T09:45:00.000Z");
    assert.equal(extended1h[6].closeTime.toISOString(), "2026-11-16T10:45:00.000Z");
  });
});

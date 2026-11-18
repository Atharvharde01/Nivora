import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { SYNTHETIC_NSE_INSTRUMENTS_SEED } from "../../../scripts/data/instruments.seed";
import {
  buildIndianTradingSessionsUtc,
  buildWeekdayTradingDaysUtc,
  DEFAULT_HISTORY_DAILY_TRADING_DAYS,
  DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY,
  DEFAULT_HISTORY_INTRADAY_TRADING_DAYS,
  generateDeterministicMarketHistory,
  runMarketHistorySeed,
} from "../../../scripts/seed-market-history";
import {
  aggregateEquityCandlesToInterval,
  aggregateIndexCandlesToInterval,
  getCandleTimeBucket,
} from "../../modules/market-candles/market-candle.utils";
import { InstrumentForIndexSeed } from "../../modules/market-indices/market-index.utils";

function buildMockInstruments(): InstrumentForIndexSeed[] {
  return SYNTHETIC_NSE_INSTRUMENTS_SEED.map((seed, idx) => ({
    _id: new Types.ObjectId(`${(idx + 1).toString(16).padStart(24, "0")}`),
    symbol: seed.symbol,
    exchange: seed.exchange,
    lastPricePaise: seed.lastPricePaise,
    previousClosePaise: seed.previousClosePaise,
  }));
}

describe("Milestone 4 — Deterministic Historical Market Data Generator (Unit)", () => {
  it("generates 90 weekday trading sessions on the Asia/Kolkata calendar with IST daily boundaries and 03:45Z-10:00Z session windows", () => {
    const sessions = buildIndianTradingSessionsUtc(
      90,
      new Date("2026-11-16T00:00:00.000Z")
    );
    assert.equal(sessions.length, 90);

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const [y, m, d] = s.tradingDateIst.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      assert.ok(
        dow >= 1 && dow <= 5,
        `Expected Asia/Kolkata weekday for ${s.tradingDateIst}, got day ${dow}`
      );
      assert.equal(
        s.sessionOpenTime.toISOString(),
        `${s.tradingDateIst}T03:45:00.000Z`
      );
      assert.equal(
        s.sessionCloseTime.toISOString(),
        `${s.tradingDateIst}T10:00:00.000Z`
      );

      // Daily bounds must match getCandleTimeBucket(..., "1d") of any timestamp inside that session
      const expectedDaily = getCandleTimeBucket(s.sessionOpenTime, "1d");
      assert.equal(
        s.dailyOpenTime.toISOString(),
        expectedDaily.openTime.toISOString()
      );
      assert.equal(
        s.dailyCloseTime.toISOString(),
        expectedDaily.closeTime.toISOString()
      );

      if (i > 0) {
        assert.ok(
          s.sessionOpenTime.getTime() >
            sessions[i - 1].sessionOpenTime.getTime(),
          "Trading sessions must be strictly chronological ascending"
        );
      }
    }

    // Verify exact example: 2026-11-16 IST -> daily open 2026-11-15T18:30:00.000Z, close 2026-11-16T18:30:00.000Z
    const nov16Session = sessions[sessions.length - 1];
    assert.equal(nov16Session.tradingDateIst, "2026-11-16");
    assert.equal(
      nov16Session.dailyOpenTime.toISOString(),
      "2026-11-15T18:30:00.000Z"
    );
    assert.equal(
      nov16Session.dailyCloseTime.toISOString(),
      "2026-11-16T18:30:00.000Z"
    );

    const days = buildWeekdayTradingDaysUtc(
      90,
      new Date("2026-11-16T00:00:00.000Z")
    );
    assert.equal(days.length, 90);
    assert.deepEqual(
      days.map((dt) => dt.toISOString()),
      sessions.map((s) => s.sessionOpenTime.toISOString())
    );
  });

  it("selects the 5 recent trading dates accurately using Asia/Kolkata across UTC midnight boundaries and weekends", () => {
    // 1. Sunday 20:00 UTC is already Monday 2026-11-16 01:30 IST in Asia/Kolkata
    const sundayUtcMondayIst = new Date("2026-11-15T20:00:00.000Z");
    const sessionsAcrossUtcMidnight = buildIndianTradingSessionsUtc(
      5,
      sundayUtcMondayIst
    );
    assert.deepEqual(
      sessionsAcrossUtcMidnight.map((s) => s.tradingDateIst),
      [
        "2026-11-10",
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
        "2026-11-16",
      ]
    );

    // 2. Monday 21:00 UTC is already Tuesday 2026-11-17 02:30 IST in Asia/Kolkata
    const mondayUtcTuesdayIst = new Date("2026-11-16T21:00:00.000Z");
    const sessionsNextDayIst = buildIndianTradingSessionsUtc(
      5,
      mondayUtcTuesdayIst
    );
    assert.deepEqual(
      sessionsNextDayIst.map((s) => s.tradingDateIst),
      [
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
        "2026-11-16",
        "2026-11-17",
      ]
    );

    // 3. Weekend reference date in IST skips Saturday/Sunday cleanly -> ends Friday 2026-11-13
    const weekendIst = new Date("2026-11-15T10:00:00.000Z");
    const sessionsOnWeekend = buildIndianTradingSessionsUtc(5, weekendIst);
    assert.deepEqual(
      sessionsOnWeekend.map((s) => s.tradingDateIst),
      [
        "2026-11-09",
        "2026-11-10",
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
      ]
    );
  });

  it("produces 100% reproducible historical equity and index candles where recent 1d candles match 1m rollups identically (including IST daily boundaries)", () => {
    const instruments = buildMockInstruments();

    const bundleA = generateDeterministicMarketHistory(instruments, {
      dailyTradingDays: 10,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 15,
      referenceDate: new Date("2026-11-16T00:00:00.000Z"),
      prngSeed: 20261116,
    });

    const bundleB = generateDeterministicMarketHistory(instruments, {
      dailyTradingDays: 10,
      intradayTradingDays: 2,
      intradayMinutesPerDay: 15,
      referenceDate: new Date("2026-11-16T00:00:00.000Z"),
      prngSeed: 20261116,
    });

    assert.equal(bundleA.indices.length, 2);
    assert.equal(bundleA.equityDailyCandles.length, 50 * 10);
    assert.equal(bundleA.equityOneMinuteCandles.length, 50 * 2 * 15);
    assert.equal(bundleA.indexDailyCandles.length, 2 * 10);
    assert.equal(bundleA.indexOneMinuteCandles.length, 2 * 2 * 15);

    assert.deepEqual(bundleA.equityDailyCandles, bundleB.equityDailyCandles);
    assert.deepEqual(
      bundleA.equityOneMinuteCandles,
      bundleB.equityOneMinuteCandles
    );
    assert.deepEqual(bundleA.indexDailyCandles, bundleB.indexDailyCandles);
    assert.deepEqual(
      bundleA.indexOneMinuteCandles,
      bundleB.indexOneMinuteCandles
    );

    // Recent 2 equity 1d candles match aggregateEquityCandlesToInterval(instMinCandles, "1d") 100% (both OHLC and timestamps!)
    const sampleInstrumentId = instruments[0]._id;
    const instMinCandles = bundleA.equityOneMinuteCandles.filter(
      (c) => String(c.instrumentId) === String(sampleInstrumentId)
    );
    const rolledDailyFromMin = aggregateEquityCandlesToInterval(
      instMinCandles,
      "1d"
    );
    assert.equal(rolledDailyFromMin.length, 2);

    const instDailyCandles = bundleA.equityDailyCandles
      .filter((c) => String(c.instrumentId) === String(sampleInstrumentId))
      .slice(-2);

    assert.deepEqual(instDailyCandles, rolledDailyFromMin);

    // Recent 2 NIFTY50 1d candles match aggregateIndexCandlesToInterval(niftyMinCandles, "1d") 100%
    const niftyId = bundleA.indexIdBySymbol.NIFTY50;
    const niftyMinCandles = bundleA.indexOneMinuteCandles.filter(
      (c) => String(c.indexId) === String(niftyId)
    );
    const rolledNiftyDaily = aggregateIndexCandlesToInterval(
      niftyMinCandles,
      "1d"
    );
    const niftyDailyLastTwo = bundleA.indexDailyCandles
      .filter((c) => String(c.indexId) === String(niftyId))
      .slice(-2);

    assert.deepEqual(niftyDailyLastTwo, rolledNiftyDaily);
  });

  it("generates complete 375-minute trading sessions (03:45Z-10:00Z), 90 IST daily candles (18:30Z-18:30Z), and 7 session-anchored 1h bars by default", () => {
    const instruments = buildMockInstruments();
    assert.equal(DEFAULT_HISTORY_DAILY_TRADING_DAYS, 90);
    assert.equal(DEFAULT_HISTORY_INTRADAY_TRADING_DAYS, 5);
    assert.equal(DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY, 375);

    const fullBundle = generateDeterministicMarketHistory(instruments);

    const expectedEquityDaily =
      instruments.length * DEFAULT_HISTORY_DAILY_TRADING_DAYS;
    const expectedEquityOneMin =
      instruments.length *
      DEFAULT_HISTORY_INTRADAY_TRADING_DAYS *
      DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY;
    const expectedIndexDaily =
      fullBundle.indices.length * DEFAULT_HISTORY_DAILY_TRADING_DAYS;
    const expectedIndexOneMin =
      fullBundle.indices.length *
      DEFAULT_HISTORY_INTRADAY_TRADING_DAYS *
      DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY;

    assert.equal(fullBundle.equityDailyCandles.length, expectedEquityDaily);
    assert.equal(fullBundle.equityOneMinuteCandles.length, expectedEquityOneMin);
    assert.equal(fullBundle.indexDailyCandles.length, expectedIndexDaily);
    assert.equal(fullBundle.indexOneMinuteCandles.length, expectedIndexOneMin);

    const expectedFiveTradingDates = [
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-16",
    ];
    const lastFiveSessions = fullBundle.tradingSessions.slice(-5);
    assert.deepEqual(
      lastFiveSessions.map((s) => s.tradingDateIst),
      expectedFiveTradingDates
    );

    const sampleInstId = instruments[0]._id;
    const instAllOneMin = fullBundle.equityOneMinuteCandles.filter(
      (c) => String(c.instrumentId) === String(sampleInstId)
    );
    assert.equal(instAllOneMin.length, 5 * 375);

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const tradingDate = expectedFiveTradingDates[dayIdx];
      const daySlice = instAllOneMin.slice(dayIdx * 375, (dayIdx + 1) * 375);
      assert.equal(daySlice.length, 375);
      assert.equal(
        daySlice[0].openTime.toISOString(),
        `${tradingDate}T03:45:00.000Z`
      );
      assert.equal(
        daySlice[0].closeTime.toISOString(),
        `${tradingDate}T03:46:00.000Z`
      );
      assert.equal(
        daySlice[374].openTime.toISOString(),
        `${tradingDate}T09:59:00.000Z`
      );
      assert.equal(
        daySlice[374].closeTime.toISOString(),
        `${tradingDate}T10:00:00.000Z`
      );
    }

    // Check all 90 daily candles use IST 00:00-24:00 boundaries in UTC (18:30Z prior UTC day -> 18:30Z current UTC day)
    const instAllDaily = fullBundle.equityDailyCandles.filter(
      (c) => String(c.instrumentId) === String(sampleInstId)
    );
    assert.equal(instAllDaily.length, 90);
    for (let d = 0; d < 90; d++) {
      const s = fullBundle.tradingSessions[d];
      assert.equal(
        instAllDaily[d].openTime.getTime(),
        s.dailyOpenTime.getTime()
      );
      assert.equal(
        instAllDaily[d].closeTime.getTime(),
        s.dailyCloseTime.getTime()
      );
    }

    // Check Nov 16 daily candle specifically
    const nov16Daily = instAllDaily[89];
    assert.equal(
      nov16Daily.openTime.toISOString(),
      "2026-11-15T18:30:00.000Z"
    );
    assert.equal(
      nov16Daily.closeTime.toISOString(),
      "2026-11-16T18:30:00.000Z"
    );

    // Verify 5m, 15m, and 09:15 IST-anchored 1h rollups on the 375m session
    const lastDayOneMin = instAllOneMin.slice(-375);
    assert.equal(aggregateEquityCandlesToInterval(lastDayOneMin, "5m").length, 75);
    assert.equal(aggregateEquityCandlesToInterval(lastDayOneMin, "15m").length, 25);

    const lastDayHourly = aggregateEquityCandlesToInterval(lastDayOneMin, "1h");
    assert.equal(lastDayHourly.length, 7);
    assert.equal(lastDayHourly[0].openTime.toISOString(), "2026-11-16T03:45:00.000Z");
    assert.equal(lastDayHourly[0].closeTime.toISOString(), "2026-11-16T04:45:00.000Z");
    assert.equal(lastDayHourly[6].openTime.toISOString(), "2026-11-16T09:45:00.000Z");
    assert.equal(lastDayHourly[6].closeTime.toISOString(), "2026-11-16T10:00:00.000Z");
  });

  it("enforces target database safety checks in runMarketHistorySeed before connecting", async () => {
    await assert.rejects(
      async () => {
        await runMarketHistorySeed({
          mode: "dry-run",
          config: {
            nodeEnv: "production",
            isProduction: true,
            port: 5000,
            mongoUrl:
              "mongodb+srv://user:pass@cluster.mongodb.net/Nivora?retryWrites=true&w=majority",
            frontendUrl: "https://app.nivora.in",
            dashboardUrl: "https://dashboard.nivora.in",
            allowedOrigins: ["https://app.nivora.in"],
            otpSecret: "secret32charsminimum_1234567890!",
            brevoApiKey: "mock-key",
            brevoSenderEmail: "noreply@nivora.in",
            brevoSenderName: "NIVORA",
            jwtAccessSecret: "secret32charsminimum_1234567890!",
            jwtIssuer: "nivora-api",
            jwtAudience: "nivora-client",
          },
          verbose: false,
        });
      },
      { message: /NODE_ENV must be 'development'/ }
    );

    await assert.rejects(
      async () => {
        await runMarketHistorySeed({
          mode: "dry-run",
          config: {
            nodeEnv: "development",
            isProduction: false,
            port: 5000,
            mongoUrl:
              "mongodb+srv://user:pass@cluster.mongodb.net/zerodha?retryWrites=true&w=majority",
            frontendUrl: "http://localhost:3000",
            dashboardUrl: "http://localhost:3001",
            allowedOrigins: ["http://localhost:3000"],
            otpSecret: "secret32charsminimum_1234567890!",
            brevoApiKey: "mock-key",
            brevoSenderEmail: "noreply@nivora.in",
            brevoSenderName: "NIVORA",
            jwtAccessSecret: "secret32charsminimum_1234567890!",
            jwtIssuer: "nivora-api",
            jwtAudience: "nivora-client",
          },
          verbose: false,
        });
      },
      { message: /MONGO_URL database path must be exactly '\/Nivora'/ }
    );
  });
});

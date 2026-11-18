import dotenv from "dotenv";
import mongoose, { Types } from "mongoose";
import { connectDatabase, DatabaseConnectionError } from "../src/config/database";
import { EnvConfig, loadEnvConfig } from "../src/config/env";
import { InstrumentModel } from "../src/modules/instruments/instrument.model";
import { MarketCandleModel } from "../src/modules/market-candles/market-candle.model";
import { MarketIndexCandleModel } from "../src/modules/market-candles/market-index-candle.model";
import {
  IMarketCandle,
  IMarketIndexCandle,
  SIMULATED_CANDLE_SOURCE,
} from "../src/modules/market-candles/market-candle.types";
import {
  aggregateEquityCandlesToInterval,
  aggregateIndexCandlesToInterval,
  assertValidOhlcValues,
  getCandleTimeBucket,
  getIstCalendarDateParts,
  getIstDailyBucketFromParts,
  IST_TIMEZONE,
  IST_UTC_OFFSET_MINUTES,
  IST_UTC_OFFSET_MS,
} from "../src/modules/market-candles/market-candle.utils";
import { MarketIndexModel } from "../src/modules/market-indices/market-index.model";
import {
  MARKET_INDEX_SYMBOLS,
  MarketIndexSymbol,
} from "../src/modules/market-indices/market-index.types";
import {
  buildMarketIndexSeedRecord,
  calculateSyntheticIndexValue,
  InstrumentForIndexSeed,
  MarketIndexSeedRecord,
} from "../src/modules/market-indices/market-index.utils";
import { getVolatilityProfileForSymbol } from "../src/modules/market-simulation/market-simulation.config";
import { roundToTickPaise } from "../src/modules/market-simulation/market-simulation.utils";
import { parseSeedCliArgs, SeedExecutionMode } from "./seed-instruments";

export const IST_OFFSET_MINUTES = IST_UTC_OFFSET_MINUTES;
export const IST_SESSION_START_HOUR = 9 as const;
export const IST_SESSION_START_MINUTE = 15 as const;

export const DEFAULT_HISTORY_DAILY_TRADING_DAYS = 90 as const;
export const DEFAULT_HISTORY_INTRADAY_TRADING_DAYS = 5 as const;
export const DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY = 375 as const;
export const DEFAULT_HISTORY_REFERENCE_DATE = new Date(
  "2026-11-16T00:00:00.000Z"
);
export const DEFAULT_HISTORY_PRNG_SEED = 20261116 as const;

export interface IndianTradingSessionUtc {
  readonly tradingDateIst: string;
  readonly dailyOpenTime: Date;
  readonly dailyCloseTime: Date;
  readonly sessionOpenTime: Date;
  readonly sessionCloseTime: Date;
}

export type EquityCandleSeedRecord = Omit<
  IMarketCandle,
  "createdAt" | "updatedAt"
>;

export type IndexCandleSeedRecord = Omit<
  IMarketIndexCandle,
  "createdAt" | "updatedAt"
>;

export interface GenerateMarketHistoryOptions {
  readonly dailyTradingDays?: number;
  readonly intradayTradingDays?: number;
  readonly intradayMinutesPerDay?: number;
  readonly referenceDate?: Date;
  readonly prngSeed?: number;
  readonly indexIdBySymbol?: Readonly<Record<MarketIndexSymbol, Types.ObjectId>>;
}

export interface GeneratedMarketHistoryBundle {
  readonly indices: readonly MarketIndexSeedRecord[];
  readonly indexIdBySymbol: Readonly<Record<MarketIndexSymbol, Types.ObjectId>>;
  readonly equityDailyCandles: readonly EquityCandleSeedRecord[];
  readonly equityOneMinuteCandles: readonly EquityCandleSeedRecord[];
  readonly indexDailyCandles: readonly IndexCandleSeedRecord[];
  readonly indexOneMinuteCandles: readonly IndexCandleSeedRecord[];
  readonly tradingDaysUtc: readonly Date[];
  readonly tradingSessions: readonly IndianTradingSessionUtc[];
}

export interface SeedMarketHistoryResult {
  readonly mode: SeedExecutionMode;
  readonly databaseName: string;
  readonly nodeEnv: string;
  readonly instrumentCount: number;
  readonly dailyTradingDays: number;
  readonly intradayTradingDays: number;
  readonly intradayMinutesPerDay: number;
  readonly indicesInsertedCount: number;
  readonly indicesSkippedCount: number;
  readonly equityCandlesInsertedCount: number;
  readonly equityCandlesSkippedCount: number;
  readonly indexCandlesInsertedCount: number;
  readonly indexCandlesSkippedCount: number;
  readonly finalCounts: {
    readonly marketIndices: number;
    readonly marketCandles: number;
    readonly marketIndexCandles: number;
  };
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Generates `count` weekday Indian equity trading sessions (`Monday..Friday` on the
 * `Asia/Kolkata` calendar) ending on or before `referenceDate` in `Asia/Kolkata`,
 * sorted chronologically ascending.
 *
 * Each session exposes both UTC conventions derived deterministically from the shared
 * `market-candle.utils.ts` helpers:
 * - Daily IST calendar boundaries (`dailyOpenTime`/`dailyCloseTime`):
 *   `D 00:00 IST` (`(D-1)T18:30:00.000Z`) to `(D+1) 00:00 IST` (`DT18:30:00.000Z`)
 * - Intraday session window (`sessionOpenTime`/`sessionCloseTime`):
 *   `09:15 IST` (`03:45:00.000Z`) to `15:30 IST` (`10:00:00.000Z`, 375 minutes)
 */
export function buildIndianTradingSessionsUtc(
  count: number,
  referenceDate: Date = DEFAULT_HISTORY_REFERENCE_DATE
): IndianTradingSessionUtc[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("count must be a positive safe integer.");
  }

  const { year, monthIndex0, day } = getIstCalendarDateParts(referenceDate);
  const istCalendarCursor = new Date(Date.UTC(year, monthIndex0, day, 0, 0, 0, 0));

  const sessions: IndianTradingSessionUtc[] = [];
  const sessionDurationMs = DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY * 60_000;

  while (sessions.length < count) {
    const dayOfWeek = istCalendarCursor.getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const y = istCalendarCursor.getUTCFullYear();
      const m = istCalendarCursor.getUTCMonth();
      const d = istCalendarCursor.getUTCDate();

      const dailyBucket = getIstDailyBucketFromParts(y, m, d);
      const sessionOpenMs =
        Date.UTC(y, m, d, IST_SESSION_START_HOUR, IST_SESSION_START_MINUTE, 0, 0) -
        IST_UTC_OFFSET_MS;

      sessions.push({
        tradingDateIst: dailyBucket.tradingDateIst,
        dailyOpenTime: dailyBucket.openTime,
        dailyCloseTime: dailyBucket.closeTime,
        sessionOpenTime: new Date(sessionOpenMs),
        sessionCloseTime: new Date(sessionOpenMs + sessionDurationMs),
      });
    }
    istCalendarCursor.setUTCDate(istCalendarCursor.getUTCDate() - 1);
  }

  return sessions.reverse();
}

/**
 * Returns `count` UTC session-open timestamps (`03:45:00.000Z` = `09:15 IST`)
 * corresponding to `Asia/Kolkata` weekday trading dates ending on or before `referenceDate`.
 */
export function buildWeekdayTradingDaysUtc(
  count: number,
  referenceDate: Date = DEFAULT_HISTORY_REFERENCE_DATE
): Date[] {
  return buildIndianTradingSessionsUtc(count, referenceDate).map(
    (s) => new Date(s.sessionOpenTime.getTime())
  );
}

function applyBasisPointsChangePaise(pricePaise: number, bps: number): number {
  const factorBps = BigInt(10_000 + bps);
  const rawBig = (BigInt(pricePaise) * factorBps + 5_000n) / 10_000n;
  return Number(rawBig < 1n ? 1n : rawBig);
}

function normalizeSimulatedPricePaise(rawPaise: number): number {
  const clamped = Math.max(100, Math.round(rawPaise));
  return roundToTickPaise(clamped, 5, 100);
}

/**
 * Pure deterministic generator for synthetic historical equity and index candles.
 *
 * Financial & Consistency Invariants:
 * 1. Every equity OHLC candle satisfies `lowPaise <= openPaise <= highPaise` and
 *    `lowPaise <= closePaise <= highPaise` with positive integer paise.
 * 2. For the recent `intradayTradingDays`, each equity's `"1d"` candle is aggregated
 *    directly from its `"1m"` candles on that day (`open`, `high`, `low`, `close` match 100%).
 * 3. Every synthetic index (`NIFTY50`, `SENSEX`) `"1m"` candle is derived directly from
 *    its constituent equities' `"1m"` candles at that exact UTC minute.
 * 4. For the recent `intradayTradingDays`, each index's `"1d"` candle is aggregated
 *    directly from its `"1m"` candles on that day.
 */
export function generateDeterministicMarketHistory(
  instruments: ReadonlyArray<InstrumentForIndexSeed>,
  options: GenerateMarketHistoryOptions = {}
): GeneratedMarketHistoryBundle {
  const dailyTradingDays =
    options.dailyTradingDays ?? DEFAULT_HISTORY_DAILY_TRADING_DAYS;
  const intradayTradingDays =
    options.intradayTradingDays ?? DEFAULT_HISTORY_INTRADAY_TRADING_DAYS;
  const intradayMinutesPerDay =
    options.intradayMinutesPerDay ?? DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY;
  const referenceDate = options.referenceDate ?? DEFAULT_HISTORY_REFERENCE_DATE;
  const prngSeed = options.prngSeed ?? DEFAULT_HISTORY_PRNG_SEED;

  if (
    !Number.isSafeInteger(dailyTradingDays) ||
    dailyTradingDays < 1 ||
    !Number.isSafeInteger(intradayTradingDays) ||
    intradayTradingDays < 1 ||
    intradayTradingDays > dailyTradingDays ||
    !Number.isSafeInteger(intradayMinutesPerDay) ||
    intradayMinutesPerDay < 1 ||
    intradayMinutesPerDay > 375
  ) {
    throw new Error(
      "Invalid historical generation window parameters: ensure 1 <= intradayTradingDays <= dailyTradingDays and 1 <= intradayMinutesPerDay <= 375."
    );
  }

  const rng = createSeededRng(prngSeed);
  const sortedInstruments = [...instruments].sort((a, b) =>
    a.symbol.localeCompare(b.symbol)
  );

  const tradingSessions = buildIndianTradingSessionsUtc(
    dailyTradingDays,
    referenceDate
  );
  const tradingDaysUtc = tradingSessions.map(
    (s) => new Date(s.sessionOpenTime.getTime())
  );
  const firstIntradayDayIndex = dailyTradingDays - intradayTradingDays;

  // Pre-generate shared daily market sentiment shocks in bps (-60..+65 bps)
  const dailyMarketShockBps: number[] = [];
  for (let d = 0; d < dailyTradingDays; d++) {
    const shock = Math.round((rng() * 2 - 0.96) * 62);
    dailyMarketShockBps.push(shock);
  }

  // Pre-generate shared intraday minute market shocks for recent intraday days (-12..+12 bps)
  const intradayMarketShockBps: number[][] = [];
  for (let d = 0; d < intradayTradingDays; d++) {
    const minuteShocks: number[] = [];
    for (let m = 0; m < intradayMinutesPerDay; m++) {
      minuteShocks.push(Math.round((rng() * 2 - 0.98) * 12));
    }
    intradayMarketShockBps.push(minuteShocks);
  }

  const equityDailyCandles: EquityCandleSeedRecord[] = [];
  const equityOneMinuteCandles: EquityCandleSeedRecord[] = [];

  // Map: dayIndex -> Map<symbol, EquityCandleSeedRecord>
  const dailyEquityCandleByDayAndSymbol: Array<
    Map<string, EquityCandleSeedRecord>
  > = Array.from({ length: dailyTradingDays }, () => new Map());

  // Map: intradayDayOffset -> minuteIndex -> Map<symbol, EquityCandleSeedRecord>
  const minuteEquityCandleByDayMinAndSymbol: Array<
    Array<Map<string, EquityCandleSeedRecord>>
  > = Array.from({ length: intradayTradingDays }, () =>
    Array.from({ length: intradayMinutesPerDay }, () => new Map())
  );

  for (const inst of sortedInstruments) {
    const tier = getVolatilityProfileForSymbol(inst.symbol).tier;
    const dailyMaxStockShockBps =
      tier === "LOW" ? 75 : tier === "MEDIUM" ? 110 : 145;
    const minuteMaxStockShockBps =
      tier === "LOW" ? 16 : tier === "MEDIUM" ? 24 : 32;

    // Generate daily close path backwards from `previousClosePaise` so the final historical day
    // lands cleanly near the instrument's current baseline price
    const dailyTargetCloses: number[] = new Array(dailyTradingDays);
    dailyTargetCloses[dailyTradingDays - 1] = normalizeSimulatedPricePaise(
      inst.previousClosePaise
    );

    for (let d = dailyTradingDays - 2; d >= 0; d--) {
      const nextDayClose = dailyTargetCloses[d + 1];
      const marketBps = dailyMarketShockBps[d + 1];
      const stockBps = Math.round(
        (rng() * 2 - 1) * dailyMaxStockShockBps
      );
      const totalForwardBps = Math.max(
        -220,
        Math.min(220, marketBps + stockBps)
      );
      // Step backward by -totalForwardBps
      const prevClose = normalizeSimulatedPricePaise(
        applyBasisPointsChangePaise(nextDayClose, -totalForwardBps)
      );
      dailyTargetCloses[d] = prevClose;
    }

    // Build daily candles for days 0 .. firstIntradayDayIndex - 1
    // Convention: Daily candles use Asia/Kolkata calendar-day boundaries in UTC
    // (`D 00:00 IST` = `(D-1)T18:30:00.000Z` to `(D+1) 00:00 IST` = `DT18:30:00.000Z`),
    // matching live simulation `"1d"` buckets so live ticks update the same daily document.
    for (let d = 0; d < firstIntradayDayIndex; d++) {
      const session = tradingSessions[d];
      const closePaise = dailyTargetCloses[d];
      const prevClosePaise =
        d === 0
          ? normalizeSimulatedPricePaise(
              applyBasisPointsChangePaise(
                closePaise,
                -Math.round((rng() * 2 - 1) * 45)
              )
            )
          : dailyTargetCloses[d - 1];

      const gapBps = Math.round((rng() * 2 - 1) * 18);
      const openPaise = normalizeSimulatedPricePaise(
        applyBasisPointsChangePaise(prevClosePaise, gapBps)
      );

      const bodyHigh = Math.max(openPaise, closePaise);
      const bodyLow = Math.min(openPaise, closePaise);

      const upperWickBps = Math.round(10 + rng() * 55);
      const lowerWickBps = Math.round(10 + rng() * 55);

      const highPaise = Math.max(
        bodyHigh,
        normalizeSimulatedPricePaise(
          applyBasisPointsChangePaise(bodyHigh, upperWickBps)
        )
      );
      const lowPaise = Math.min(
        bodyLow,
        normalizeSimulatedPricePaise(
          applyBasisPointsChangePaise(bodyLow, -lowerWickBps)
        )
      );

      assertValidOhlcValues(
        openPaise,
        highPaise,
        lowPaise,
        closePaise,
        "paise"
      );

      const dailyRecord: EquityCandleSeedRecord = {
        instrumentId: inst._id,
        interval: "1d",
        openTime: new Date(session.dailyOpenTime.getTime()),
        closeTime: new Date(session.dailyCloseTime.getTime()),
        openPaise,
        highPaise,
        lowPaise,
        closePaise,
        source: SIMULATED_CANDLE_SOURCE,
      };

      equityDailyCandles.push(dailyRecord);
      dailyEquityCandleByDayAndSymbol[d].set(inst.symbol, dailyRecord);
    }

    // Build 1-minute candles for the last `intradayTradingDays` days and derive each day's "1d" candle
    let runningMinuteClosePaise =
      firstIntradayDayIndex > 0
        ? dailyTargetCloses[firstIntradayDayIndex - 1]
        : dailyTargetCloses[0];

    for (let iday = 0; iday < intradayTradingDays; iday++) {
      const globalDayIndex = firstIntradayDayIndex + iday;
      const session = tradingSessions[globalDayIndex];
      // Indian equity session: 09:15 IST (= 03:45:00.000Z UTC) to 15:30 IST (= 10:00:00.000Z UTC)
      const sessionStartMs = session.sessionOpenTime.getTime();

      const dayTargetClosePaise =
        iday === intradayTradingDays - 1
          ? normalizeSimulatedPricePaise(inst.lastPricePaise)
          : dailyTargetCloses[globalDayIndex];

      const dayMinuteCandles: EquityCandleSeedRecord[] = [];

      for (let m = 0; m < intradayMinutesPerDay; m++) {
        const minuteTimestamp = new Date(sessionStartMs + m * 60 * 1_000);
        const minBucket = getCandleTimeBucket(minuteTimestamp, "1m");

        const openPaise =
          m === 0
            ? normalizeSimulatedPricePaise(
                applyBasisPointsChangePaise(
                  runningMinuteClosePaise,
                  Math.round((rng() * 2 - 1) * 12)
                )
              )
            : runningMinuteClosePaise;

        const mktBps = intradayMarketShockBps[iday][m];
        const stockBps = Math.round(
          (rng() * 2 - 1) * minuteMaxStockShockBps
        );
        const remainingMinutes = Math.max(1, intradayMinutesPerDay - m);
        const gapToTargetBps = Math.round(
          ((dayTargetClosePaise - openPaise) * 10_000) / openPaise
        );
        const bridgeDriftBps = Math.round(gapToTargetBps / remainingMinutes);
        const scaledShockBps = Math.round((mktBps + stockBps) * 0.45);
        const moveBps = Math.max(
          -35,
          Math.min(35, bridgeDriftBps + scaledShockBps)
        );

        const closePaise =
          m === intradayMinutesPerDay - 1
            ? dayTargetClosePaise
            : normalizeSimulatedPricePaise(
                applyBasisPointsChangePaise(openPaise, moveBps)
              );

        const bodyHigh = Math.max(openPaise, closePaise);
        const bodyLow = Math.min(openPaise, closePaise);

        const highWickBps = Math.round(2 + rng() * 10);
        const lowWickBps = Math.round(2 + rng() * 10);

        const highPaise = Math.max(
          bodyHigh,
          normalizeSimulatedPricePaise(
            applyBasisPointsChangePaise(bodyHigh, highWickBps)
          )
        );
        const lowPaise = Math.min(
          bodyLow,
          normalizeSimulatedPricePaise(
            applyBasisPointsChangePaise(bodyLow, -lowWickBps)
          )
        );

        assertValidOhlcValues(
          openPaise,
          highPaise,
          lowPaise,
          closePaise,
          "paise"
        );

        const minRecord: EquityCandleSeedRecord = {
          instrumentId: inst._id,
          interval: "1m",
          openTime: minBucket.openTime,
          closeTime: minBucket.closeTime,
          openPaise,
          highPaise,
          lowPaise,
          closePaise,
          source: SIMULATED_CANDLE_SOURCE,
        };

        dayMinuteCandles.push(minRecord);
        equityOneMinuteCandles.push(minRecord);
        minuteEquityCandleByDayMinAndSymbol[iday][m].set(
          inst.symbol,
          minRecord
        );
        runningMinuteClosePaise = closePaise;
      }

      // Derive the day's "1d" candle strictly from its "1m" candles via the shared
      // IST daily bucket utility (`D 00:00 IST` to `(D+1) 00:00 IST` in UTC: `18:30Z` to `18:30Z`).
      const [derivedDaily] = aggregateEquityCandlesToInterval(
        dayMinuteCandles,
        "1d"
      );
      equityDailyCandles.push(derivedDaily);
      dailyEquityCandleByDayAndSymbol[globalDayIndex].set(
        inst.symbol,
        derivedDaily
      );
    }
  }

  // Build synthetic market indices ("NIFTY50", "SENSEX") and their historical candles
  const indexIdBySymbol: Record<MarketIndexSymbol, Types.ObjectId> = {
    NIFTY50:
      options.indexIdBySymbol?.NIFTY50 ??
      new Types.ObjectId("673800000000000000000050"),
    SENSEX:
      options.indexIdBySymbol?.SENSEX ??
      new Types.ObjectId("673800000000000000000030"),
  };

  const finalTradingSession = tradingSessions[dailyTradingDays - 1];
  const lastIntradaySessionCloseTimestamp = new Date(
    finalTradingSession.sessionOpenTime.getTime() +
      intradayMinutesPerDay * 60 * 1_000
  );

  const indices: MarketIndexSeedRecord[] = MARKET_INDEX_SYMBOLS.map((sym) =>
    buildMarketIndexSeedRecord(sym, sortedInstruments, {
      valueUpdatedAt: lastIntradaySessionCloseTimestamp,
    })
  );

  const indexDailyCandles: IndexCandleSeedRecord[] = [];
  const indexOneMinuteCandles: IndexCandleSeedRecord[] = [];

  for (const indexRecord of indices) {
    const indexId = indexIdBySymbol[indexRecord.symbol];

    // 1. Earlier daily candles (days 0 .. firstIntradayDayIndex - 1) derived from constituent daily candles
    for (let d = 0; d < firstIntradayDayIndex; d++) {
      const session = tradingSessions[d];
      const daySymbolMap = dailyEquityCandleByDayAndSymbol[d];

      const openLookup = new Map<string, number>();
      const highLookup = new Map<string, number>();
      const lowLookup = new Map<string, number>();
      const closeLookup = new Map<string, number>();

      for (const [sym, eqCandle] of daySymbolMap.entries()) {
        openLookup.set(sym, eqCandle.openPaise);
        highLookup.set(sym, eqCandle.highPaise);
        lowLookup.set(sym, eqCandle.lowPaise);
        closeLookup.set(sym, eqCandle.closePaise);
      }

      const openValue = calculateSyntheticIndexValue(
        indexRecord.baseValue,
        indexRecord.constituents,
        openLookup
      );
      const closeValue = calculateSyntheticIndexValue(
        indexRecord.baseValue,
        indexRecord.constituents,
        closeLookup
      );
      const rawHighValue = calculateSyntheticIndexValue(
        indexRecord.baseValue,
        indexRecord.constituents,
        highLookup
      );
      const rawLowValue = calculateSyntheticIndexValue(
        indexRecord.baseValue,
        indexRecord.constituents,
        lowLookup
      );

      const highValue = Math.max(openValue, closeValue, rawHighValue);
      const lowValue = Math.min(openValue, closeValue, rawLowValue);

      assertValidOhlcValues(
        openValue,
        highValue,
        lowValue,
        closeValue,
        "fixed-point index units"
      );

      indexDailyCandles.push({
        indexId,
        interval: "1d",
        openTime: new Date(session.dailyOpenTime.getTime()),
        closeTime: new Date(session.dailyCloseTime.getTime()),
        openValue,
        highValue,
        lowValue,
        closeValue,
        source: SIMULATED_CANDLE_SOURCE,
      });
    }

    // 2. Recent intraday 1m candles + derived 1d candles for the last `intradayTradingDays` days
    for (let iday = 0; iday < intradayTradingDays; iday++) {
      const dayIndexMinCandles: IndexCandleSeedRecord[] = [];

      for (let m = 0; m < intradayMinutesPerDay; m++) {
        const minSymbolMap = minuteEquityCandleByDayMinAndSymbol[iday][m];
        const firstCandle = minSymbolMap.values().next().value as
          | EquityCandleSeedRecord
          | undefined;
        if (!firstCandle) {
          throw new Error("Missing constituent minute candles during index history generation.");
        }

        const openLookup = new Map<string, number>();
        const highLookup = new Map<string, number>();
        const lowLookup = new Map<string, number>();
        const closeLookup = new Map<string, number>();

        for (const [sym, eqCandle] of minSymbolMap.entries()) {
          openLookup.set(sym, eqCandle.openPaise);
          highLookup.set(sym, eqCandle.highPaise);
          lowLookup.set(sym, eqCandle.lowPaise);
          closeLookup.set(sym, eqCandle.closePaise);
        }

        const openValue = calculateSyntheticIndexValue(
          indexRecord.baseValue,
          indexRecord.constituents,
          openLookup
        );
        const closeValue = calculateSyntheticIndexValue(
          indexRecord.baseValue,
          indexRecord.constituents,
          closeLookup
        );
        const rawHighValue = calculateSyntheticIndexValue(
          indexRecord.baseValue,
          indexRecord.constituents,
          highLookup
        );
        const rawLowValue = calculateSyntheticIndexValue(
          indexRecord.baseValue,
          indexRecord.constituents,
          lowLookup
        );

        const highValue = Math.max(openValue, closeValue, rawHighValue);
        const lowValue = Math.min(openValue, closeValue, rawLowValue);

        assertValidOhlcValues(
          openValue,
          highValue,
          lowValue,
          closeValue,
          "fixed-point index units"
        );

        const indexMinCandle: IndexCandleSeedRecord = {
          indexId,
          interval: "1m",
          openTime: firstCandle.openTime,
          closeTime: firstCandle.closeTime,
          openValue,
          highValue,
          lowValue,
          closeValue,
          source: SIMULATED_CANDLE_SOURCE,
        };

        dayIndexMinCandles.push(indexMinCandle);
        indexOneMinuteCandles.push(indexMinCandle);
      }

      const [derivedIndexDaily] = aggregateIndexCandlesToInterval(
        dayIndexMinCandles,
        "1d"
      );
      indexDailyCandles.push(derivedIndexDaily);
    }
  }

  return {
    indices,
    indexIdBySymbol,
    equityDailyCandles,
    equityOneMinuteCandles,
    indexDailyCandles,
    indexOneMinuteCandles,
    tradingDaysUtc,
    tradingSessions,
  };
}

/**
 * Executes the synthetic market indices & historical OHLC candle seed (`--dry-run` default, `--apply` write).
 */
export async function runMarketHistorySeed(
  options: {
    mode?: SeedExecutionMode;
    config?: EnvConfig;
    dailyTradingDays?: number;
    intradayTradingDays?: number;
    intradayMinutesPerDay?: number;
    referenceDate?: Date;
    prngSeed?: number;
    requireStrictRole?: boolean;
    verbose?: boolean;
  } = {}
): Promise<SeedMarketHistoryResult> {
  const mode: SeedExecutionMode = options.mode ?? "dry-run";
  const requireStrictRole = options.requireStrictRole ?? true;
  const verbose = options.verbose ?? true;
  const dailyTradingDays =
    options.dailyTradingDays ?? DEFAULT_HISTORY_DAILY_TRADING_DAYS;
  const intradayTradingDays =
    options.intradayTradingDays ?? DEFAULT_HISTORY_INTRADAY_TRADING_DAYS;
  const intradayMinutesPerDay =
    options.intradayMinutesPerDay ?? DEFAULT_HISTORY_INTRADAY_MINUTES_PER_DAY;

  const log = (msg: string) => {
    if (verbose) console.log(msg);
  };

  log("================================================================================");
  log(
    `NIVORA — SYNTHETIC MARKET INDICES & HISTORICAL CANDLES SEED (${
      mode === "dry-run"
        ? "DRY-RUN MODE — NO WRITES"
        : "APPLY MODE — IDEMPOTENT UPSERT"
    })`
  );
  log("================================================================================");

  // 1. LOAD & VALIDATE ENVIRONMENT CONFIGURATION
  let config: EnvConfig;
  if (options.config) {
    config = options.config;
  } else {
    try {
      config = loadEnvConfig();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Config validation failed.";
      throw new Error(`PREFLIGHT_CONFIG_FAILED: ${message}`);
    }
  }

  if (config.nodeEnv !== "development") {
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: NODE_ENV must be 'development'. Current value: '${config.nodeEnv}'.`
    );
  }

  const url = new URL(config.mongoUrl);
  const targetDbFromUri = url.pathname.replace(/^\//, "");
  if (targetDbFromUri !== "Nivora") {
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: MONGO_URL database path must be exactly '/Nivora'. Got: '/${targetDbFromUri}'.`
    );
  }

  log("Connecting to MongoDB...");
  let conn: typeof mongoose;
  try {
    conn = await connectDatabase(config.mongoUrl, true);
  } catch (err: unknown) {
    const category =
      err instanceof DatabaseConnectionError ? err.category : "UNKNOWN";
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DATABASE_CONNECTION_FAILED [${category}]: ${msg}`);
  }

  const db = conn.connection.db;
  if (!db) {
    await mongoose.disconnect();
    throw new Error(
      "FATAL: MongoDB database handle is undefined after connect."
    );
  }

  try {
    const activeDbName = db.databaseName;
    if (activeDbName !== "Nivora") {
      throw new Error(
        `PREFLIGHT_TARGET_SAFETY_FAILED: Active database is '${activeDbName}', expected strictly 'Nivora'.`
      );
    }

    const hello = await db.command({ hello: 1 });
    const isWritablePrimary = Boolean(hello.isWritablePrimary);
    const transactionsSupported =
      Boolean(hello.setName) &&
      (hello.maxWireVersion ?? 0) >= 7 &&
      hello.logicalSessionTimeoutMinutes != null;

    if (!isWritablePrimary || !transactionsSupported) {
      throw new Error(
        "PREFLIGHT_TARGET_SAFETY_FAILED: Connected MongoDB cluster must be a writable replica-set primary supporting transactions."
      );
    }

    if (requireStrictRole) {
      const connStatus = await db.command({
        connectionStatus: 1,
        showPrivileges: true,
      });
      const roles = (connStatus.authInfo?.authenticatedUserRoles ?? []).map(
        (r: { role: string; db: string }) => `${r.role}@${r.db}`
      );
      const hasStrictNivoraRole = roles.includes("readWrite@Nivora");
      const hasBroadAdminRole = roles.some(
        (r: string) =>
          r.includes("admin") || r.includes("AnyDatabase") || r.includes("root")
      );

      if (!hasStrictNivoraRole || hasBroadAdminRole) {
        throw new Error(
          `PREFLIGHT_PERMISSION_CHECK_FAILED: Authenticated role is [${roles.join(
            ", "
          )}], expected strictly 'readWrite@Nivora'.`
        );
      }
    }

    // 2. LOAD SEEDED INSTRUMENTS FROM DATABASE
    const instruments = await InstrumentModel.find({})
      .sort({ symbol: 1 })
      .lean<InstrumentForIndexSeed[]>()
      .exec();

    if (instruments.length < 50) {
      throw new Error(
        `PREFLIGHT_INSTRUMENTS_MISSING: Expected at least 50 seeded NSE instruments in '${activeDbName}.instruments', found ${instruments.length}. Run 'npm run db:seed:instruments -- --apply' first.`
      );
    }

    // Check if MarketIndex documents already exist so we use their actual _id for index candles
    const existingIndices = await MarketIndexModel.find({})
      .select({ _id: 1, symbol: 1 })
      .lean<Array<{ _id: Types.ObjectId; symbol: MarketIndexSymbol }>>()
      .exec();

    const indexIdBySymbol: Record<MarketIndexSymbol, Types.ObjectId> = {
      NIFTY50: new Types.ObjectId("673800000000000000000050"),
      SENSEX: new Types.ObjectId("673800000000000000000030"),
    };
    for (const existingIdx of existingIndices) {
      indexIdBySymbol[existingIdx.symbol] = existingIdx._id;
    }

    const bundle = generateDeterministicMarketHistory(instruments, {
      dailyTradingDays,
      intradayTradingDays,
      intradayMinutesPerDay,
      referenceDate: options.referenceDate,
      prngSeed: options.prngSeed,
      indexIdBySymbol,
    });

    const allEquityCandles = [
      ...bundle.equityDailyCandles,
      ...bundle.equityOneMinuteCandles,
    ];
    const allIndexCandles = [
      ...bundle.indexDailyCandles,
      ...bundle.indexOneMinuteCandles,
    ];

    log(
      `Generated in-memory history: ${bundle.indices.length} indices, ${allEquityCandles.length} equity candles (${bundle.equityDailyCandles.length} 1d + ${bundle.equityOneMinuteCandles.length} 1m), ${allIndexCandles.length} index candles (${bundle.indexDailyCandles.length} 1d + ${bundle.indexOneMinuteCandles.length} 1m).`
    );

    if (mode === "dry-run") {
      const [
        existingIndexCount,
        existingEquityCandleCount,
        existingIndexCandleCount,
      ] = await Promise.all([
        MarketIndexModel.countDocuments({}).exec(),
        MarketCandleModel.countDocuments({}).exec(),
        MarketIndexCandleModel.countDocuments({}).exec(),
      ]);

      log(
        `[DRY-RUN] Complete. Zero writes performed. Current DB counts: market_indices=${existingIndexCount}, market_candles=${existingEquityCandleCount}, market_index_candles=${existingIndexCandleCount}.`
      );

      return {
        mode,
        databaseName: activeDbName,
        nodeEnv: config.nodeEnv,
        instrumentCount: instruments.length,
        dailyTradingDays,
        intradayTradingDays,
        intradayMinutesPerDay,
        indicesInsertedCount: 0,
        indicesSkippedCount: existingIndexCount,
        equityCandlesInsertedCount: 0,
        equityCandlesSkippedCount: existingEquityCandleCount,
        indexCandlesInsertedCount: 0,
        indexCandlesSkippedCount: existingIndexCandleCount,
        finalCounts: {
          marketIndices: existingIndexCount,
          marketCandles: existingEquityCandleCount,
          marketIndexCandles: existingIndexCandleCount,
        },
      };
    }

    // 3. APPLY MODE: IDEMPOTENT $setOnInsert UPSERTS
    let indicesInsertedCount = 0;
    let indicesSkippedCount = 0;
    const now = new Date();

    for (const idxRecord of bundle.indices) {
      const desiredId = bundle.indexIdBySymbol[idxRecord.symbol];
      const res = await MarketIndexModel.updateOne(
        { symbol: idxRecord.symbol },
        {
          $setOnInsert: {
            _id: desiredId,
            ...idxRecord,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, timestamps: false }
      ).exec();

      if ((res.upsertedCount ?? 0) > 0) {
        indicesInsertedCount++;
      } else {
        indicesSkippedCount++;
      }
    }

    // Re-read persisted MarketIndex _ids in case they existed prior to this run
    const persistedIndices = await MarketIndexModel.find({})
      .select({ _id: 1, symbol: 1 })
      .lean<Array<{ _id: Types.ObjectId; symbol: MarketIndexSymbol }>>()
      .exec();
    const persistedIdBySymbol = new Map<MarketIndexSymbol, Types.ObjectId>();
    for (const p of persistedIndices) {
      persistedIdBySymbol.set(p.symbol, p._id);
    }

    // Bulk upsert equity candles in batches of 2,000 using $setOnInsert
    const BATCH_SIZE = 2_000;
    let equityCandlesInsertedCount = 0;

    for (let i = 0; i < allEquityCandles.length; i += BATCH_SIZE) {
      const slice = allEquityCandles.slice(i, i + BATCH_SIZE);
      const ops = slice.map((c) => ({
        updateOne: {
          filter: {
            instrumentId: c.instrumentId,
            interval: c.interval,
            openTime: c.openTime,
          },
          update: {
            $setOnInsert: {
              ...c,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      }));

      const res = await MarketCandleModel.bulkWrite(ops, {
        ordered: false,
        timestamps: false,
      });
      equityCandlesInsertedCount += res.upsertedCount ?? 0;
    }

    const equityCandlesSkippedCount =
      allEquityCandles.length - equityCandlesInsertedCount;

    // Bulk upsert index candles using $setOnInsert
    let indexCandlesInsertedCount = 0;
    for (let i = 0; i < allIndexCandles.length; i += BATCH_SIZE) {
      const slice = allIndexCandles.slice(i, i + BATCH_SIZE);
      const ops = slice.map((c) => ({
        updateOne: {
          filter: {
            indexId: c.indexId,
            interval: c.interval,
            openTime: c.openTime,
          },
          update: {
            $setOnInsert: {
              ...c,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      }));

      const res = await MarketIndexCandleModel.bulkWrite(ops, {
        ordered: false,
        timestamps: false,
      });
      indexCandlesInsertedCount += res.upsertedCount ?? 0;
    }

    const indexCandlesSkippedCount =
      allIndexCandles.length - indexCandlesInsertedCount;

    const [finalIndices, finalEquityCandles, finalIndexCandles] =
      await Promise.all([
        MarketIndexModel.countDocuments({}).exec(),
        MarketCandleModel.countDocuments({}).exec(),
        MarketIndexCandleModel.countDocuments({}).exec(),
      ]);

    log(
      `[APPLY] Complete. Indices inserted=${indicesInsertedCount} (skipped=${indicesSkippedCount}), Equity candles inserted=${equityCandlesInsertedCount} (skipped=${equityCandlesSkippedCount}), Index candles inserted=${indexCandlesInsertedCount} (skipped=${indexCandlesSkippedCount}).`
    );

    return {
      mode,
      databaseName: activeDbName,
      nodeEnv: config.nodeEnv,
      instrumentCount: instruments.length,
      dailyTradingDays,
      intradayTradingDays,
      intradayMinutesPerDay,
      indicesInsertedCount,
      indicesSkippedCount,
      equityCandlesInsertedCount,
      equityCandlesSkippedCount,
      indexCandlesInsertedCount,
      indexCandlesSkippedCount,
      finalCounts: {
        marketIndices: finalIndices,
        marketCandles: finalEquityCandles,
        marketIndexCandles: finalIndexCandles,
      },
    };
  } finally {
    await mongoose.disconnect();
    log("MongoDB connection closed cleanly.\n");
  }
}

// Self-executing CLI runner when executed directly via tsx / node
if (
  process.argv[1] &&
  !process.argv[1].includes(".test.") &&
  (process.argv[1].endsWith("seed-market-history.ts") ||
    process.argv[1].endsWith("seed-market-history.js"))
) {
  dotenv.config();
  let mode: SeedExecutionMode;
  try {
    mode = parseSeedCliArgs(process.argv.slice(2));
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  runMarketHistorySeed({ mode })
    .then((result) => {
      console.log("MARKET HISTORY SEED SUMMARY:");
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("\nFATAL: Market history seed operation failed:");
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

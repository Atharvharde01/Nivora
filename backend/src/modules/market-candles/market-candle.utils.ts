import {
  CANDLE_INTERVALS,
  CandleInterval,
  CandleTimeBucket,
  IMarketCandle,
  IMarketIndexCandle,
  MarketCandleError,
  SIMULATED_CANDLE_SOURCE,
} from "./market-candle.types";

/**
 * Indian Standard Time (IST / Asia/Kolkata) permanent offset constants.
 * India observes a fixed UTC+05:30 offset year-round with no Daylight Saving Time.
 */
export const IST_TIMEZONE = "Asia/Kolkata" as const;
export const IST_UTC_OFFSET_MINUTES = 330 as const;
export const IST_UTC_OFFSET_MS = IST_UTC_OFFSET_MINUTES * 60 * 1_000;

/**
 * Hourly candle anchor offset in UTC milliseconds:
 * 09:15 IST corresponds to 03:45 UTC, so session-anchored 1-hour boundaries fall
 * on minute `:45` UTC (`:15` IST):
 *   09:15–10:15 IST (03:45–04:45Z), ..., 14:15–15:15 IST (08:45–09:45Z),
 *   15:15–15:30 IST (09:45–10:00Z, final partial session candle).
 */
export const HOURLY_IST_SESSION_ANCHOR_OFFSET_MS = 45 * 60 * 1_000;
export const IST_SESSION_CLOSING_HOUR_UTC_HOUR = 9 as const;
export const IST_SESSION_CLOSING_HOUR_UTC_MINUTE = 45 as const;
export const IST_PARTIAL_FINAL_HOUR_DURATION_MS = 15 * 60 * 1_000;

export const CANDLE_INTERVAL_DURATION_MS: Readonly<
  Record<CandleInterval, number>
> = Object.freeze({
  "1m": 60 * 1_000,
  "5m": 5 * 60 * 1_000,
  "15m": 15 * 60 * 1_000,
  "1h": 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
});

export interface IstDailyBucket extends CandleTimeBucket {
  readonly tradingDateIst: string;
}

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidCandleInterval(value: unknown): value is CandleInterval {
  return (
    typeof value === "string" &&
    (CANDLE_INTERVALS as readonly string[]).includes(value)
  );
}

export function assertValidCandleInterval(value: unknown): CandleInterval {
  if (!isValidCandleInterval(value)) {
    throw new MarketCandleError(
      "INVALID_CANDLE_INTERVAL",
      `Unsupported candle interval: ${String(value)}. Expected one of: ${CANDLE_INTERVALS.join(", ")}.`
    );
  }
  return value;
}

export function assertValidTimestamp(
  timestamp: unknown,
  fieldName = "timestamp"
): Date {
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    throw new MarketCandleError(
      "INVALID_CANDLE_TIMESTAMP",
      `${fieldName} must be a valid Date instance.`
    );
  }
  return timestamp;
}

/**
 * Resolves the `Asia/Kolkata` (`UTC+05:30`) calendar year, month (0-based), and day
 * for an arbitrary UTC `Date`.
 */
export function getIstCalendarDateParts(timestamp: Date): {
  readonly year: number;
  readonly monthIndex0: number;
  readonly day: number;
  readonly tradingDateIst: string;
  readonly dayOfWeek: number;
} {
  const validTimestamp = assertValidTimestamp(timestamp, "timestamp");
  const istShifted = new Date(validTimestamp.getTime() + IST_UTC_OFFSET_MS);
  const year = istShifted.getUTCFullYear();
  const monthIndex0 = istShifted.getUTCMonth();
  const day = istShifted.getUTCDate();
  const dayOfWeek = istShifted.getUTCDay();
  const tradingDateIst = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    year,
    monthIndex0,
    day,
    tradingDateIst,
    dayOfWeek,
  };
}

/**
 * Computes the shared, deterministic `Asia/Kolkata` calendar-day bucket in UTC
 * for a given `(year, monthIndex0, day)` date on the Indian calendar:
 * - `openTime` = `D 00:00:00.000 IST` in UTC (`(D - 1)T18:30:00.000Z`)
 * - `closeTime` = `(D + 1) 00:00:00.000 IST` in UTC (`DT18:30:00.000Z`)
 */
export function getIstDailyBucketFromParts(
  year: number,
  monthIndex0: number,
  day: number
): IstDailyBucket {
  const durationMs = CANDLE_INTERVAL_DURATION_MS["1d"];
  const openMs = Date.UTC(year, monthIndex0, day, 0, 0, 0, 0) - IST_UTC_OFFSET_MS;
  const checkIst = new Date(openMs + IST_UTC_OFFSET_MS);
  const tradingDateIst = `${checkIst.getUTCFullYear()}-${String(
    checkIst.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(checkIst.getUTCDate()).padStart(2, "0")}`;

  return {
    interval: "1d",
    tradingDateIst,
    openTime: new Date(openMs),
    closeTime: new Date(openMs + durationMs),
    durationMs,
  };
}

/**
 * Shared deterministic IST daily-bucket utility for both historical seed and live ticks.
 *
 * Maps any UTC `timestamp` to its `Asia/Kolkata` calendar date `D`:
 * - `openTime`: `D 00:00:00.000 IST` converted to UTC (`(D - 1)T18:30:00.000Z`)
 * - `closeTime`: `(D + 1) 00:00:00.000 IST` converted to UTC (`DT18:30:00.000Z`)
 */
export function getIstDailyBucket(timestamp: Date): IstDailyBucket {
  const { year, monthIndex0, day } = getIstCalendarDateParts(timestamp);
  return getIstDailyBucketFromParts(year, monthIndex0, day);
}

/**
 * Parses a date or timestamp query parameter safely without accidentally shifting
 * Indian (`Asia/Kolkata`) calendar dates:
 * - Date-only `YYYY-MM-DD` strings are interpreted on the `Asia/Kolkata` calendar
 *   (`00:00:00.000 IST` for `"start"`, `23:59:59.999 IST` for `"end"`).
 * - Full ISO-8601 timestamps preserve their exact instant in UTC.
 */
export function parseMarketQueryDate(
  raw: string,
  boundary: "start" | "end" = "start"
): Date | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const dateOnlyMatch = DATE_ONLY_REGEX.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const verify = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    if (
      verify.getUTCFullYear() !== year ||
      verify.getUTCMonth() !== month - 1 ||
      verify.getUTCDate() !== day
    ) {
      return null;
    }

    const dailyBucket = getIstDailyBucketFromParts(year, month - 1, day);
    if (boundary === "start") {
      return dailyBucket.openTime;
    }
    return new Date(dailyBucket.closeTime.getTime() - 1);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/**
 * Computes the aligned UTC `[openTime, closeTime)` bucket for a timestamp and interval:
 * - `"1m"`: 1-minute UTC bucket (`HH:MM:00.000Z`)
 * - `"5m"`: 5-minute UTC bucket (aligned cleanly with `03:45Z` / `09:15 IST`)
 * - `"15m"`: 15-minute UTC bucket (aligned cleanly with `03:45Z` / `09:15 IST`)
 * - `"1h"`: Session-anchored 1-hour bucket anchored to `09:15 IST` (`03:45Z`), i.e., `:45` UTC (`:15` IST)
 * - `"1d"`: `Asia/Kolkata` calendar-day bucket (`00:00 IST` to `00:00 IST` next day, i.e., `18:30Z` to `18:30Z`)
 */
export function getCandleTimeBucket(
  timestamp: Date,
  interval: CandleInterval
): CandleTimeBucket {
  const validTimestamp = assertValidTimestamp(timestamp, "timestamp");
  const validInterval = assertValidCandleInterval(interval);
  const durationMs = CANDLE_INTERVAL_DURATION_MS[validInterval];

  if (validInterval === "1d") {
    const istBucket = getIstDailyBucket(validTimestamp);
    return {
      interval: istBucket.interval,
      openTime: istBucket.openTime,
      closeTime: istBucket.closeTime,
      durationMs: istBucket.durationMs,
    };
  }

  const epochMs = validTimestamp.getTime();

  if (validInterval === "1h") {
    const openMs =
      Math.floor(
        (epochMs - HOURLY_IST_SESSION_ANCHOR_OFFSET_MS) / durationMs
      ) *
        durationMs +
      HOURLY_IST_SESSION_ANCHOR_OFFSET_MS;

    return {
      interval: validInterval,
      openTime: new Date(openMs),
      closeTime: new Date(openMs + durationMs),
      durationMs,
    };
  }

  const openMs = Math.floor(epochMs / durationMs) * durationMs;

  return {
    interval: validInterval,
    openTime: new Date(openMs),
    closeTime: new Date(openMs + durationMs),
    durationMs,
  };
}

/**
 * When aggregating `"1m"` candles into `"1h"` buckets anchored at `09:15 IST` (`03:45 UTC`),
 * the 7th session hour starts at `15:15 IST` (`09:45:00.000Z` UTC) and the Indian equity session
 * closes 15 minutes later at `15:30 IST` (`10:00:00.000Z` UTC).
 *
 * Partial Final Candle Representation:
 * If an hourly bucket opens at `09:45:00.000Z` (`15:15 IST`) and all contributing candles
 * within that bucket close on or before `10:00:00.000Z` (`15:30 IST`), `closeTime` is represented
 * accurately as `10:00:00.000Z` (`15:15–15:30 IST` partial 15-minute bar). If later 24x7 live
 * ticks extend past `10:00:00.000Z`, `closeTime` expands to the full 1-hour slot end (`10:45:00.000Z`).
 */
function resolveHourlyBucketCloseTime(
  bucketOpenTime: Date,
  nominalCloseTime: Date,
  maxSourceCloseMs: number
): Date {
  if (
    bucketOpenTime.getUTCHours() === IST_SESSION_CLOSING_HOUR_UTC_HOUR &&
    bucketOpenTime.getUTCMinutes() === IST_SESSION_CLOSING_HOUR_UTC_MINUTE
  ) {
    const sessionCloseCutoffMs =
      bucketOpenTime.getTime() + IST_PARTIAL_FINAL_HOUR_DURATION_MS;
    if (maxSourceCloseMs <= sessionCloseCutoffMs) {
      return new Date(sessionCloseCutoffMs);
    }
  }
  return nominalCloseTime;
}

/**
 * Validates that OHLC values are positive safe integers and obey
 * `low <= open <= high` and `low <= close <= high`.
 */
export function assertValidOhlcValues(
  open: number,
  high: number,
  low: number,
  close: number,
  unitLabel = "paise"
): void {
  const values = [
    { name: "open", val: open },
    { name: "high", val: high },
    { name: "low", val: low },
    { name: "close", val: close },
  ];

  for (const item of values) {
    if (
      typeof item.val !== "number" ||
      !Number.isSafeInteger(item.val) ||
      item.val < 1
    ) {
      throw new MarketCandleError(
        "INVALID_CANDLE_OHLC",
        `Candle ${item.name} must be a positive safe integer in ${unitLabel} (received ${String(item.val)}).`
      );
    }
  }

  if (low > open || low > close || low > high) {
    throw new MarketCandleError(
      "INVALID_CANDLE_OHLC",
      `Candle low (${low}) cannot exceed open (${open}), close (${close}), or high (${high}).`
    );
  }

  if (high < open || high < close || high < low) {
    throw new MarketCandleError(
      "INVALID_CANDLE_OHLC",
      `Candle high (${high}) cannot be less than open (${open}), close (${close}), or low (${low}).`
    );
  }
}

export type EquityCandleRollupInput = Pick<
  IMarketCandle,
  | "instrumentId"
  | "openTime"
  | "closeTime"
  | "openPaise"
  | "highPaise"
  | "lowPaise"
  | "closePaise"
> & {
  source?: IMarketCandle["source"];
};

export type EquityCandleRollupOutput = Omit<
  IMarketCandle,
  "createdAt" | "updatedAt"
>;

/**
 * Deterministically aggregates finer-grained equity candles (such as "1m" candles)
 * into higher-interval buckets ("5m", "15m", "1h", or "1d").
 */
export function aggregateEquityCandlesToInterval(
  sourceCandles: ReadonlyArray<EquityCandleRollupInput>,
  targetInterval: CandleInterval
): EquityCandleRollupOutput[] {
  const validTargetInterval = assertValidCandleInterval(targetInterval);
  if (sourceCandles.length === 0) {
    return [];
  }

  const sorted = [...sourceCandles].sort((a, b) => {
    const timeA = assertValidTimestamp(a.openTime, "openTime").getTime();
    const timeB = assertValidTimestamp(b.openTime, "openTime").getTime();
    return timeA - timeB;
  });

  const firstInstrumentIdStr = String(sorted[0].instrumentId);
  const buckets = new Map<
    number,
    {
      output: EquityCandleRollupOutput;
      nominalCloseTime: Date;
      maxSourceCloseMs: number;
    }
  >();

  for (const candle of sorted) {
    if (String(candle.instrumentId) !== firstInstrumentIdStr) {
      throw new MarketCandleError(
        "INVALID_INSTRUMENT_ID",
        "Cannot aggregate equity candles belonging to different instruments in a single rollup."
      );
    }

    assertValidOhlcValues(
      candle.openPaise,
      candle.highPaise,
      candle.lowPaise,
      candle.closePaise,
      "paise"
    );

    const bucket = getCandleTimeBucket(candle.openTime, validTargetInterval);
    const bucketKey = bucket.openTime.getTime();
    const sourceCloseMs = assertValidTimestamp(
      candle.closeTime,
      "closeTime"
    ).getTime();
    const existing = buckets.get(bucketKey);

    if (!existing) {
      const output: EquityCandleRollupOutput = {
        instrumentId: candle.instrumentId,
        interval: validTargetInterval,
        openTime: bucket.openTime,
        closeTime:
          validTargetInterval === "1h"
            ? resolveHourlyBucketCloseTime(
                bucket.openTime,
                bucket.closeTime,
                sourceCloseMs
              )
            : bucket.closeTime,
        openPaise: candle.openPaise,
        highPaise: candle.highPaise,
        lowPaise: candle.lowPaise,
        closePaise: candle.closePaise,
        source: SIMULATED_CANDLE_SOURCE,
      };
      buckets.set(bucketKey, {
        output,
        nominalCloseTime: bucket.closeTime,
        maxSourceCloseMs: sourceCloseMs,
      });
    } else {
      existing.maxSourceCloseMs = Math.max(
        existing.maxSourceCloseMs,
        sourceCloseMs
      );
      existing.output.highPaise = Math.max(
        existing.output.highPaise,
        candle.highPaise
      );
      existing.output.lowPaise = Math.min(
        existing.output.lowPaise,
        candle.lowPaise
      );
      existing.output.closePaise = candle.closePaise;
      if (validTargetInterval === "1h") {
        existing.output.closeTime = resolveHourlyBucketCloseTime(
          existing.output.openTime,
          existing.nominalCloseTime,
          existing.maxSourceCloseMs
        );
      }
    }
  }

  return Array.from(buckets.values())
    .map((entry) => entry.output)
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
}

export type IndexCandleRollupInput = Pick<
  IMarketIndexCandle,
  | "indexId"
  | "openTime"
  | "closeTime"
  | "openValue"
  | "highValue"
  | "lowValue"
  | "closeValue"
> & {
  source?: IMarketIndexCandle["source"];
};

export type IndexCandleRollupOutput = Omit<
  IMarketIndexCandle,
  "createdAt" | "updatedAt"
>;

/**
 * Deterministically aggregates finer-grained synthetic index candles (such as "1m" candles)
 * into higher-interval buckets ("5m", "15m", "1h", or "1d").
 */
export function aggregateIndexCandlesToInterval(
  sourceCandles: ReadonlyArray<IndexCandleRollupInput>,
  targetInterval: CandleInterval
): IndexCandleRollupOutput[] {
  const validTargetInterval = assertValidCandleInterval(targetInterval);
  if (sourceCandles.length === 0) {
    return [];
  }

  const sorted = [...sourceCandles].sort((a, b) => {
    const timeA = assertValidTimestamp(a.openTime, "openTime").getTime();
    const timeB = assertValidTimestamp(b.openTime, "openTime").getTime();
    return timeA - timeB;
  });

  const firstIndexIdStr = String(sorted[0].indexId);
  const buckets = new Map<
    number,
    {
      output: IndexCandleRollupOutput;
      nominalCloseTime: Date;
      maxSourceCloseMs: number;
    }
  >();

  for (const candle of sorted) {
    if (String(candle.indexId) !== firstIndexIdStr) {
      throw new MarketCandleError(
        "INVALID_INDEX_ID",
        "Cannot aggregate index candles belonging to different market indices in a single rollup."
      );
    }

    assertValidOhlcValues(
      candle.openValue,
      candle.highValue,
      candle.lowValue,
      candle.closeValue,
      "fixed-point index units"
    );

    const bucket = getCandleTimeBucket(candle.openTime, validTargetInterval);
    const bucketKey = bucket.openTime.getTime();
    const sourceCloseMs = assertValidTimestamp(
      candle.closeTime,
      "closeTime"
    ).getTime();
    const existing = buckets.get(bucketKey);

    if (!existing) {
      const output: IndexCandleRollupOutput = {
        indexId: candle.indexId,
        interval: validTargetInterval,
        openTime: bucket.openTime,
        closeTime:
          validTargetInterval === "1h"
            ? resolveHourlyBucketCloseTime(
                bucket.openTime,
                bucket.closeTime,
                sourceCloseMs
              )
            : bucket.closeTime,
        openValue: candle.openValue,
        highValue: candle.highValue,
        lowValue: candle.lowValue,
        closeValue: candle.closeValue,
        source: SIMULATED_CANDLE_SOURCE,
      };
      buckets.set(bucketKey, {
        output,
        nominalCloseTime: bucket.closeTime,
        maxSourceCloseMs: sourceCloseMs,
      });
    } else {
      existing.maxSourceCloseMs = Math.max(
        existing.maxSourceCloseMs,
        sourceCloseMs
      );
      existing.output.highValue = Math.max(
        existing.output.highValue,
        candle.highValue
      );
      existing.output.lowValue = Math.min(
        existing.output.lowValue,
        candle.lowValue
      );
      existing.output.closeValue = candle.closeValue;
      if (validTargetInterval === "1h") {
        existing.output.closeTime = resolveHourlyBucketCloseTime(
          existing.output.openTime,
          existing.nominalCloseTime,
          existing.maxSourceCloseMs
        );
      }
    }
  }

  return Array.from(buckets.values())
    .map((entry) => entry.output)
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
}

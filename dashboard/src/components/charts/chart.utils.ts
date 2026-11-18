/**
 * NIVORA Trading Platform — Lightweight Charts Data Transformation Utilities
 * Converts backend index & equity OHLC candles into validated, chronologically sorted,
 * deduplicated CandlestickData entries formatted for TradingView Lightweight Charts v5.
 */

import { CandlestickData, Time, UTCTimestamp } from "lightweight-charts";
import {
  CandleInterval,
  formatIndexPoints,
  formatRupees,
  InstrumentCandleDto,
  MarketIndexCandleDto,
} from "../../api/types";

/**
 * Validates and converts an ISO-8601 UTC timestamp string to a Unix timestamp in seconds.
 * Returns `null` if the string is empty, invalid, or produces NaN.
 */
export function parseIsoToUnixSeconds(isoString: string): UTCTimestamp | null {
  if (!isoString || typeof isoString !== "string") {
    return null;
  }
  const ms = Date.parse(isoString.trim());
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.floor(ms / 1000) as UTCTimestamp;
}

/**
 * Validates whether all 4 OHLC numbers are finite numeric values.
 */
function areOhlcValuesValid(
  open: number,
  high: number,
  low: number,
  close: number
): boolean {
  return (
    Number.isFinite(open) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    Number.isFinite(close)
  );
}

/**
 * Sorts and deduplicates candlestick data points ensuring strictly increasing timestamps,
 * which is a strict invariant required by Lightweight Charts.
 * When duplicate timestamps are encountered, the latter record is preserved.
 */
export function sortAndDeduplicateCandles(
  candles: CandlestickData<Time>[]
): CandlestickData<Time>[] {
  if (candles.length <= 1) {
    return candles;
  }

  // Sort ascending by time
  const sorted = [...candles].sort(
    (a, b) => (a.time as number) - (b.time as number)
  );

  const deduplicated: CandlestickData<Time>[] = [];
  for (const candle of sorted) {
    if (deduplicated.length === 0) {
      deduplicated.push(candle);
    } else {
      const prev = deduplicated[deduplicated.length - 1];
      if ((prev.time as number) === (candle.time as number)) {
        // Replace with latter candle
        deduplicated[deduplicated.length - 1] = candle;
      } else if ((candle.time as number) > (prev.time as number)) {
        deduplicated.push(candle);
      }
    }
  }

  return deduplicated;
}

/**
 * Transforms synthetic market index candles into Lightweight Charts CandlestickData.
 * OHLC values are divided by 100 (fixed-point integer -> index points).
 */
export function transformIndexCandles(
  candles: MarketIndexCandleDto[]
): CandlestickData<Time>[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const result: CandlestickData<Time>[] = [];

  for (const c of candles) {
    const unixSeconds = parseIsoToUnixSeconds(c.openTime);
    if (unixSeconds === null) {
      continue;
    }

    if (!areOhlcValuesValid(c.openValue, c.highValue, c.lowValue, c.closeValue)) {
      continue;
    }

    result.push({
      time: unixSeconds,
      open: c.openValue / 100,
      high: c.highValue / 100,
      low: c.lowValue / 100,
      close: c.closeValue / 100,
    });
  }

  return sortAndDeduplicateCandles(result);
}

/**
 * Transforms tradable equity instrument candles into Lightweight Charts CandlestickData.
 * OHLC values are divided by 100 (integer paise -> rupees).
 */
export function transformEquityCandles(
  candles: InstrumentCandleDto[]
): CandlestickData<Time>[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const result: CandlestickData<Time>[] = [];

  for (const c of candles) {
    const unixSeconds = parseIsoToUnixSeconds(c.openTime);
    if (unixSeconds === null) {
      continue;
    }

    if (!areOhlcValuesValid(c.openPaise, c.highPaise, c.lowPaise, c.closePaise)) {
      continue;
    }

    result.push({
      time: unixSeconds,
      open: c.openPaise / 100,
      high: c.highPaise / 100,
      low: c.lowPaise / 100,
      close: c.closePaise / 100,
    });
  }

  return sortAndDeduplicateCandles(result);
}

/**
 * Formats a Unix timestamp into a readable date/time string in the Asia/Kolkata timezone.
 * Used for Lightweight Charts time scale localization, tooltips, and crosshair labels.
 */
export function formatUnixTimestampToIST(
  unixSeconds: number,
  interval: CandleInterval
): string {
  const date = new Date(unixSeconds * 1000);

  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Formats a price value based on instrument type:
 * - Indices: index points (no ₹ symbol, e.g. 24,120.50)
 * - Equities: Indian rupees with ₹ symbol (e.g. ₹2,500.00)
 */
export function formatChartPrice(price: number, isIndex: boolean): string {
  if (isIndex) {
    return formatIndexPoints(price);
  }
  return `₹${formatRupees(price)}`;
}

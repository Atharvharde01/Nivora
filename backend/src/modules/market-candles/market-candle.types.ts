import { HydratedDocument, Model, Types } from "mongoose";

/**
 * Supported OHLC candle time intervals across NIVORA equities and synthetic indices:
 * - "1m": 1 minute (base persisted intraday interval; historical sessions span 03:45Z–10:00Z = 09:15–15:30 IST)
 * - "5m": 5 minutes (derived intraday rollup)
 * - "15m": 15 minutes (derived intraday rollup)
 * - "1h": 1 hour (derived intraday rollup anchored to 09:15 IST / 03:45 UTC; final session slot 15:15–15:30 IST)
 * - "1d": 1 day (persisted daily interval aligned to Asia/Kolkata 00:00 IST–24:00 IST boundaries in UTC: 18:30Z–18:30Z)
 */
export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "1d"] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export const SIMULATED_CANDLE_SOURCE = "SIMULATED" as const;

export type CandleDataSource = typeof SIMULATED_CANDLE_SOURCE;

/**
 * Persisted Equity OHLC Candle (`market_candles`).
 * All monetary prices (`openPaise`, `highPaise`, `lowPaise`, `closePaise`) are
 * positive safe integers in paise (₹1.00 = 100 paise).
 */
export interface IMarketCandle {
  instrumentId: Types.ObjectId;
  interval: CandleInterval;
  openTime: Date;
  closeTime: Date;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  source: CandleDataSource;
  createdAt: Date;
  updatedAt: Date;
}

export type MarketCandleDocument = HydratedDocument<IMarketCandle>;

export type MarketCandleModelType = Model<IMarketCandle>;

/**
 * Persisted Synthetic Index OHLC Candle (`market_index_candles`).
 * All index values (`openValue`, `highValue`, `lowValue`, `closeValue`) are
 * positive safe integers in fixed-point hundredths of an index point
 * (e.g., 24,000.75 index points = 2,400,075 fixed-point units).
 */
export interface IMarketIndexCandle {
  indexId: Types.ObjectId;
  interval: CandleInterval;
  openTime: Date;
  closeTime: Date;
  openValue: number;
  highValue: number;
  lowValue: number;
  closeValue: number;
  source: CandleDataSource;
  createdAt: Date;
  updatedAt: Date;
}

export type MarketIndexCandleDocument = HydratedDocument<IMarketIndexCandle>;

export type MarketIndexCandleModelType = Model<IMarketIndexCandle>;

/**
 * Time bucket boundaries in UTC for a given `CandleInterval`.
 */
export interface CandleTimeBucket {
  readonly interval: CandleInterval;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly durationMs: number;
}

export type MarketCandleErrorCode =
  | "INVALID_CANDLE_INTERVAL"
  | "INVALID_CANDLE_TIMESTAMP"
  | "INVALID_CANDLE_OHLC"
  | "INVALID_INSTRUMENT_ID"
  | "INVALID_INDEX_ID"
  | "INVALID_DATE_RANGE";

export class MarketCandleError extends Error {
  public readonly code: MarketCandleErrorCode;

  constructor(code: MarketCandleErrorCode, message: string) {
    super(message);
    this.name = "MarketCandleError";
    this.code = code;
    Object.setPrototypeOf(this, MarketCandleError.prototype);
  }
}

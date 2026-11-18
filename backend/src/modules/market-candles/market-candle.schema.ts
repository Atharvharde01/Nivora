import { Schema } from "mongoose";
import { isPositiveSafeIntegerPaise } from "../instruments/instrument.schema";
import {
  CANDLE_INTERVALS,
  IMarketCandle,
  SIMULATED_CANDLE_SOURCE,
} from "./market-candle.types";

export const MARKET_CANDLES_INSTRUMENT_INTERVAL_OPEN_UNIQUE_INDEX_NAME =
  "market_candles_instrument_interval_open_unique_idx";
export const MARKET_CANDLES_INTERVAL_OPEN_TIME_INDEX_NAME =
  "market_candles_interval_open_time_idx";

function isValidDateInstance(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Equity Historical OHLC Candle Schema (`market_candles`).
 *
 * Financial & Architectural Invariants:
 * 1. Integer Paise Prices: `openPaise`, `highPaise`, `lowPaise`, and `closePaise`
 *    are positive safe integers in paise (₹1.00 = 100 paise).
 * 2. OHLC Ordering: `lowPaise <= openPaise <= highPaise` and `lowPaise <= closePaise <= highPaise`.
 * 3. UTC Bucket Ordering: `openTime < closeTime`.
 * 4. Unique Bucket Constraint: At most one candle per `(instrumentId, interval, openTime)`.
 */
export const MarketCandleSchema = new Schema<IMarketCandle>(
  {
    instrumentId: {
      type: Schema.Types.ObjectId,
      ref: "Instrument",
      required: [true, "instrumentId is required."],
      immutable: true,
    },
    interval: {
      type: String,
      required: [true, "interval is required."],
      trim: true,
      enum: {
        values: CANDLE_INTERVALS,
        message: "interval must be one of: '1m', '5m', '15m', '1h', '1d'.",
      },
      immutable: true,
    },
    openTime: {
      type: Date,
      required: [true, "openTime is required."],
      immutable: true,
      validate: {
        validator: isValidDateInstance,
        message: "openTime must be a valid Date.",
      },
    },
    closeTime: {
      type: Date,
      required: [true, "closeTime is required."],
      validate: [
        {
          validator: isValidDateInstance,
          message: "closeTime must be a valid Date.",
        },
        {
          validator: function (this: IMarketCandle, value: unknown): boolean {
            if (!isValidDateInstance(value) || !isValidDateInstance(this.openTime)) {
              return false;
            }
            return value.getTime() > this.openTime.getTime();
          },
          message: "closeTime must be strictly greater than openTime.",
        },
      ],
    },
    openPaise: {
      type: Number,
      required: [true, "openPaise is required."],
      min: [1, "openPaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeIntegerPaise,
        message: "openPaise must be a positive safe integer in paise.",
      },
    },
    highPaise: {
      type: Number,
      required: [true, "highPaise is required."],
      min: [1, "highPaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeIntegerPaise,
          message: "highPaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IMarketCandle, value: unknown): boolean {
            if (!isPositiveSafeIntegerPaise(value)) {
              return false;
            }
            const high = value as number;
            if (isPositiveSafeIntegerPaise(this.openPaise) && high < this.openPaise) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.closePaise) && high < this.closePaise) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.lowPaise) && high < this.lowPaise) {
              return false;
            }
            return true;
          },
          message:
            "highPaise must be greater than or equal to openPaise, closePaise, and lowPaise.",
        },
      ],
    },
    lowPaise: {
      type: Number,
      required: [true, "lowPaise is required."],
      min: [1, "lowPaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeIntegerPaise,
          message: "lowPaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IMarketCandle, value: unknown): boolean {
            if (!isPositiveSafeIntegerPaise(value)) {
              return false;
            }
            const low = value as number;
            if (isPositiveSafeIntegerPaise(this.openPaise) && low > this.openPaise) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.closePaise) && low > this.closePaise) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.highPaise) && low > this.highPaise) {
              return false;
            }
            return true;
          },
          message:
            "lowPaise must be less than or equal to openPaise, closePaise, and highPaise.",
        },
      ],
    },
    closePaise: {
      type: Number,
      required: [true, "closePaise is required."],
      min: [1, "closePaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeIntegerPaise,
        message: "closePaise must be a positive safe integer in paise.",
      },
    },
    source: {
      type: String,
      required: [true, "source is required."],
      default: SIMULATED_CANDLE_SOURCE,
      enum: {
        values: [SIMULATED_CANDLE_SOURCE],
        message: "source must be 'SIMULATED'.",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "market_candles",
  }
);

// 1. Unique compound index preventing duplicate candles for the same instrument, interval, and UTC openTime bucket.
MarketCandleSchema.index(
  { instrumentId: 1, interval: 1, openTime: 1 },
  {
    unique: true,
    name: MARKET_CANDLES_INSTRUMENT_INTERVAL_OPEN_UNIQUE_INDEX_NAME,
  }
);

// 2. Compound index supporting cross-instrument interval/time maintenance and queries.
MarketCandleSchema.index(
  { interval: 1, openTime: -1 },
  {
    name: MARKET_CANDLES_INTERVAL_OPEN_TIME_INDEX_NAME,
  }
);

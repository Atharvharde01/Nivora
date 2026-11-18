import { Schema } from "mongoose";
import {
  CANDLE_INTERVALS,
  IMarketIndexCandle,
  SIMULATED_CANDLE_SOURCE,
} from "./market-candle.types";

export const MARKET_INDEX_CANDLES_INDEX_INTERVAL_OPEN_UNIQUE_INDEX_NAME =
  "market_index_candles_index_interval_open_unique_idx";
export const MARKET_INDEX_CANDLES_INTERVAL_OPEN_TIME_INDEX_NAME =
  "market_index_candles_interval_open_time_idx";

function isValidDateInstance(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Validates that an index value in fixed-point hundredths of an index point
 * is a positive safe integer (>= 1 and <= Number.MAX_SAFE_INTEGER).
 */
export function isPositiveSafeFixedPointIndexValue(
  value: unknown
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Synthetic Market Index OHLC Candle Schema (`market_index_candles`).
 *
 * Architectural & Precision Invariants:
 * 1. Fixed-Point Index Representation: `openValue`, `highValue`, `lowValue`, and
 *    `closeValue` are stored in positive safe-integer hundredths of an index point
 *    (e.g., 24,000.75 index points = 2,400,075 fixed-point units).
 * 2. OHLC Ordering: `lowValue <= openValue <= highValue` and `lowValue <= closeValue <= highValue`.
 * 3. UTC Bucket Ordering: `openTime < closeTime`.
 * 4. Unique Bucket Constraint: At most one candle per `(indexId, interval, openTime)`.
 */
export const MarketIndexCandleSchema = new Schema<IMarketIndexCandle>(
  {
    indexId: {
      type: Schema.Types.ObjectId,
      ref: "MarketIndex",
      required: [true, "indexId is required."],
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
          validator: function (
            this: IMarketIndexCandle,
            value: unknown
          ): boolean {
            if (!isValidDateInstance(value) || !isValidDateInstance(this.openTime)) {
              return false;
            }
            return value.getTime() > this.openTime.getTime();
          },
          message: "closeTime must be strictly greater than openTime.",
        },
      ],
    },
    openValue: {
      type: Number,
      required: [true, "openValue is required."],
      min: [1, "openValue must be at least 1 fixed-point unit."],
      validate: {
        validator: isPositiveSafeFixedPointIndexValue,
        message:
          "openValue must be a positive safe integer in fixed-point index units.",
      },
    },
    highValue: {
      type: Number,
      required: [true, "highValue is required."],
      min: [1, "highValue must be at least 1 fixed-point unit."],
      validate: [
        {
          validator: isPositiveSafeFixedPointIndexValue,
          message:
            "highValue must be a positive safe integer in fixed-point index units.",
        },
        {
          validator: function (
            this: IMarketIndexCandle,
            value: unknown
          ): boolean {
            if (!isPositiveSafeFixedPointIndexValue(value)) {
              return false;
            }
            const high = value as number;
            if (
              isPositiveSafeFixedPointIndexValue(this.openValue) &&
              high < this.openValue
            ) {
              return false;
            }
            if (
              isPositiveSafeFixedPointIndexValue(this.closeValue) &&
              high < this.closeValue
            ) {
              return false;
            }
            if (
              isPositiveSafeFixedPointIndexValue(this.lowValue) &&
              high < this.lowValue
            ) {
              return false;
            }
            return true;
          },
          message:
            "highValue must be greater than or equal to openValue, closeValue, and lowValue.",
        },
      ],
    },
    lowValue: {
      type: Number,
      required: [true, "lowValue is required."],
      min: [1, "lowValue must be at least 1 fixed-point unit."],
      validate: [
        {
          validator: isPositiveSafeFixedPointIndexValue,
          message:
            "lowValue must be a positive safe integer in fixed-point index units.",
        },
        {
          validator: function (
            this: IMarketIndexCandle,
            value: unknown
          ): boolean {
            if (!isPositiveSafeFixedPointIndexValue(value)) {
              return false;
            }
            const low = value as number;
            if (
              isPositiveSafeFixedPointIndexValue(this.openValue) &&
              low > this.openValue
            ) {
              return false;
            }
            if (
              isPositiveSafeFixedPointIndexValue(this.closeValue) &&
              low > this.closeValue
            ) {
              return false;
            }
            if (
              isPositiveSafeFixedPointIndexValue(this.highValue) &&
              low > this.highValue
            ) {
              return false;
            }
            return true;
          },
          message:
            "lowValue must be less than or equal to openValue, closeValue, and highValue.",
        },
      ],
    },
    closeValue: {
      type: Number,
      required: [true, "closeValue is required."],
      min: [1, "closeValue must be at least 1 fixed-point unit."],
      validate: {
        validator: isPositiveSafeFixedPointIndexValue,
        message:
          "closeValue must be a positive safe integer in fixed-point index units.",
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
    collection: "market_index_candles",
  }
);

// 1. Unique compound index preventing duplicate index candles for the same index, interval, and UTC openTime bucket.
MarketIndexCandleSchema.index(
  { indexId: 1, interval: 1, openTime: 1 },
  {
    unique: true,
    name: MARKET_INDEX_CANDLES_INDEX_INTERVAL_OPEN_UNIQUE_INDEX_NAME,
  }
);

// 2. Compound index supporting cross-index interval/time queries.
MarketIndexCandleSchema.index(
  { interval: 1, openTime: -1 },
  {
    name: MARKET_INDEX_CANDLES_INTERVAL_OPEN_TIME_INDEX_NAME,
  }
);

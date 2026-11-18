import { Schema } from "mongoose";
import { INSTRUMENT_EXCHANGES } from "../instruments/instrument.types";
import { isPositiveSafeIntegerPaise } from "../instruments/instrument.schema";
import { isPositiveSafeFixedPointIndexValue } from "../market-candles/market-index-candle.schema";
import {
  IMarketIndex,
  IMarketIndexConstituent,
  MARKET_INDEX_METHODOLOGY,
  MARKET_INDEX_SYMBOLS,
  SIMULATED_MARKET_INDEX_SOURCE,
  TOTAL_INDEX_WEIGHT_BPS,
} from "./market-index.types";

export const MARKET_INDICES_SYMBOL_UNIQUE_INDEX_NAME =
  "market_indices_symbol_unique_idx";
export const MARKET_INDICES_CONSTITUENT_INSTRUMENT_INDEX_NAME =
  "market_indices_constituent_instrument_idx";

const CONSTITUENT_SYMBOL_REGEX = /^[A-Z0-9][A-Z0-9&-]{0,29}$/;

function isValidDateInstance(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidWeightBps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= TOTAL_INDEX_WEIGHT_BPS
  );
}

const MarketIndexConstituentSchema = new Schema<IMarketIndexConstituent>(
  {
    instrumentId: {
      type: Schema.Types.ObjectId,
      ref: "Instrument",
      required: [true, "constituent instrumentId is required."],
    },
    symbol: {
      type: String,
      required: [true, "constituent symbol is required."],
      uppercase: true,
      trim: true,
      match: [
        CONSTITUENT_SYMBOL_REGEX,
        "constituent symbol must be 1-30 uppercase alphanumeric, '&', or '-' characters.",
      ],
    },
    exchange: {
      type: String,
      required: [true, "constituent exchange is required."],
      uppercase: true,
      trim: true,
      enum: {
        values: INSTRUMENT_EXCHANGES,
        message: "constituent exchange must be one of: NSE, BSE.",
      },
    },
    weightBps: {
      type: Number,
      required: [true, "constituent weightBps is required."],
      min: [1, "constituent weightBps must be at least 1 bps."],
      max: [
        TOTAL_INDEX_WEIGHT_BPS,
        `constituent weightBps cannot exceed ${TOTAL_INDEX_WEIGHT_BPS} bps.`,
      ],
      validate: {
        validator: isValidWeightBps,
        message:
          "constituent weightBps must be a positive safe integer in basis points.",
      },
    },
    basePricePaise: {
      type: Number,
      required: [true, "constituent basePricePaise is required."],
      min: [1, "constituent basePricePaise must be at least 1 paisa."],
      validate: {
        validator: isPositiveSafeIntegerPaise,
        message:
          "constituent basePricePaise must be a positive safe integer in paise.",
      },
    },
  },
  {
    _id: false,
    strict: "throw",
  }
);

/**
 * Synthetic Market Index Schema (`market_indices`).
 *
 * Architectural & Financial Invariants:
 * 1. Non-Tradable Separation: Stored in `market_indices`, completely separate from `instruments`.
 * 2. Fixed-Point Integer Precision: `currentValue`, `baseValue`, and `previousCloseValue`
 *    are positive safe integers in hundredths of an index point (100 units = 1.00 index point).
 * 3. Constituent Weight Conservation: Constituent `weightBps` values are positive safe
 *    integers that sum to exactly 10,000 bps (100.00%) with no duplicate constituents.
 */
export const MarketIndexSchema = new Schema<IMarketIndex>(
  {
    symbol: {
      type: String,
      required: [true, "symbol is required."],
      uppercase: true,
      trim: true,
      immutable: true,
      enum: {
        values: MARKET_INDEX_SYMBOLS,
        message: "symbol must be one of: NIFTY50, SENSEX.",
      },
    },
    name: {
      type: String,
      required: [true, "name is required."],
      trim: true,
      minlength: [1, "name must not be empty."],
      maxlength: [120, "name must not exceed 120 characters."],
    },
    description: {
      type: String,
      required: [true, "description is required."],
      trim: true,
      minlength: [1, "description must not be empty."],
      maxlength: [500, "description must not exceed 500 characters."],
    },
    currentValue: {
      type: Number,
      required: [true, "currentValue is required."],
      min: [1, "currentValue must be at least 1 fixed-point unit."],
      validate: {
        validator: isPositiveSafeFixedPointIndexValue,
        message:
          "currentValue must be a positive safe integer in fixed-point index units.",
      },
    },
    baseValue: {
      type: Number,
      required: [true, "baseValue is required."],
      min: [1, "baseValue must be at least 1 fixed-point unit."],
      validate: {
        validator: isPositiveSafeFixedPointIndexValue,
        message:
          "baseValue must be a positive safe integer in fixed-point index units.",
      },
    },
    previousCloseValue: {
      type: Number,
      required: [true, "previousCloseValue is required."],
      min: [1, "previousCloseValue must be at least 1 fixed-point unit."],
      validate: {
        validator: isPositiveSafeFixedPointIndexValue,
        message:
          "previousCloseValue must be a positive safe integer in fixed-point index units.",
      },
    },
    constituents: {
      type: [MarketIndexConstituentSchema],
      required: [true, "constituents array is required."],
      validate: [
        {
          validator: function (
            value: unknown
          ): value is IMarketIndexConstituent[] {
            return Array.isArray(value) && value.length >= 1;
          },
          message: "constituents must be a non-empty array.",
        },
        {
          validator: function (value: IMarketIndexConstituent[]): boolean {
            if (!Array.isArray(value) || value.length === 0) {
              return false;
            }
            const seenInstrumentIds = new Set<string>();
            const seenSymbols = new Set<string>();
            let totalWeightBps = 0;

            for (const item of value) {
              if (!item || !item.instrumentId || !item.symbol) {
                return false;
              }
              const idKey = String(item.instrumentId);
              const symKey = item.symbol.toUpperCase();
              if (seenInstrumentIds.has(idKey) || seenSymbols.has(symKey)) {
                return false;
              }
              seenInstrumentIds.add(idKey);
              seenSymbols.add(symKey);

              if (!isValidWeightBps(item.weightBps)) {
                return false;
              }
              totalWeightBps += item.weightBps;
            }

            return totalWeightBps === TOTAL_INDEX_WEIGHT_BPS;
          },
          message: `constituents must contain unique instruments/symbols whose weightBps sum to exactly ${TOTAL_INDEX_WEIGHT_BPS} bps.`,
        },
      ],
    },
    methodology: {
      type: String,
      required: [true, "methodology is required."],
      default: MARKET_INDEX_METHODOLOGY,
      enum: {
        values: [MARKET_INDEX_METHODOLOGY],
        message: `methodology must be '${MARKET_INDEX_METHODOLOGY}'.`,
      },
    },
    source: {
      type: String,
      required: [true, "source is required."],
      default: SIMULATED_MARKET_INDEX_SOURCE,
      enum: {
        values: [SIMULATED_MARKET_INDEX_SOURCE],
        message: `source must be '${SIMULATED_MARKET_INDEX_SOURCE}'.`,
      },
    },
    valueUpdatedAt: {
      type: Date,
      required: [true, "valueUpdatedAt is required."],
      default: () => new Date(),
      validate: {
        validator: isValidDateInstance,
        message: "valueUpdatedAt must be a valid Date.",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "market_indices",
  }
);

// 1. Unique index on canonical index symbol ("NIFTY50", "SENSEX").
MarketIndexSchema.index(
  { symbol: 1 },
  {
    unique: true,
    name: MARKET_INDICES_SYMBOL_UNIQUE_INDEX_NAME,
  }
);

// 2. Index supporting reverse lookups of indices by constituent instrumentId.
MarketIndexSchema.index(
  { "constituents.instrumentId": 1 },
  {
    name: MARKET_INDICES_CONSTITUENT_INSTRUMENT_INDEX_NAME,
  }
);

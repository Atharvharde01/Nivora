import { Schema } from "mongoose";
import { IInstrument, INSTRUMENT_EXCHANGES } from "./instrument.types";

export const INSTRUMENT_SYMBOL_MAX_LENGTH = 20;
export const INSTRUMENT_NAME_MAX_LENGTH = 120;

export const INSTRUMENTS_EXCHANGE_SYMBOL_UNIQUE_INDEX_NAME =
  "instruments_exchange_symbol_unique_idx";
export const INSTRUMENTS_STARTER_WATCHLIST_TRADABLE_INDEX_NAME =
  "instruments_starter_watchlist_tradable_idx";

const INSTRUMENT_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/**
 * Validates that a normalized instrument symbol consists of 1 to 20 characters
 * containing only uppercase ASCII letters (A-Z), digits (0-9), ampersand (&), or hyphen (-).
 */
export function isValidInstrumentSymbol(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= INSTRUMENT_SYMBOL_MAX_LENGTH &&
    INSTRUMENT_SYMBOL_PATTERN.test(value)
  );
}

/**
 * Validates that an instrument display name is a non-empty string up to 120 characters.
 */
export function isValidInstrumentName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.length <= INSTRUMENT_NAME_MAX_LENGTH
  );
}

/**
 * Validates that a price in paise is a positive safe integer (>= 1 and <= Number.MAX_SAFE_INTEGER).
 * Rejects zero, negative values, decimals, NaN, Infinity, and unsafe integers.
 */
export function isPositiveSafeIntegerPaise(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Global Instrument Catalog Schema (`instruments`).
 *
 * Architectural & Financial Notes:
 * 1. Global Shared Catalog: Instruments are global market definitions and are NOT
 *    owned by individual users or practice accounts.
 * 2. Integer Paise Representation: All prices (`lastPricePaise`, `bidPricePaise`,
 *    `askPricePaise`, `previousClosePaise`) are stored as positive safe integer paise
 *    (e.g., ₹125.75 = 12575 paise, ₹2,450.00 = 245000 paise).
 * 3. Quote Spread Invariant: `bidPricePaise <= askPricePaise` is enforced on document
 *    validation. `lastPricePaise` is not constrained to lie between bid and ask, as the
 *    last traded price may legally sit outside the current quote spread.
 */
export const InstrumentSchema = new Schema<IInstrument>(
  {
    symbol: {
      type: String,
      required: [true, "Instrument symbol is required."],
      trim: true,
      uppercase: true,
      maxlength: [
        INSTRUMENT_SYMBOL_MAX_LENGTH,
        `Instrument symbol must not exceed ${INSTRUMENT_SYMBOL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidInstrumentSymbol,
        message:
          "Instrument symbol must be 1 to 20 characters using only uppercase letters (A-Z), numbers (0-9), '&', or '-'.",
      },
    },
    name: {
      type: String,
      required: [true, "Instrument name is required."],
      trim: true,
      minlength: [1, "Instrument name must not be empty."],
      maxlength: [
        INSTRUMENT_NAME_MAX_LENGTH,
        `Instrument name must not exceed ${INSTRUMENT_NAME_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidInstrumentName,
        message: `Instrument name must be a non-empty string up to ${INSTRUMENT_NAME_MAX_LENGTH} characters.`,
      },
    },
    exchange: {
      type: String,
      required: [true, "Instrument exchange is required."],
      trim: true,
      uppercase: true,
      enum: {
        values: INSTRUMENT_EXCHANGES,
        message: "Instrument exchange must be either 'NSE' or 'BSE'.",
      },
    },
    isTradable: {
      type: Boolean,
      required: [true, "isTradable is required."],
      default: true,
    },
    lastPricePaise: {
      type: Number,
      required: [true, "lastPricePaise is required."],
      min: [1, "lastPricePaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeIntegerPaise,
        message: "lastPricePaise must be a positive safe integer in paise.",
      },
    },
    bidPricePaise: {
      type: Number,
      required: [true, "bidPricePaise is required."],
      min: [1, "bidPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeIntegerPaise,
          message: "bidPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IInstrument, value: unknown): boolean {
            if (!isPositiveSafeIntegerPaise(value)) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.askPricePaise)) {
              return (value as number) <= this.askPricePaise;
            }
            return true;
          },
          message: "bidPricePaise must not exceed askPricePaise.",
        },
      ],
    },
    askPricePaise: {
      type: Number,
      required: [true, "askPricePaise is required."],
      min: [1, "askPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeIntegerPaise,
          message: "askPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IInstrument, value: unknown): boolean {
            if (!isPositiveSafeIntegerPaise(value)) {
              return false;
            }
            if (isPositiveSafeIntegerPaise(this.bidPricePaise)) {
              return this.bidPricePaise <= (value as number);
            }
            return true;
          },
          message: "askPricePaise must be greater than or equal to bidPricePaise.",
        },
      ],
    },
    previousClosePaise: {
      type: Number,
      required: [true, "previousClosePaise is required."],
      min: [1, "previousClosePaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeIntegerPaise,
        message: "previousClosePaise must be a positive safe integer in paise.",
      },
    },
    isStarterWatchlist: {
      type: Boolean,
      required: [true, "isStarterWatchlist is required."],
      default: false,
    },
    priceUpdatedAt: {
      type: Date,
      required: [true, "priceUpdatedAt is required."],
      validate: {
        validator: (value: unknown): boolean =>
          value instanceof Date && !Number.isNaN(value.getTime()),
        message: "priceUpdatedAt must be a valid Date.",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "instruments",
  }
);

// 1. Unique compound index allowing the same symbol on different exchanges (e.g., NSE vs BSE)
//    while preventing duplicate symbols within the same exchange.
InstrumentSchema.index(
  { exchange: 1, symbol: 1 },
  {
    unique: true,
    name: INSTRUMENTS_EXCHANGE_SYMBOL_UNIQUE_INDEX_NAME,
  }
);

// 2. Compound index supporting starter-watchlist instrument retrieval and tradability filtering
//    with deterministic symbol ordering.
InstrumentSchema.index(
  { isStarterWatchlist: 1, isTradable: 1, symbol: 1 },
  {
    name: INSTRUMENTS_STARTER_WATCHLIST_TRADABLE_INDEX_NAME,
  }
);

import { Schema } from "mongoose";
import { IHolding, INSTRUMENT_EXCHANGES } from "./holding.types";

export const HOLDING_SYMBOL_MAX_LENGTH = 20;
export const HOLDING_DEFAULT_QUANTITY = 0;
export const HOLDING_DEFAULT_AVERAGE_BUY_PRICE_PAISE = 0;
export const HOLDING_DEFAULT_TOTAL_INVESTED_PAISE = 0;
export const HOLDING_DEFAULT_REALIZED_PNL_PAISE = 0;
export const HOLDING_INITIAL_VERSION = 1;

export const HOLDINGS_ACCOUNT_INSTRUMENT_UNIQUE_INDEX_NAME =
  "holdings_account_instrument_unique_idx";
export const HOLDINGS_ACCOUNT_ACTIVE_SYMBOL_INDEX_NAME =
  "holdings_account_active_symbol_idx";
export const HOLDINGS_USER_ACCOUNT_INDEX_NAME = "holdings_user_account_idx";

const HOLDING_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/**
 * Validates that a normalized holding symbol matches the canonical Instrument
 * symbol rules: 1 to 20 characters containing only uppercase ASCII letters (A-Z),
 * digits (0-9), ampersand (&), or hyphen (-).
 */
export function isValidHoldingSymbol(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= HOLDING_SYMBOL_MAX_LENGTH &&
    HOLDING_SYMBOL_PATTERN.test(value)
  );
}

/**
 * Validates that a value is a positive safe integer (>= 1 and <= Number.MAX_SAFE_INTEGER).
 * Rejects zero, negative values, decimals, NaN, Infinity, and unsafe integers.
 */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Validates that a value is a non-negative safe integer (>= 0 and <= Number.MAX_SAFE_INTEGER).
 * Rejects negative values, decimals, NaN, Infinity, and unsafe integers.
 */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates that a value is a signed safe integer (>= Number.MIN_SAFE_INTEGER and <= Number.MAX_SAFE_INTEGER).
 * Rejects decimals, NaN, Infinity, and unsafe integers.
 */
export function isSignedSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Holding Schema (`holdings`).
 *
 * Architectural, Accounting & Concurrency Notes:
 * 1. Account-Specific Position Identity: A Holding represents the consolidated
 *    current equity position for one `(practiceAccountId, instrumentId)` pair.
 *    Identity fields (`userId`, `practiceAccountId`, `instrumentId`, `exchange`)
 *    are immutable, while `symbol` (display snapshot), `quantity`,
 *    `averageBuyPricePaise`, `totalInvestedPaise`, `realizedPnlPaise`, and
 *    `version` are mutable.
 * 2. Authoritative Cost Basis vs Display Average Price:
 *    - `totalInvestedPaise` is the authoritative remaining cost basis in integer paise.
 *    - `averageBuyPricePaise` is a rounded derived display value
 *      (`Math.round(totalInvestedPaise / quantity)` when `quantity > 0`, or `0` when
 *      `quantity === 0`).
 *    - `totalInvestedPaise === quantity * averageBuyPricePaise` is intentionally NOT
 *      required because rounding `averageBuyPricePaise` across partial buys/sells
 *      would otherwise introduce cumulative rounding drift.
 * 3. Intended Service-Layer Accounting Rules:
 *    - On BUY (`buyQuantity`, `buyValuePaise = buyQuantity * askPricePaise`):
 *      - `newQuantity = oldQuantity + buyQuantity`
 *      - `newTotalInvestedPaise = oldTotalInvestedPaise + buyValuePaise`
 *      - `newAverageBuyPricePaise = Math.round(newTotalInvestedPaise / newQuantity)`
 *      - `newVersion = oldVersion + 1`
 *      (All sums and products must be checked against `Number.MAX_SAFE_INTEGER`.)
 *    - On SELL (`sellQuantity <= oldQuantity`, `sellProceedsPaise = sellQuantity * bidPricePaise`):
 *      - Full exit (`sellQuantity === oldQuantity`):
 *        `costBasisSoldPaise = oldTotalInvestedPaise`
 *      - Partial exit (`sellQuantity < oldQuantity`):
 *        `costBasisSoldPaise = round((oldTotalInvestedPaise * sellQuantity) / oldQuantity)`
 *        computed using `BigInt` intermediate multiplication and rounding in the
 *        service layer to prevent IEEE-754 overflow/precision loss.
 *      - `newQuantity = oldQuantity - sellQuantity`
 *      - `newTotalInvestedPaise = oldTotalInvestedPaise - costBasisSoldPaise`
 *      - `tradeRealizedPnlPaise = sellProceedsPaise - costBasisSoldPaise`
 *      - `newRealizedPnlPaise = oldRealizedPnlPaise + tradeRealizedPnlPaise`
 *      - `newAverageBuyPricePaise = newQuantity === 0 ? 0 : Math.round(newTotalInvestedPaise / newQuantity)`
 *      - `newVersion = oldVersion + 1`
 * 4. Zero-Quantity Retention Policy: When a position is fully exited (`newQuantity === 0`),
 *    the Holding document is NOT deleted. It is retained with `quantity: 0`,
 *    `totalInvestedPaise: 0`, and `averageBuyPricePaise: 0`, while preserving
 *    cumulative `realizedPnlPaise`, monotonic `version`, and `createdAt`. This prevents
 *    delete/re-insert race conditions and retains account-level realized P&L history.
 *    Active portfolio queries filter `{ practiceAccountId, quantity: { $gt: 0 } }`.
 * 5. Concurrency & Validator Limitation: Mongoose document validators do not
 *    independently guarantee cross-document consistency or validate raw query updates.
 *    The future trading service must enforce these invariants atomically inside a
 *    MongoDB transaction with optimistic concurrency (`version`) and quantity predicates.
 */
export const HoldingSchema = new Schema<IHolding>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required."],
      immutable: true,
    },
    practiceAccountId: {
      type: Schema.Types.ObjectId,
      ref: "PracticeAccount",
      required: [true, "practiceAccountId is required."],
      immutable: true,
    },
    instrumentId: {
      type: Schema.Types.ObjectId,
      ref: "Instrument",
      required: [true, "instrumentId is required."],
      immutable: true,
    },
    symbol: {
      type: String,
      required: [true, "Holding symbol is required."],
      trim: true,
      uppercase: true,
      maxlength: [
        HOLDING_SYMBOL_MAX_LENGTH,
        `Holding symbol must not exceed ${HOLDING_SYMBOL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidHoldingSymbol,
        message:
          "Holding symbol must be 1 to 20 characters using only uppercase letters (A-Z), numbers (0-9), '&', or '-'.",
      },
    },
    exchange: {
      type: String,
      required: [true, "Holding exchange is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: INSTRUMENT_EXCHANGES,
        message: "Holding exchange must be either 'NSE' or 'BSE'.",
      },
    },
    quantity: {
      type: Number,
      required: [true, "Holding quantity is required."],
      default: HOLDING_DEFAULT_QUANTITY,
      min: [0, "Holding quantity cannot be negative."],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "Holding quantity must be a non-negative safe integer.",
      },
    },
    averageBuyPricePaise: {
      type: Number,
      required: [true, "averageBuyPricePaise is required."],
      default: HOLDING_DEFAULT_AVERAGE_BUY_PRICE_PAISE,
      min: [0, "averageBuyPricePaise cannot be negative."],
      validate: [
        {
          validator: isNonNegativeSafeInteger,
          message:
            "averageBuyPricePaise must be a non-negative safe integer in paise.",
        },
        {
          validator: function (this: IHolding, value: unknown): boolean {
            if (
              !isNonNegativeSafeInteger(value) ||
              !isNonNegativeSafeInteger(this.quantity)
            ) {
              return true;
            }
            if (this.quantity === 0) {
              return value === 0;
            }
            return value >= 1;
          },
          message:
            "averageBuyPricePaise must be 0 when quantity is 0, and at least 1 paise when quantity is positive.",
        },
      ],
    },
    totalInvestedPaise: {
      type: Number,
      required: [true, "totalInvestedPaise is required."],
      default: HOLDING_DEFAULT_TOTAL_INVESTED_PAISE,
      min: [0, "totalInvestedPaise cannot be negative."],
      validate: [
        {
          validator: isNonNegativeSafeInteger,
          message:
            "totalInvestedPaise must be a non-negative safe integer in paise.",
        },
        {
          validator: function (this: IHolding, value: unknown): boolean {
            if (
              !isNonNegativeSafeInteger(value) ||
              !isNonNegativeSafeInteger(this.quantity)
            ) {
              return true;
            }
            if (this.quantity === 0) {
              return value === 0;
            }
            return value >= this.quantity;
          },
          message:
            "totalInvestedPaise must be 0 when quantity is 0, and at least equal to quantity when quantity is positive.",
        },
      ],
    },
    realizedPnlPaise: {
      type: Number,
      required: [true, "realizedPnlPaise is required."],
      default: HOLDING_DEFAULT_REALIZED_PNL_PAISE,
      validate: {
        validator: isSignedSafeInteger,
        message: "realizedPnlPaise must be a safe integer in paise.",
      },
    },
    version: {
      type: Number,
      required: [true, "version is required."],
      default: HOLDING_INITIAL_VERSION,
      min: [1, "version must be at least 1."],
      validate: {
        validator: isPositiveSafeInteger,
        message: "version must be a positive safe integer.",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "holdings",
  }
);

// 1. Unique compound index guaranteeing at most one Holding document per instrument per practice account.
//    Used by BUY/SELL execution and single-position lookup queries: { practiceAccountId, instrumentId }.
HoldingSchema.index(
  { practiceAccountId: 1, instrumentId: 1 },
  {
    unique: true,
    name: HOLDINGS_ACCOUNT_INSTRUMENT_UNIQUE_INDEX_NAME,
  }
);

// 2. Partial compound index supporting active portfolio retrieval in symbol order:
//    find({ practiceAccountId, quantity: { $gt: 0 } }).sort({ symbol: 1 })
//    Excludes zero-quantity (fully exited) historical holding documents from the active index.
HoldingSchema.index(
  { practiceAccountId: 1, symbol: 1 },
  {
    partialFilterExpression: {
      quantity: { $gt: 0 },
    },
    name: HOLDINGS_ACCOUNT_ACTIVE_SYMBOL_INDEX_NAME,
  }
);

// 3. User-scoped lookup index across active and archived practice accounts:
//    Supports user-level ownership audits, data export/retention queries, and cross-account
//    realized-P&L / holding history lookups where userId is the leading filter predicate.
HoldingSchema.index(
  { userId: 1, practiceAccountId: 1 },
  {
    name: HOLDINGS_USER_ACCOUNT_INDEX_NAME,
  }
);

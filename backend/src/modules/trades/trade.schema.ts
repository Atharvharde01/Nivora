import { Schema } from "mongoose";
import {
  INSTRUMENT_EXCHANGES,
  ITrade,
  ITradeQuoteSnapshot,
  TRADE_SIDES,
} from "./trade.types";

export const TRADE_SYMBOL_MAX_LENGTH = 20;
export const TRADE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export const TRADES_ORDER_UNIQUE_INDEX_NAME = "trades_order_unique_idx";
export const TRADES_ACCOUNT_EXECUTED_AT_INDEX_NAME =
  "trades_account_executed_at_idx";
export const TRADES_USER_EXECUTED_AT_INDEX_NAME =
  "trades_user_executed_at_idx";
export const TRADES_ACCOUNT_INSTRUMENT_EXECUTED_AT_INDEX_NAME =
  "trades_account_instrument_executed_at_idx";

const TRADE_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/**
 * Validates that a normalized trade symbol matches the canonical Instrument
 * symbol rules: 1 to 20 characters containing only uppercase ASCII letters (A-Z),
 * digits (0-9), ampersand (&), or hyphen (-).
 */
export function isValidTradeSymbol(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= TRADE_SYMBOL_MAX_LENGTH &&
    TRADE_SYMBOL_PATTERN.test(value)
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
 * Validates that a value is a valid Date instance.
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Validates that `quantity * executionPricePaise` does not exceed
 * `Number.MAX_SAFE_INTEGER` and equals `totalValuePaise`.
 */
export function isSafeTradeMultiplication(
  quantity: number,
  executionPricePaise: number,
  totalValuePaise: number
): boolean {
  if (
    !isPositiveSafeInteger(quantity) ||
    !isPositiveSafeInteger(executionPricePaise) ||
    !isPositiveSafeInteger(totalValuePaise)
  ) {
    return false;
  }

  if (quantity > Math.floor(Number.MAX_SAFE_INTEGER / executionPricePaise)) {
    return false;
  }

  return totalValuePaise === quantity * executionPricePaise;
}

/**
 * Embedded Quote Snapshot Subschema (`_id: false`).
 *
 * Preserves the exact simulated Instrument quote used at the moment of trade execution.
 * Enforces `bidPricePaise <= askPricePaise` while allowing `lastPricePaise` to lie
 * outside the current bid/ask spread (matching `InstrumentSchema`).
 */
export const TradeQuoteSnapshotSchema = new Schema<ITradeQuoteSnapshot>(
  {
    lastPricePaise: {
      type: Number,
      required: [true, "quoteSnapshot.lastPricePaise is required."],
      immutable: true,
      min: [1, "quoteSnapshot.lastPricePaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeInteger,
        message:
          "quoteSnapshot.lastPricePaise must be a positive safe integer in paise.",
      },
    },
    bidPricePaise: {
      type: Number,
      required: [true, "quoteSnapshot.bidPricePaise is required."],
      immutable: true,
      min: [1, "quoteSnapshot.bidPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeInteger,
          message:
            "quoteSnapshot.bidPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (
            this: ITradeQuoteSnapshot,
            value: unknown
          ): boolean {
            if (!isPositiveSafeInteger(value)) {
              return false;
            }
            if (isPositiveSafeInteger(this.askPricePaise)) {
              return value <= this.askPricePaise;
            }
            return true;
          },
          message:
            "quoteSnapshot.bidPricePaise must not exceed quoteSnapshot.askPricePaise.",
        },
      ],
    },
    askPricePaise: {
      type: Number,
      required: [true, "quoteSnapshot.askPricePaise is required."],
      immutable: true,
      min: [1, "quoteSnapshot.askPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeInteger,
          message:
            "quoteSnapshot.askPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (
            this: ITradeQuoteSnapshot,
            value: unknown
          ): boolean {
            if (!isPositiveSafeInteger(value)) {
              return false;
            }
            if (isPositiveSafeInteger(this.bidPricePaise)) {
              return this.bidPricePaise <= value;
            }
            return true;
          },
          message:
            "quoteSnapshot.askPricePaise must be greater than or equal to quoteSnapshot.bidPricePaise.",
        },
      ],
    },
    priceUpdatedAt: {
      type: Date,
      required: [true, "quoteSnapshot.priceUpdatedAt is required."],
      immutable: true,
      validate: {
        validator: isValidDate,
        message: "quoteSnapshot.priceUpdatedAt must be a valid Date.",
      },
    },
  },
  {
    _id: false,
    strict: "throw",
  }
);

/**
 * Immutable Trade Schema (`trades`).
 *
 * Financial, Auditability & Append-Only Notes:
 * 1. Completed Execution Record: A Trade represents one completed market-order
 *    execution (`BUY` or `SELL`). Only `EXECUTED` orders produce Trades; rejected
 *    orders never produce Trades.
 * 2. Independent SELL Auditability: Every Trade stores `costBasisSoldPaise` and
 *    `realizedPnlPaise`. For `BUY` trades, both are `0`. For `SELL` trades,
 *    `costBasisSoldPaise` is a positive safe integer representing the actual
 *    remaining holding cost basis removed, and `realizedPnlPaise` equals
 *    `totalValuePaise - costBasisSoldPaise`.
 * 3. Quote Snapshot Fidelity: Every Trade embeds the exact `quoteSnapshot`
 *    captured inside the execution transaction (`BUY` executes at `askPricePaise`;
 *    `SELL` executes at `bidPricePaise`).
 * 4. Defense-in-Depth Immutability Limitation: All fields are marked
 *    `immutable: true` and `timestamps: { createdAt: true, updatedAt: false }`
 *    omits `updatedAt`. Because Mongoose schema immutability does not block raw
 *    driver update/delete commands, future services must treat `trades` as strictly
 *    append-only and never issue update or delete operations.
 */
export const TradeSchema = new Schema<ITrade>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "orderId is required."],
      immutable: true,
    },
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
      required: [true, "Trade symbol is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      maxlength: [
        TRADE_SYMBOL_MAX_LENGTH,
        `Trade symbol must not exceed ${TRADE_SYMBOL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidTradeSymbol,
        message:
          "Trade symbol must be 1 to 20 characters using only uppercase letters (A-Z), numbers (0-9), '&', or '-'.",
      },
    },
    exchange: {
      type: String,
      required: [true, "Trade exchange is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: INSTRUMENT_EXCHANGES,
        message: "Trade exchange must be either 'NSE' or 'BSE'.",
      },
    },
    side: {
      type: String,
      required: [true, "Trade side is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: TRADE_SIDES,
        message: "Trade side must be either 'BUY' or 'SELL'.",
      },
    },
    quantity: {
      type: Number,
      required: [true, "Trade quantity is required."],
      immutable: true,
      min: [1, "Trade quantity must be at least 1 share."],
      validate: {
        validator: isPositiveSafeInteger,
        message: "Trade quantity must be a positive safe integer.",
      },
    },
    executionPricePaise: {
      type: Number,
      required: [true, "executionPricePaise is required."],
      immutable: true,
      min: [1, "executionPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeInteger,
          message:
            "executionPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: ITrade, value: unknown): boolean {
            if (
              !isPositiveSafeInteger(value) ||
              !isPositiveSafeInteger(this.quantity)
            ) {
              return true;
            }
            return (
              this.quantity <= Math.floor(Number.MAX_SAFE_INTEGER / value)
            );
          },
          message:
            "quantity * executionPricePaise exceeds Number.MAX_SAFE_INTEGER.",
        },
        {
          validator: function (this: ITrade, value: unknown): boolean {
            if (!isPositiveSafeInteger(value) || !this.quoteSnapshot) {
              return true;
            }
            if (
              this.side === "BUY" &&
              isPositiveSafeInteger(this.quoteSnapshot.askPricePaise)
            ) {
              return value === this.quoteSnapshot.askPricePaise;
            }
            if (
              this.side === "SELL" &&
              isPositiveSafeInteger(this.quoteSnapshot.bidPricePaise)
            ) {
              return value === this.quoteSnapshot.bidPricePaise;
            }
            return true;
          },
          message:
            "executionPricePaise must equal quoteSnapshot.askPricePaise for BUY trades and quoteSnapshot.bidPricePaise for SELL trades.",
        },
      ],
    },
    totalValuePaise: {
      type: Number,
      required: [true, "totalValuePaise is required."],
      immutable: true,
      min: [1, "totalValuePaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeInteger,
          message: "totalValuePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: ITrade, value: unknown): boolean {
            if (
              !isPositiveSafeInteger(value) ||
              !isPositiveSafeInteger(this.quantity) ||
              !isPositiveSafeInteger(this.executionPricePaise)
            ) {
              return true;
            }
            return isSafeTradeMultiplication(
              this.quantity,
              this.executionPricePaise,
              value
            );
          },
          message:
            "totalValuePaise must equal quantity * executionPricePaise without exceeding Number.MAX_SAFE_INTEGER.",
        },
      ],
    },
    costBasisSoldPaise: {
      type: Number,
      required: [true, "costBasisSoldPaise is required."],
      immutable: true,
      min: [0, "costBasisSoldPaise cannot be negative."],
      validate: [
        {
          validator: isNonNegativeSafeInteger,
          message:
            "costBasisSoldPaise must be a non-negative safe integer in paise.",
        },
        {
          validator: function (this: ITrade, value: unknown): boolean {
            if (!isNonNegativeSafeInteger(value)) {
              return false;
            }
            if (this.side === "BUY") {
              return value === 0;
            }
            if (this.side === "SELL") {
              return isPositiveSafeInteger(value);
            }
            return true;
          },
          message:
            "costBasisSoldPaise must be 0 for BUY trades and a positive safe integer (>= 1 paise) for SELL trades.",
        },
      ],
    },
    realizedPnlPaise: {
      type: Number,
      required: [true, "realizedPnlPaise is required."],
      immutable: true,
      validate: [
        {
          validator: isSignedSafeInteger,
          message: "realizedPnlPaise must be a safe integer in paise.",
        },
        {
          validator: function (this: ITrade, value: unknown): boolean {
            if (!isSignedSafeInteger(value)) {
              return false;
            }
            if (this.side === "BUY") {
              return value === 0;
            }
            if (this.side === "SELL") {
              if (
                !isPositiveSafeInteger(this.totalValuePaise) ||
                !isPositiveSafeInteger(this.costBasisSoldPaise)
              ) {
                return true;
              }
              const expectedPnl =
                this.totalValuePaise - this.costBasisSoldPaise;
              return Number.isSafeInteger(expectedPnl) && value === expectedPnl;
            }
            return true;
          },
          message:
            "realizedPnlPaise must be 0 for BUY trades and must equal (totalValuePaise - costBasisSoldPaise) for SELL trades.",
        },
      ],
    },
    quoteSnapshot: {
      type: TradeQuoteSnapshotSchema,
      required: [true, "quoteSnapshot is required."],
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required."],
      trim: true,
      immutable: true,
      minlength: [1, "idempotencyKey must not be empty."],
      maxlength: [
        TRADE_IDEMPOTENCY_KEY_MAX_LENGTH,
        `idempotencyKey must not exceed ${TRADE_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "string" &&
          value.trim().length >= 1 &&
          value.length <= TRADE_IDEMPOTENCY_KEY_MAX_LENGTH,
        message: `idempotencyKey must be a non-empty string between 1 and ${TRADE_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      },
    },
    executedAt: {
      type: Date,
      required: [true, "executedAt is required."],
      immutable: true,
      validate: {
        validator: isValidDate,
        message: "executedAt must be a valid Date.",
      },
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    strict: "throw",
    collection: "trades",
  }
);

// 1. Unique orderId index guaranteeing at most one Trade per Order.
TradeSchema.index(
  { orderId: 1 },
  {
    unique: true,
    name: TRADES_ORDER_UNIQUE_INDEX_NAME,
  }
);

// 2. Paginated execution history index for a single practice account (newest first, deterministic tie-breaker).
TradeSchema.index(
  { practiceAccountId: 1, executedAt: -1, _id: -1 },
  {
    name: TRADES_ACCOUNT_EXECUTED_AT_INDEX_NAME,
  }
);

// 3. Paginated execution history index across all practice accounts belonging to a user.
TradeSchema.index(
  { userId: 1, executedAt: -1, _id: -1 },
  {
    name: TRADES_USER_EXECUTED_AT_INDEX_NAME,
  }
);

// 4. Execution history index for a specific instrument within a practice account.
TradeSchema.index(
  { practiceAccountId: 1, instrumentId: 1, executedAt: -1 },
  {
    name: TRADES_ACCOUNT_INSTRUMENT_EXECUTED_AT_INDEX_NAME,
  }
);
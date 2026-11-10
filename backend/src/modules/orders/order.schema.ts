import { Schema } from "mongoose";
import {
  INSTRUMENT_EXCHANGES,
  IOrder,
  ORDER_REJECTION_CODES,
  ORDER_SIDES,
  ORDER_STATUSES,
  ORDER_TYPES,
} from "./order.types";

export const ORDER_SYMBOL_MAX_LENGTH = 20;
export const ORDER_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const ORDER_REJECTION_REASON_MAX_LENGTH = 200;

export const ORDERS_ACCOUNT_IDEMPOTENCY_UNIQUE_INDEX_NAME =
  "orders_account_idempotency_unique_idx";
export const ORDERS_ACCOUNT_CREATED_AT_INDEX_NAME =
  "orders_account_created_at_idx";
export const ORDERS_USER_CREATED_AT_INDEX_NAME = "orders_user_created_at_idx";
export const ORDERS_ACCOUNT_STATUS_CREATED_AT_INDEX_NAME =
  "orders_account_status_created_at_idx";

const ORDER_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/**
 * Validates that a normalized order symbol matches the canonical Instrument
 * symbol rules: 1 to 20 characters containing only uppercase ASCII letters (A-Z),
 * digits (0-9), ampersand (&), or hyphen (-).
 */
export function isValidOrderSymbol(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= ORDER_SYMBOL_MAX_LENGTH &&
    ORDER_SYMBOL_PATTERN.test(value)
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
 * Validates that a value is a valid Date instance.
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Validates that `quantity * executionPricePaise` does not exceed
 * `Number.MAX_SAFE_INTEGER` and equals `totalValuePaise`.
 */
export function isSafeOrderMultiplication(
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
 * Order Schema (`orders`).
 *
 * Lifecycle, Synchronous Execution & Concurrency Notes:
 * 1. Purpose: An Order represents a user's market-order trading intent (`BUY` or
 *    `SELL`) and its final outcome (`RECEIVED`, `EXECUTED`, or `REJECTED`).
 *    An Order is not a Trade: rejected orders remain in `orders` for auditability
 *    without creating `Trade` or `LedgerEntry` records or mutating holdings/funds.
 * 2. Synchronous MVP Execution Policy: To prevent server crashes from leaving
 *    orders permanently stuck in `RECEIVED`, the synchronous market-order execution
 *    service must process the request inside a MongoDB transaction and commit the
 *    Order directly in its terminal state (`EXECUTED` alongside Trade, LedgerEntry,
 *    PracticeAccount, and Holding updates, or `REJECTED` for business rejections).
 *    Transient database/infrastructure failures must not be persisted as business
 *    rejections. The `RECEIVED` state remains supported in the schema for potential
 *    future asynchronous order workflows.
 * 3. State Transition Enforcement Limitation: Mongoose schema validators validate
 *    document state at creation/validation time, but do NOT automatically enforce
 *    one-way state transitions across direct database update operations. Any future
 *    asynchronous service transitioning an order from `RECEIVED` to a terminal state
 *    MUST use atomic conditional updates (e.g. `{ _id, status: "RECEIVED" }`).
 */
export const OrderSchema = new Schema<IOrder>(
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
      required: [true, "Order symbol is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      maxlength: [
        ORDER_SYMBOL_MAX_LENGTH,
        `Order symbol must not exceed ${ORDER_SYMBOL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidOrderSymbol,
        message:
          "Order symbol must be 1 to 20 characters using only uppercase letters (A-Z), numbers (0-9), '&', or '-'.",
      },
    },
    exchange: {
      type: String,
      required: [true, "Order exchange is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: INSTRUMENT_EXCHANGES,
        message: "Order exchange must be either 'NSE' or 'BSE'.",
      },
    },
    side: {
      type: String,
      required: [true, "Order side is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: ORDER_SIDES,
        message: "Order side must be either 'BUY' or 'SELL'.",
      },
    },
    orderType: {
      type: String,
      required: [true, "orderType is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      default: "MARKET",
      enum: {
        values: ORDER_TYPES,
        message: "orderType must be 'MARKET'.",
      },
    },
    quantity: {
      type: Number,
      required: [true, "Order quantity is required."],
      immutable: true,
      min: [1, "Order quantity must be at least 1 share."],
      validate: {
        validator: isPositiveSafeInteger,
        message: "Order quantity must be a positive safe integer.",
      },
    },
    status: {
      type: String,
      required: [true, "Order status is required."],
      trim: true,
      uppercase: true,
      enum: {
        values: ORDER_STATUSES,
        message:
          "Order status must be one of 'RECEIVED', 'EXECUTED', or 'REJECTED'.",
      },
      validate: {
        validator: function (this: IOrder, value: unknown): boolean {
          if (value === "RECEIVED") {
            return (
              this.executionPricePaise === undefined &&
              this.totalValuePaise === undefined &&
              this.executedAt === undefined &&
              this.rejectionCode === undefined &&
              this.rejectionReason === undefined &&
              this.rejectedAt === undefined
            );
          }
          if (value === "EXECUTED") {
            return (
              this.rejectionCode === undefined &&
              this.rejectionReason === undefined &&
              this.rejectedAt === undefined
            );
          }
          if (value === "REJECTED") {
            return (
              this.executionPricePaise === undefined &&
              this.totalValuePaise === undefined &&
              this.executedAt === undefined
            );
          }
          return false;
        },
        message:
          "Order fields conflict with the specified status (RECEIVED forbids execution and rejection fields; EXECUTED forbids rejection fields; REJECTED forbids execution fields).",
      },
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required."],
      trim: true,
      immutable: true,
      minlength: [1, "idempotencyKey must not be empty."],
      maxlength: [
        ORDER_IDEMPOTENCY_KEY_MAX_LENGTH,
        `idempotencyKey must not exceed ${ORDER_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "string" &&
          value.trim().length >= 1 &&
          value.length <= ORDER_IDEMPOTENCY_KEY_MAX_LENGTH,
        message: `idempotencyKey must be a non-empty string between 1 and ${ORDER_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      },
    },
    executedQuantity: {
      type: Number,
      required: [true, "executedQuantity is required."],
      default: 0,
      min: [0, "executedQuantity cannot be negative."],
      validate: [
        {
          validator: isNonNegativeSafeInteger,
          message: "executedQuantity must be a non-negative safe integer.",
        },
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (!isNonNegativeSafeInteger(value)) {
              return false;
            }
            if (this.status === "RECEIVED" || this.status === "REJECTED") {
              return value === 0;
            }
            if (this.status === "EXECUTED") {
              return (
                isPositiveSafeInteger(this.quantity) && value === this.quantity
              );
            }
            return true;
          },
          message:
            "executedQuantity must be 0 when status is RECEIVED or REJECTED, and must equal quantity when status is EXECUTED.",
        },
      ],
    },
    executionPricePaise: {
      type: Number,
      required: [
        function (this: IOrder): boolean {
          return this.status === "EXECUTED";
        },
        "executionPricePaise is required when order status is EXECUTED.",
      ],
      min: [1, "executionPricePaise must be at least 1 paise."],
      validate: [
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (value === undefined || value === null) {
              return this.status !== "EXECUTED";
            }
            return this.status === "EXECUTED";
          },
          message:
            "executionPricePaise is only permitted when order status is EXECUTED.",
        },
        {
          validator: isPositiveSafeInteger,
          message:
            "executionPricePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (
              !isPositiveSafeInteger(value) ||
              !isPositiveSafeInteger(this.quantity)
            ) {
              return true;
            }
            return (
              this.quantity <=
              Math.floor(Number.MAX_SAFE_INTEGER / (value as number))
            );
          },
          message:
            "quantity * executionPricePaise exceeds Number.MAX_SAFE_INTEGER.",
        },
      ],
    },
    totalValuePaise: {
      type: Number,
      required: [
        function (this: IOrder): boolean {
          return this.status === "EXECUTED";
        },
        "totalValuePaise is required when order status is EXECUTED.",
      ],
      min: [1, "totalValuePaise must be at least 1 paise."],
      validate: [
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (value === undefined || value === null) {
              return this.status !== "EXECUTED";
            }
            return this.status === "EXECUTED";
          },
          message:
            "totalValuePaise is only permitted when order status is EXECUTED.",
        },
        {
          validator: isPositiveSafeInteger,
          message: "totalValuePaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (this.status !== "EXECUTED") {
              return true;
            }
            if (
              !isPositiveSafeInteger(value) ||
              !isPositiveSafeInteger(this.quantity) ||
              !isPositiveSafeInteger(this.executionPricePaise)
            ) {
              return true;
            }
            return isSafeOrderMultiplication(
              this.quantity,
              this.executionPricePaise,
              value as number
            );
          },
          message:
            "totalValuePaise must equal quantity * executionPricePaise without exceeding Number.MAX_SAFE_INTEGER.",
        },
      ],
    },
    rejectionCode: {
      type: String,
      trim: true,
      uppercase: true,
      required: [
        function (this: IOrder): boolean {
          return this.status === "REJECTED";
        },
        "rejectionCode is required when order status is REJECTED.",
      ],
      enum: {
        values: ORDER_REJECTION_CODES,
        message: "Invalid order rejectionCode.",
      },
      validate: {
        validator: function (this: IOrder, value: unknown): boolean {
          if (value === undefined || value === null) {
            return this.status !== "REJECTED";
          }
          return this.status === "REJECTED";
        },
        message:
          "rejectionCode is only permitted when order status is REJECTED.",
      },
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true,
      minlength: [1, "rejectionReason must not be empty when provided."],
      maxlength: [
        ORDER_REJECTION_REASON_MAX_LENGTH,
        `rejectionReason must not exceed ${ORDER_REJECTION_REASON_MAX_LENGTH} characters.`,
      ],
      validate: [
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (value === undefined || value === null) {
              return true;
            }
            return this.status === "REJECTED";
          },
          message:
            "rejectionReason is only permitted when order status is REJECTED.",
        },
        {
          validator: (value: unknown): boolean =>
            typeof value === "string" &&
            value.trim().length >= 1 &&
            value.length <= ORDER_REJECTION_REASON_MAX_LENGTH,
          message: `rejectionReason must be a non-empty string up to ${ORDER_REJECTION_REASON_MAX_LENGTH} characters.`,
        },
      ],
    },
    executedAt: {
      type: Date,
      required: [
        function (this: IOrder): boolean {
          return this.status === "EXECUTED";
        },
        "executedAt is required when order status is EXECUTED.",
      ],
      validate: [
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (value === undefined || value === null) {
              return this.status !== "EXECUTED";
            }
            return this.status === "EXECUTED";
          },
          message:
            "executedAt is only permitted when order status is EXECUTED.",
        },
        {
          validator: isValidDate,
          message: "executedAt must be a valid Date.",
        },
      ],
    },
    rejectedAt: {
      type: Date,
      required: [
        function (this: IOrder): boolean {
          return this.status === "REJECTED";
        },
        "rejectedAt is required when order status is REJECTED.",
      ],
      validate: [
        {
          validator: function (this: IOrder, value: unknown): boolean {
            if (value === undefined || value === null) {
              return this.status !== "REJECTED";
            }
            return this.status === "REJECTED";
          },
          message:
            "rejectedAt is only permitted when order status is REJECTED.",
        },
        {
          validator: isValidDate,
          message: "rejectedAt must be a valid Date.",
        },
      ],
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "orders",
  }
);

// 1. Unique compound idempotency index per practice account.
OrderSchema.index(
  { practiceAccountId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: ORDERS_ACCOUNT_IDEMPOTENCY_UNIQUE_INDEX_NAME,
  }
);

// 2. Paginated order history index for a single practice account (newest first, deterministic tie-breaker).
OrderSchema.index(
  { practiceAccountId: 1, createdAt: -1, _id: -1 },
  {
    name: ORDERS_ACCOUNT_CREATED_AT_INDEX_NAME,
  }
);

// 3. Paginated order history index across all practice accounts belonging to a user.
OrderSchema.index(
  { userId: 1, createdAt: -1, _id: -1 },
  {
    name: ORDERS_USER_CREATED_AT_INDEX_NAME,
  }
);

// 4. Filtered order history index by status for a practice account.
OrderSchema.index(
  { practiceAccountId: 1, status: 1, createdAt: -1 },
  {
    name: ORDERS_ACCOUNT_STATUS_CREATED_AT_INDEX_NAME,
  }
);

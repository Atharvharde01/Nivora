import { Schema } from "mongoose";
import {
  IPracticeAccount,
  PRACTICE_ACCOUNT_STATUSES,
} from "./account.types";

/**
 * Default virtual starting balance: 100,000,000 paise = ₹10,00,000.00.
 * All monetary amounts in NIVORA are stored as exact safe integer paise.
 */
export const DEFAULT_INITIAL_BALANCE_PAISE = 100_000_000;

export const PRACTICE_ACCOUNTS_ONE_ACTIVE_PER_USER_INDEX_NAME =
  "practice_accounts_one_active_per_user_idx";
export const PRACTICE_ACCOUNTS_USER_ACCOUNT_NUMBER_UNIQUE_INDEX_NAME =
  "practice_accounts_user_account_number_unique_idx";
export const PRACTICE_ACCOUNTS_USER_CREATED_AT_INDEX_NAME =
  "practice_accounts_user_created_at_idx";

/**
 * Validates that a value is a positive safe integer (>= 1 and <= Number.MAX_SAFE_INTEGER).
 */
export function isPositiveSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Validates that a value is a non-negative safe integer (>= 0 and <= Number.MAX_SAFE_INTEGER).
 */
export function isNonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Practice Account Schema (`practice_accounts`).
 *
 * Financial & Concurrency Notes:
 * 1. Integer Paise Representation: All monetary balances (`initialBalancePaise`,
 *    `cashBalancePaise`) are persisted as safe integer paise (₹10,00,000 = 100_000_000 paise).
 *    Formatted rupee strings or floating-point numbers are never stored.
 * 2. Concurrent Balance Updates: Mongoose document validators alone cannot protect
 *    concurrent `$inc` operations from making `cashBalancePaise` negative or
 *    exceeding safe integer bounds. Future balance-changing services MUST use
 *    MongoDB transactions, atomic conditional query filters (e.g.
 *    `status: "ACTIVE"`, `cashBalancePaise: { $gte: debitAmountPaise }`), safe
 *    integer arithmetic checks, and `version` increments.
 */
export const PracticeAccountSchema = new Schema<IPracticeAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required."],
      immutable: true,
    },
    accountNumber: {
      type: Number,
      required: [true, "accountNumber is required."],
      immutable: true,
      min: [1, "accountNumber must be at least 1."],
      validate: {
        validator: isPositiveSafeInteger,
        message: "accountNumber must be a positive safe integer.",
      },
    },
    status: {
      type: String,
      required: [true, "Practice account status is required."],
      enum: {
        values: PRACTICE_ACCOUNT_STATUSES,
        message: "Invalid practice account status.",
      },
      default: "ACTIVE",
    },
    initialBalancePaise: {
      type: Number,
      required: [true, "initialBalancePaise is required."],
      default: DEFAULT_INITIAL_BALANCE_PAISE,
      immutable: true,
      min: [1, "initialBalancePaise must be at least 1 paise."],
      validate: {
        validator: isPositiveSafeInteger,
        message: "initialBalancePaise must be a positive safe integer.",
      },
    },
    cashBalancePaise: {
      type: Number,
      required: [true, "cashBalancePaise is required."],
      default: DEFAULT_INITIAL_BALANCE_PAISE,
      min: [0, "cashBalancePaise cannot be negative."],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "cashBalancePaise must be a non-negative safe integer.",
      },
    },
    version: {
      type: Number,
      required: [true, "version is required."],
      default: 0,
      min: [0, "version cannot be negative."],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "version must be a non-negative safe integer.",
      },
    },
    archivedAt: {
      type: Date,
      required: [
        function (this: IPracticeAccount): boolean {
          return this.status === "ARCHIVED";
        },
        "archivedAt is required when practice account status is ARCHIVED.",
      ],
      validate: {
        validator: function (this: IPracticeAccount, value: unknown): boolean {
          if (this.status === "ACTIVE") {
            return value === undefined || value === null;
          }
          return value instanceof Date && !Number.isNaN(value.getTime());
        },
        message: "ACTIVE practice account must not have archivedAt.",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "practice_accounts",
  }
);

// 1. Database-level concurrency guarantee: at most one ACTIVE practice account per user.
PracticeAccountSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: PRACTICE_ACCOUNTS_ONE_ACTIVE_PER_USER_INDEX_NAME,
  }
);

// 2. Unique account number per user across active and archived accounts.
PracticeAccountSchema.index(
  { userId: 1, accountNumber: 1 },
  {
    unique: true,
    name: PRACTICE_ACCOUNTS_USER_ACCOUNT_NUMBER_UNIQUE_INDEX_NAME,
  }
);

// 3. Account history lookup index per user (most recent first).
PracticeAccountSchema.index(
  { userId: 1, createdAt: -1 },
  {
    name: PRACTICE_ACCOUNTS_USER_CREATED_AT_INDEX_NAME,
  }
);


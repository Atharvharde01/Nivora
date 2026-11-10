import { Schema } from "mongoose";
import {
  ILedgerEntry,
  LEDGER_DIRECTIONS,
  LEDGER_ENTRY_TYPES,
  LEDGER_REFERENCE_TYPES,
  LedgerDirection,
  LedgerEntryType,
} from "./ledger.types";

export const LEDGER_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const LEDGER_DESCRIPTION_MAX_LENGTH = 200;

export const LEDGER_ACCOUNT_IDEMPOTENCY_UNIQUE_INDEX_NAME =
  "ledger_entries_account_idempotency_unique_idx";
export const LEDGER_ACCOUNT_CREATED_AT_INDEX_NAME =
  "ledger_entries_account_created_at_idx";
export const LEDGER_USER_CREATED_AT_INDEX_NAME =
  "ledger_entries_user_created_at_idx";
export const LEDGER_REFERENCE_LOOKUP_INDEX_NAME =
  "ledger_entries_reference_lookup_idx";

/**
 * Validates that a value is a positive safe integer (>= 1 and <= Number.MAX_SAFE_INTEGER).
 * Rejects zero, negative values, decimals, NaN, Infinity, and unsafe integers.
 */
export function isPositiveSafeIntegerPaise(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Validates that a value is a non-negative safe integer (>= 0 and <= Number.MAX_SAFE_INTEGER).
 * Rejects negative values, decimals, NaN, Infinity, and unsafe integers.
 */
export function isNonNegativeSafeIntegerPaise(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates that `entryType` and `direction` form an allowed combination:
 * - INITIAL_FUNDING -> CREDIT only
 * - BUY_EXECUTION   -> DEBIT only
 * - SELL_EXECUTION  -> CREDIT only
 * - TRADE_REVERSAL  -> CREDIT or DEBIT
 * - ADJUSTMENT      -> CREDIT or DEBIT
 */
export function isValidLedgerEntryDirectionPair(
  entryType: LedgerEntryType,
  direction: LedgerDirection
): boolean {
  switch (entryType) {
    case "INITIAL_FUNDING":
      return direction === "CREDIT";
    case "BUY_EXECUTION":
      return direction === "DEBIT";
    case "SELL_EXECUTION":
      return direction === "CREDIT";
    case "TRADE_REVERSAL":
    case "ADJUSTMENT":
      return direction === "CREDIT" || direction === "DEBIT";
    default:
      return false;
  }
}

/**
 * Validates that a ledger entry's `balanceBeforePaise`, `amountPaise`, `direction`,
 * and `balanceAfterPaise` satisfy the exact safe-integer reconciliation invariant:
 * - For CREDIT: balanceBeforePaise + amountPaise <= Number.MAX_SAFE_INTEGER
 *               and balanceAfterPaise === balanceBeforePaise + amountPaise
 * - For DEBIT:  balanceBeforePaise >= amountPaise
 *               and balanceAfterPaise === balanceBeforePaise - amountPaise
 */
export function isReconciledLedgerBalance(
  direction: LedgerDirection,
  amountPaise: number,
  balanceBeforePaise: number,
  balanceAfterPaise: number
): boolean {
  if (
    !isPositiveSafeIntegerPaise(amountPaise) ||
    !isNonNegativeSafeIntegerPaise(balanceBeforePaise) ||
    !isNonNegativeSafeIntegerPaise(balanceAfterPaise)
  ) {
    return false;
  }

  if (direction === "CREDIT") {
    if (balanceBeforePaise > Number.MAX_SAFE_INTEGER - amountPaise) {
      return false;
    }
    return balanceAfterPaise === balanceBeforePaise + amountPaise;
  }

  if (direction === "DEBIT") {
    if (balanceBeforePaise < amountPaise) {
      return false;
    }
    return balanceAfterPaise === balanceBeforePaise - amountPaise;
  }

  return false;
}

/**
 * Immutable Cash Ledger Schema (`ledger_entries`).
 *
 * Financial, Concurrency & Append-Only Notes:
 * 1. Append-Only Audit Trail: Each document records one immutable virtual cash
 *    movement for a practice account (`INITIAL_FUNDING`, `BUY_EXECUTION`,
 *    `SELL_EXECUTION`, `TRADE_REVERSAL`, `ADJUSTMENT`).
 * 2. Integer Paise Representation: All monetary values (`amountPaise`,
 *    `balanceBeforePaise`, `balanceAfterPaise`) are stored as exact safe integer
 *    paise (e.g., ₹125.75 = 12575 paise). Floating-point arithmetic is never used.
 * 3. Defense-in-Depth Immutability Limitation: Marking fields `immutable: true` in
 *    Mongoose prevents in-memory document mutations after creation (`doc.isNew === false`)
 *    and strips immutable fields from standard Mongoose update queries, and
 *    `timestamps: { createdAt: true, updatedAt: false }` omits `updatedAt`. However,
 *    Mongoose schema immutability does NOT independently guarantee database-level
 *    append-only protection against direct driver commands (`updateOne`, `deleteOne`,
 *    `findOneAndUpdate`) or privileged database credentials. Future service-layer
 *    implementations and MongoDB role permissions must strictly prohibit update and
 *    delete operations on `ledger_entries`.
 */
export const LedgerEntrySchema = new Schema<ILedgerEntry>(
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
    entryType: {
      type: String,
      required: [true, "entryType is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: LEDGER_ENTRY_TYPES,
        message: "Invalid ledger entryType.",
      },
    },
    direction: {
      type: String,
      required: [true, "direction is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: LEDGER_DIRECTIONS,
        message: "Ledger direction must be either 'CREDIT' or 'DEBIT'.",
      },
      validate: {
        validator: function (this: ILedgerEntry, value: unknown): boolean {
          if (
            typeof value !== "string" ||
            !(LEDGER_DIRECTIONS as readonly string[]).includes(value)
          ) {
            return false;
          }
          if (
            typeof this.entryType === "string" &&
            (LEDGER_ENTRY_TYPES as readonly string[]).includes(this.entryType)
          ) {
            return isValidLedgerEntryDirectionPair(
              this.entryType,
              value as LedgerDirection
            );
          }
          return true;
        },
        message:
          "direction is incompatible with entryType (INITIAL_FUNDING and SELL_EXECUTION require CREDIT; BUY_EXECUTION requires DEBIT).",
      },
    },
    amountPaise: {
      type: Number,
      required: [true, "amountPaise is required."],
      immutable: true,
      min: [1, "amountPaise must be at least 1 paise."],
      validate: [
        {
          validator: isPositiveSafeIntegerPaise,
          message: "amountPaise must be a positive safe integer in paise.",
        },
        {
          validator: function (this: ILedgerEntry, value: unknown): boolean {
            if (
              !isPositiveSafeIntegerPaise(value) ||
              !isNonNegativeSafeIntegerPaise(this.balanceBeforePaise)
            ) {
              return true;
            }
            if (this.direction === "DEBIT") {
              return this.balanceBeforePaise >= (value as number);
            }
            if (this.direction === "CREDIT") {
              return (
                this.balanceBeforePaise <=
                Number.MAX_SAFE_INTEGER - (value as number)
              );
            }
            return true;
          },
          message:
            "amountPaise either exceeds balanceBeforePaise on a DEBIT or causes safe-integer overflow on a CREDIT.",
        },
      ],
    },
    balanceBeforePaise: {
      type: Number,
      required: [true, "balanceBeforePaise is required."],
      immutable: true,
      min: [0, "balanceBeforePaise cannot be negative."],
      validate: {
        validator: isNonNegativeSafeIntegerPaise,
        message:
          "balanceBeforePaise must be a non-negative safe integer in paise.",
      },
    },
    balanceAfterPaise: {
      type: Number,
      required: [true, "balanceAfterPaise is required."],
      immutable: true,
      min: [0, "balanceAfterPaise cannot be negative."],
      validate: [
        {
          validator: isNonNegativeSafeIntegerPaise,
          message:
            "balanceAfterPaise must be a non-negative safe integer in paise.",
        },
        {
          validator: function (this: ILedgerEntry, value: unknown): boolean {
            if (
              !isNonNegativeSafeIntegerPaise(value) ||
              !isPositiveSafeIntegerPaise(this.amountPaise) ||
              !isNonNegativeSafeIntegerPaise(this.balanceBeforePaise) ||
              (this.direction !== "CREDIT" && this.direction !== "DEBIT")
            ) {
              return true;
            }
            return isReconciledLedgerBalance(
              this.direction,
              this.amountPaise,
              this.balanceBeforePaise,
              value as number
            );
          },
          message:
            "balanceAfterPaise does not reconcile with balanceBeforePaise, amountPaise, and direction.",
        },
      ],
    },
    referenceType: {
      type: String,
      required: [true, "referenceType is required."],
      trim: true,
      uppercase: true,
      immutable: true,
      enum: {
        values: LEDGER_REFERENCE_TYPES,
        message: "Invalid ledger referenceType.",
      },
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      required: [true, "referenceId is required."],
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required."],
      trim: true,
      immutable: true,
      minlength: [1, "idempotencyKey must not be empty."],
      maxlength: [
        LEDGER_IDEMPOTENCY_KEY_MAX_LENGTH,
        `idempotencyKey must not exceed ${LEDGER_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "string" &&
          value.trim().length >= 1 &&
          value.length <= LEDGER_IDEMPOTENCY_KEY_MAX_LENGTH,
        message: `idempotencyKey must be a non-empty string between 1 and ${LEDGER_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      },
    },
    description: {
      type: String,
      required: false,
      trim: true,
      immutable: true,
      minlength: [1, "description must not be empty when provided."],
      maxlength: [
        LEDGER_DESCRIPTION_MAX_LENGTH,
        `description must not exceed ${LEDGER_DESCRIPTION_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "string" &&
          value.trim().length >= 1 &&
          value.length <= LEDGER_DESCRIPTION_MAX_LENGTH,
        message: `description must be a non-empty string up to ${LEDGER_DESCRIPTION_MAX_LENGTH} characters.`,
      },
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    strict: "throw",
    collection: "ledger_entries",
  }
);

// 1. Unique compound idempotency index per practice account.
LedgerEntrySchema.index(
  { practiceAccountId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: LEDGER_ACCOUNT_IDEMPOTENCY_UNIQUE_INDEX_NAME,
  }
);

// 2. Paginated ledger history index for a single practice account (newest first, deterministic tie-breaker).
LedgerEntrySchema.index(
  { practiceAccountId: 1, createdAt: -1, _id: -1 },
  {
    name: LEDGER_ACCOUNT_CREATED_AT_INDEX_NAME,
  }
);

// 3. Paginated ledger history index across all practice accounts belonging to a user.
LedgerEntrySchema.index(
  { userId: 1, createdAt: -1, _id: -1 },
  {
    name: LEDGER_USER_CREATED_AT_INDEX_NAME,
  }
);

// 4. Reference lookup index for correlating ledger movements to accounts, trades, or adjustments.
LedgerEntrySchema.index(
  { referenceType: 1, referenceId: 1 },
  {
    name: LEDGER_REFERENCE_LOOKUP_INDEX_NAME,
  }
);

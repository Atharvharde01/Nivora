import { Schema } from "mongoose";
import { IWatchlistItem } from "./watchlist.types";

export const WATCHLIST_SYMBOL_MAX_LENGTH = 20;
export const WATCHLIST_SORT_ORDER_DEFAULT = 0;
export const WATCHLIST_SORT_ORDER_MIN = 0;
export const WATCHLIST_SORT_ORDER_MAX = 49;
export const WATCHLIST_MAX_ITEMS_PER_USER = 50;

export const WATCHLIST_ITEMS_USER_INSTRUMENT_UNIQUE_INDEX_NAME =
  "watchlist_items_user_instrument_unique_idx";
export const WATCHLIST_ITEMS_USER_SORT_ORDER_INDEX_NAME =
  "watchlist_items_user_sort_order_idx";

const WATCHLIST_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/**
 * Validates that a normalized symbol snapshot matches NIVORA's instrument symbol rules
 * (1 to 20 characters using uppercase ASCII letters A-Z, digits 0-9, '&', or '-').
 */
export function isValidWatchlistSymbolSnapshot(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= WATCHLIST_SYMBOL_MAX_LENGTH &&
    WATCHLIST_SYMBOL_PATTERN.test(value)
  );
}

/**
 * Validates that `sortOrder` is an integer within [0, 49].
 */
export function isValidWatchlistSortOrder(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= WATCHLIST_SORT_ORDER_MIN &&
    value <= WATCHLIST_SORT_ORDER_MAX
  );
}

/**
 * Watchlist Item Schema (`watchlist_items`).
 *
 * Architectural, Ownership & Capacity Notes:
 * 1. User-Level Ownership: Watchlists belong to users (`userId`), NOT practice
 *    accounts. Resetting or archiving a practice account must never remove or reset
 *    the user's watchlist items.
 * 2. Display Snapshot Only: `symbolSnapshot` is a denormalized display snapshot
 *    populated from the authoritative `Instrument` record (`instrumentId`). It is
 *    not the authoritative instrument identity and is not globally unique.
 * 3. Cross-Document Capacity Enforcement (Max 50 per User): The intended product
 *    limit is 50 watchlist items per user (`WATCHLIST_MAX_ITEMS_PER_USER = 50`).
 *    A Mongoose field validator on `sortOrder` (0..49) CANNOT enforce a cross-document
 *    count across the collection because `sortOrder` is non-unique (multiple items
 *    may temporarily share a `sortOrder` during reorder operations). The future
 *    watchlist service MUST enforce the 50-item maximum per user atomically,
 *    accounting for concurrent additions.
 */
export const WatchlistItemSchema = new Schema<IWatchlistItem>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required."],
      immutable: true,
    },
    instrumentId: {
      type: Schema.Types.ObjectId,
      ref: "Instrument",
      required: [true, "instrumentId is required."],
      immutable: true,
    },
    symbolSnapshot: {
      type: String,
      required: [true, "symbolSnapshot is required."],
      trim: true,
      uppercase: true,
      maxlength: [
        WATCHLIST_SYMBOL_MAX_LENGTH,
        `symbolSnapshot must not exceed ${WATCHLIST_SYMBOL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidWatchlistSymbolSnapshot,
        message:
          "symbolSnapshot must be 1 to 20 characters using only uppercase letters (A-Z), numbers (0-9), '&', or '-'.",
      },
    },
    sortOrder: {
      type: Number,
      required: [true, "sortOrder is required."],
      default: WATCHLIST_SORT_ORDER_DEFAULT,
      min: [
        WATCHLIST_SORT_ORDER_MIN,
        `sortOrder must be at least ${WATCHLIST_SORT_ORDER_MIN}.`,
      ],
      max: [
        WATCHLIST_SORT_ORDER_MAX,
        `sortOrder must not exceed ${WATCHLIST_SORT_ORDER_MAX}.`,
      ],
      validate: {
        validator: isValidWatchlistSortOrder,
        message: `sortOrder must be an integer between ${WATCHLIST_SORT_ORDER_MIN} and ${WATCHLIST_SORT_ORDER_MAX}.`,
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "watchlist_items",
  }
);

// 1. Unique compound index preventing a user from adding the same instrument twice.
WatchlistItemSchema.index(
  { userId: 1, instrumentId: 1 },
  {
    unique: true,
    name: WATCHLIST_ITEMS_USER_INSTRUMENT_UNIQUE_INDEX_NAME,
  }
);

// 2. Non-unique compound index supporting retrieval of a user's watchlist in display order.
//    Intentionally non-unique so multiple items may temporarily share a sortOrder during reorders.
WatchlistItemSchema.index(
  { userId: 1, sortOrder: 1 },
  {
    name: WATCHLIST_ITEMS_USER_SORT_ORDER_INDEX_NAME,
  }
);

import { ClientSession, Types } from "mongoose";
import { InstrumentModel } from "../instruments/instrument.model";
import { InstrumentQuoteService } from "../instruments/instrument-quote.service";
import { executeMongoTransaction } from "../practice-accounts/account.service";
import { TransactionRunner } from "../practice-accounts/account.service.types";
import { WatchlistItemModel } from "./watchlist.model";
import {
  WATCHLIST_MAX_ITEMS_PER_USER,
  WATCHLIST_SORT_ORDER_MAX,
} from "./watchlist.schema";
import {
  WatchlistError,
  WatchlistErrorCode,
  WatchlistItemView,
  WatchlistQuoteView,
  WatchlistServiceOptions,
} from "./watchlist.types";

function resolveObjectId(
  rawId: Types.ObjectId | string,
  errorCode: WatchlistErrorCode,
  fieldName: string
): Types.ObjectId {
  if (rawId instanceof Types.ObjectId) {
    return rawId;
  }
  if (
    typeof rawId === "string" &&
    Types.ObjectId.isValid(rawId) &&
    new Types.ObjectId(rawId).toString() === rawId.trim()
  ) {
    return new Types.ObjectId(rawId.trim());
  }
  throw new WatchlistError(
    errorCode,
    `${fieldName} must be a valid MongoDB ObjectId.`,
    400
  );
}

export class WatchlistService {
  private readonly runInTransaction: TransactionRunner;
  private readonly quoteService: {
    getQuoteByInstrumentId(
      instrumentId: Types.ObjectId | string,
      options?: { session?: ClientSession; requireFresh?: boolean; requireTradable?: boolean }
    ): Promise<{
      lastPricePaise: number;
      bidPricePaise: number;
      askPricePaise: number;
      previousClosePaise: number;
      priceUpdatedAt: Date;
      isStale: boolean;
    }>;
  };

  constructor(options: WatchlistServiceOptions = {}) {
    this.runInTransaction =
      options.runInTransaction ?? executeMongoTransaction;
    this.quoteService =
      options.quoteService ?? new InstrumentQuoteService();
  }

  /**
   * Retrieves all watchlist items for a user in display order, enriched with
   * authoritative instrument metadata and real-time quote snapshots.
   */
  public async getUserWatchlist(
    userId: Types.ObjectId | string
  ): Promise<WatchlistItemView[]> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );

    const items = await WatchlistItemModel.find({ userId: resolvedUserId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    if (items.length === 0) {
      return [];
    }

    const instrumentIds = items.map((item) => item.instrumentId);
    const instruments = await InstrumentModel.find({
      _id: { $in: instrumentIds },
    }).lean();

    const instrumentMap = new Map(
      instruments.map((inst) => [inst._id.toString(), inst])
    );

    const quotes = await Promise.all(
      items.map(async (item) => {
        try {
          const quote = await this.quoteService.getQuoteByInstrumentId(
            item.instrumentId,
            { requireFresh: false, requireTradable: false }
          );
          return {
            lastPricePaise: quote.lastPricePaise,
            bidPricePaise: quote.bidPricePaise,
            askPricePaise: quote.askPricePaise,
            previousClosePaise: quote.previousClosePaise,
            priceUpdatedAt: quote.priceUpdatedAt,
            isStale: quote.isStale,
          } satisfies WatchlistQuoteView;
        } catch {
          return null;
        }
      })
    );

    return items.map((item, index) => {
      const inst = instrumentMap.get(item.instrumentId.toString());
      return {
        id: item._id.toString(),
        userId: item.userId.toString(),
        instrumentId: item.instrumentId.toString(),
        symbol: inst ? inst.symbol : item.symbolSnapshot,
        name: inst ? inst.name : item.symbolSnapshot,
        exchange: inst ? inst.exchange : "NSE",
        isTradable: inst ? inst.isTradable : true,
        sortOrder: item.sortOrder,
        quote: quotes[index],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  }

  /**
   * Atomically adds an instrument to a user's watchlist.
   * Enforces:
   * 1. 50-item hard limit per user under concurrent conditions.
   * 2. Uniqueness (cannot add same instrument twice).
   * 3. Instrument existence in catalog.
   */
  public async addWatchlistItem(
    userId: Types.ObjectId | string,
    instrumentId: Types.ObjectId | string
  ): Promise<WatchlistItemView> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );
    const resolvedInstrumentId = resolveObjectId(
      instrumentId,
      "INVALID_INSTRUMENT_ID",
      "instrumentId"
    );

    const createdRecord = await this.runInTransaction(async (session) => {
      // 1. Check instrument existence in authoritative catalog
      const instrument = await InstrumentModel.findById(
        resolvedInstrumentId
      ).session(session ?? null);

      if (!instrument) {
        throw new WatchlistError(
          "INSTRUMENT_NOT_FOUND",
          `Instrument ${resolvedInstrumentId.toString()} was not found.`,
          404
        );
      }

      // 2. Check duplicate entry
      const existingItem = await WatchlistItemModel.findOne({
        userId: resolvedUserId,
        instrumentId: resolvedInstrumentId,
      }).session(session ?? null);

      if (existingItem) {
        throw new WatchlistError(
          "WATCHLIST_ITEM_ALREADY_EXISTS",
          `Instrument ${instrument.symbol} is already in your watchlist.`,
          409
        );
      }

      // 3. Atomically check capacity limit (max 50)
      const count = await WatchlistItemModel.countDocuments({
        userId: resolvedUserId,
      }).session(session ?? null);

      if (count >= WATCHLIST_MAX_ITEMS_PER_USER) {
        throw new WatchlistError(
          "WATCHLIST_CAPACITY_EXCEEDED",
          `Watchlist cannot exceed ${WATCHLIST_MAX_ITEMS_PER_USER} items.`,
          400
        );
      }

      // 4. Calculate next sortOrder
      const highestSortItem = await WatchlistItemModel.findOne({
        userId: resolvedUserId,
      })
        .sort({ sortOrder: -1 })
        .session(session ?? null);

      const nextSortOrder =
        highestSortItem !== null
          ? Math.min(WATCHLIST_SORT_ORDER_MAX, highestSortItem.sortOrder + 1)
          : 0;

      const doc = new WatchlistItemModel({
        userId: resolvedUserId,
        instrumentId: resolvedInstrumentId,
        symbolSnapshot: instrument.symbol,
        sortOrder: nextSortOrder,
      });

      await doc.save({ session });

      return {
        id: doc._id.toString(),
        userId: resolvedUserId.toString(),
        instrumentId: resolvedInstrumentId.toString(),
        symbol: instrument.symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        isTradable: instrument.isTradable,
        sortOrder: nextSortOrder,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    // Enrich with quote snapshot
    let quoteView: WatchlistQuoteView | null = null;
    try {
      const quote = await this.quoteService.getQuoteByInstrumentId(
        resolvedInstrumentId,
        { requireFresh: false, requireTradable: false }
      );
      quoteView = {
        lastPricePaise: quote.lastPricePaise,
        bidPricePaise: quote.bidPricePaise,
        askPricePaise: quote.askPricePaise,
        previousClosePaise: quote.previousClosePaise,
        priceUpdatedAt: quote.priceUpdatedAt,
        isStale: quote.isStale,
      };
    } catch {
      quoteView = null;
    }

    return {
      ...createdRecord,
      quote: quoteView,
    };
  }

  /**
   * Atomically removes an instrument from a user's watchlist and compacts sortOrder.
   */
  public async removeWatchlistItem(
    userId: Types.ObjectId | string,
    instrumentId: Types.ObjectId | string
  ): Promise<{ success: boolean; removedInstrumentId: string }> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );
    const resolvedInstrumentId = resolveObjectId(
      instrumentId,
      "INVALID_INSTRUMENT_ID",
      "instrumentId"
    );

    await this.runInTransaction(async (session) => {
      const deleted = await WatchlistItemModel.findOneAndDelete({
        userId: resolvedUserId,
        instrumentId: resolvedInstrumentId,
      }).session(session ?? null);

      if (!deleted) {
        throw new WatchlistError(
          "WATCHLIST_ITEM_NOT_FOUND",
          `Instrument ${resolvedInstrumentId.toString()} is not in your watchlist.`,
          404
        );
      }

      // Compact remaining items sortOrder
      const remainingItems = await WatchlistItemModel.find({
        userId: resolvedUserId,
      })
        .sort({ sortOrder: 1, createdAt: 1 })
        .session(session ?? null);

      if (remainingItems.length > 0) {
        const bulkOps = remainingItems.map((item, idx) => ({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: { sortOrder: idx } },
          },
        }));

        await WatchlistItemModel.bulkWrite(bulkOps, { session });
      }
    });

    return {
      success: true,
      removedInstrumentId: resolvedInstrumentId.toString(),
    };
  }

  /**
   * Reorders a user's watchlist.
   * Input must contain the exact set of instrument IDs currently in user's watchlist.
   */
  public async reorderWatchlist(
    userId: Types.ObjectId | string,
    rawInstrumentIds: unknown
  ): Promise<WatchlistItemView[]> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );

    if (!Array.isArray(rawInstrumentIds)) {
      throw new WatchlistError(
        "INVALID_REORDER_PAYLOAD",
        "instrumentIds must be an array of instrument ID strings.",
        400
      );
    }

    if (rawInstrumentIds.length === 0) {
      throw new WatchlistError(
        "INVALID_REORDER_PAYLOAD",
        "instrumentIds array must not be empty.",
        400
      );
    }

    const validatedIds = rawInstrumentIds.map((id, idx) =>
      resolveObjectId(
        id as string,
        "INVALID_REORDER_PAYLOAD",
        `instrumentIds[${idx}]`
      ).toString()
    );

    // Check duplicates
    if (new Set(validatedIds).size !== validatedIds.length) {
      throw new WatchlistError(
        "INVALID_REORDER_PAYLOAD",
        "instrumentIds must not contain duplicate instrument IDs.",
        400
      );
    }

    await this.runInTransaction(async (session) => {
      const currentItems = await WatchlistItemModel.find({
        userId: resolvedUserId,
      }).session(session ?? null);

      if (currentItems.length !== validatedIds.length) {
        throw new WatchlistError(
          "INVALID_REORDER_PAYLOAD",
          `instrumentIds length (${validatedIds.length}) does not match current watchlist item count (${currentItems.length}).`,
          400
        );
      }

      const itemByInstrumentId = new Map(
        currentItems.map((item) => [item.instrumentId.toString(), item])
      );

      for (const id of validatedIds) {
        if (!itemByInstrumentId.has(id)) {
          throw new WatchlistError(
            "INVALID_REORDER_PAYLOAD",
            `Instrument ${id} is not present in your current watchlist.`,
            400
          );
        }
      }

      // Assign new sortOrders 0 .. N-1
      const bulkOps = validatedIds.map((id, index) => {
        const item = itemByInstrumentId.get(id)!;
        return {
          updateOne: {
            filter: { _id: item._id },
            update: { $set: { sortOrder: index } },
          },
        };
      });

      await WatchlistItemModel.bulkWrite(bulkOps, { session });
    });

    return await this.getUserWatchlist(resolvedUserId);
  }
}

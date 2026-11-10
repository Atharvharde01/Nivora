import mongoose from "mongoose";
import { IWatchlistItem, WatchlistItemModelType } from "./watchlist.types";
import { WatchlistItemSchema } from "./watchlist.schema";

export const WATCHLIST_ITEM_MODEL_NAME = "WatchlistItem";
export const WATCHLIST_ITEM_COLLECTION_NAME = "watchlist_items";

export const WatchlistItemModel: WatchlistItemModelType =
  (mongoose.models[WATCHLIST_ITEM_MODEL_NAME] as
    | WatchlistItemModelType
    | undefined) ??
  mongoose.model<IWatchlistItem>(
    WATCHLIST_ITEM_MODEL_NAME,
    WatchlistItemSchema,
    WATCHLIST_ITEM_COLLECTION_NAME
  );

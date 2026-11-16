import { ClientSession, HydratedDocument, Model, Types } from "mongoose";
import { TransactionRunner } from "../practice-accounts/account.service.types";

export interface IWatchlistItem {
  userId: Types.ObjectId;
  instrumentId: Types.ObjectId;
  symbolSnapshot: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type WatchlistItemDocument = HydratedDocument<IWatchlistItem>;

export type WatchlistItemModelType = Model<IWatchlistItem>;

export const WATCHLIST_ERROR_CODES = [
  "INVALID_USER_ID",
  "INVALID_INSTRUMENT_ID",
  "INSTRUMENT_NOT_FOUND",
  "WATCHLIST_CAPACITY_EXCEEDED",
  "WATCHLIST_ITEM_ALREADY_EXISTS",
  "WATCHLIST_ITEM_NOT_FOUND",
  "INVALID_REORDER_PAYLOAD",
  "TRANSACTION_UNAVAILABLE",
  "WATCHLIST_ERROR",
] as const;

export type WatchlistErrorCode = (typeof WATCHLIST_ERROR_CODES)[number];

export class WatchlistError extends Error {
  public readonly code: WatchlistErrorCode;
  public readonly statusCode: number;

  constructor(code: WatchlistErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "WatchlistError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, WatchlistError.prototype);
  }
}

export interface WatchlistQuoteView {
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  priceUpdatedAt: Date;
  isStale: boolean;
}

export interface WatchlistItemView {
  id: string;
  userId: string;
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  isTradable: boolean;
  sortOrder: number;
  quote: WatchlistQuoteView | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchlistServiceOptions {
  runInTransaction?: TransactionRunner;
  quoteService?: {
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
}

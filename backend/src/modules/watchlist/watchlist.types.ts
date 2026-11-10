import { HydratedDocument, Model, Types } from "mongoose";

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

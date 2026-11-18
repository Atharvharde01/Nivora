import mongoose from "mongoose";
import { MarketIndexSchema } from "./market-index.schema";
import { IMarketIndex, MarketIndexModelType } from "./market-index.types";

export const MARKET_INDEX_MODEL_NAME = "MarketIndex";
export const MARKET_INDEX_COLLECTION_NAME = "market_indices";

export const MarketIndexModel: MarketIndexModelType =
  (mongoose.models[MARKET_INDEX_MODEL_NAME] as MarketIndexModelType) ||
  mongoose.model<IMarketIndex>(
    MARKET_INDEX_MODEL_NAME,
    MarketIndexSchema,
    MARKET_INDEX_COLLECTION_NAME
  );

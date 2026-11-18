import mongoose from "mongoose";
import { MarketIndexCandleSchema } from "./market-index-candle.schema";
import {
  IMarketIndexCandle,
  MarketIndexCandleModelType,
} from "./market-candle.types";

export const MARKET_INDEX_CANDLE_MODEL_NAME = "MarketIndexCandle";
export const MARKET_INDEX_CANDLE_COLLECTION_NAME = "market_index_candles";

export const MarketIndexCandleModel: MarketIndexCandleModelType =
  (mongoose.models[
    MARKET_INDEX_CANDLE_MODEL_NAME
  ] as MarketIndexCandleModelType) ||
  mongoose.model<IMarketIndexCandle>(
    MARKET_INDEX_CANDLE_MODEL_NAME,
    MarketIndexCandleSchema,
    MARKET_INDEX_CANDLE_COLLECTION_NAME
  );

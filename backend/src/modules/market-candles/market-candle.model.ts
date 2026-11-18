import mongoose from "mongoose";
import { MarketCandleSchema } from "./market-candle.schema";
import { IMarketCandle, MarketCandleModelType } from "./market-candle.types";

export const MARKET_CANDLE_MODEL_NAME = "MarketCandle";
export const MARKET_CANDLE_COLLECTION_NAME = "market_candles";

export const MarketCandleModel: MarketCandleModelType =
  (mongoose.models[MARKET_CANDLE_MODEL_NAME] as
    | MarketCandleModelType
    | undefined) ??
  mongoose.model<IMarketCandle>(
    MARKET_CANDLE_MODEL_NAME,
    MarketCandleSchema,
    MARKET_CANDLE_COLLECTION_NAME
  );

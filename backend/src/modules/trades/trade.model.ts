import mongoose from "mongoose";
import { ITrade, TradeModelType } from "./trade.types";
import { TradeSchema } from "./trade.schema";

export const TRADE_MODEL_NAME = "Trade";
export const TRADE_COLLECTION_NAME = "trades";

export const TradeModel: TradeModelType =
  (mongoose.models[TRADE_MODEL_NAME] as TradeModelType | undefined) ??
  mongoose.model<ITrade>(
    TRADE_MODEL_NAME,
    TradeSchema,
    TRADE_COLLECTION_NAME
  );
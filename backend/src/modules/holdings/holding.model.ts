import mongoose from "mongoose";
import { HoldingModelType, IHolding } from "./holding.types";
import { HoldingSchema } from "./holding.schema";

export const HOLDING_MODEL_NAME = "Holding";
export const HOLDING_COLLECTION_NAME = "holdings";

export const HoldingModel: HoldingModelType =
  (mongoose.models[HOLDING_MODEL_NAME] as HoldingModelType | undefined) ??
  mongoose.model<IHolding>(
    HOLDING_MODEL_NAME,
    HoldingSchema,
    HOLDING_COLLECTION_NAME
  );

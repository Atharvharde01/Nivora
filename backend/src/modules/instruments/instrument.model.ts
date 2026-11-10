import mongoose from "mongoose";
import { IInstrument, InstrumentModelType } from "./instrument.types";
import { InstrumentSchema } from "./instrument.schema";

export const INSTRUMENT_MODEL_NAME = "Instrument";
export const INSTRUMENT_COLLECTION_NAME = "instruments";

export const InstrumentModel: InstrumentModelType =
  (mongoose.models[INSTRUMENT_MODEL_NAME] as
    | InstrumentModelType
    | undefined) ??
  mongoose.model<IInstrument>(
    INSTRUMENT_MODEL_NAME,
    InstrumentSchema,
    INSTRUMENT_COLLECTION_NAME
  );

import mongoose from "mongoose";
import { ILedgerEntry, LedgerEntryModelType } from "./ledger.types";
import { LedgerEntrySchema } from "./ledger.schema";

export const LEDGER_ENTRY_MODEL_NAME = "LedgerEntry";
export const LEDGER_ENTRY_COLLECTION_NAME = "ledger_entries";

export const LedgerEntryModel: LedgerEntryModelType =
  (mongoose.models[LEDGER_ENTRY_MODEL_NAME] as
    | LedgerEntryModelType
    | undefined) ??
  mongoose.model<ILedgerEntry>(
    LEDGER_ENTRY_MODEL_NAME,
    LedgerEntrySchema,
    LEDGER_ENTRY_COLLECTION_NAME
  );

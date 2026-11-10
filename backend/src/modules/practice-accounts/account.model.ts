import mongoose from "mongoose";
import { IPracticeAccount, PracticeAccountModelType } from "./account.types";
import { PracticeAccountSchema } from "./account.schema";

export const PRACTICE_ACCOUNT_MODEL_NAME = "PracticeAccount";
export const PRACTICE_ACCOUNT_COLLECTION_NAME = "practice_accounts";

export const PracticeAccountModel: PracticeAccountModelType =
  (mongoose.models[PRACTICE_ACCOUNT_MODEL_NAME] as
    | PracticeAccountModelType
    | undefined) ??
  mongoose.model<IPracticeAccount>(
    PRACTICE_ACCOUNT_MODEL_NAME,
    PracticeAccountSchema,
    PRACTICE_ACCOUNT_COLLECTION_NAME
  );


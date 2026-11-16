import mongoose from "mongoose";
import {
  IRefreshToken,
  RefreshTokenModelType,
} from "./refresh-token.types";
import { RefreshTokenSchema } from "./refresh-token.schema";

export const REFRESH_TOKEN_MODEL_NAME = "RefreshToken";
export const REFRESH_TOKEN_COLLECTION_NAME = "refresh_tokens";

export const RefreshTokenModel: RefreshTokenModelType =
  (mongoose.models[REFRESH_TOKEN_MODEL_NAME] as
    | RefreshTokenModelType
    | undefined) ??
  mongoose.model<IRefreshToken>(
    REFRESH_TOKEN_MODEL_NAME,
    RefreshTokenSchema,
    REFRESH_TOKEN_COLLECTION_NAME
  );

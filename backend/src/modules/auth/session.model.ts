import mongoose from "mongoose";
import { ISession, SessionModelType } from "./auth.types";
import { SessionSchema } from "./session.schema";

export const SESSION_MODEL_NAME = "Session";
export const SESSION_COLLECTION_NAME = "sessions";

export const SessionModel: SessionModelType =
  (mongoose.models[SESSION_MODEL_NAME] as SessionModelType | undefined) ??
  mongoose.model<ISession>(
    SESSION_MODEL_NAME,
    SessionSchema,
    SESSION_COLLECTION_NAME
  );


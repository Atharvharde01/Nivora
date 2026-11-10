import mongoose from "mongoose";
import { UserSchema } from "./user.schema";
import { IUser, UserModelType } from "./user.types";

export const USER_MODEL_NAME = "User";
export const USER_COLLECTION_NAME = "users";

export const UserModel: UserModelType =
  (mongoose.models[USER_MODEL_NAME] as UserModelType | undefined) ??
  mongoose.model<IUser>(USER_MODEL_NAME, UserSchema, USER_COLLECTION_NAME);


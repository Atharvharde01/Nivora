import { HydratedDocument, Model } from "mongoose";

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  email: string;
  displayName?: string;
  status: UserStatus;
  onboardingCompleted: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

export type UserModelType = Model<IUser>;


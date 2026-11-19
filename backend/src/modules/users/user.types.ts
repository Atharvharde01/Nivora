import { HydratedDocument, Model } from "mongoose";

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  email: string;
  emailVerifiedAt?: Date;
  displayName?: string;
  status: UserStatus;
  onboardingCompleted: boolean;
  termsAcceptedAt?: Date;
  termsVersion?: string;
  privacyAcceptedAt?: Date;
  privacyVersion?: string;
  simulationDisclosureAcceptedAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

export type UserModelType = Model<IUser>;


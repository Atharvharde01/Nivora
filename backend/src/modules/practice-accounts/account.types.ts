import { HydratedDocument, Model, Types } from "mongoose";

export const PRACTICE_ACCOUNT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

export type PracticeAccountStatus = (typeof PRACTICE_ACCOUNT_STATUSES)[number];

export interface IPracticeAccount {
  userId: Types.ObjectId;
  accountNumber: number;
  status: PracticeAccountStatus;
  initialBalancePaise: number;
  cashBalancePaise: number;
  version: number;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PracticeAccountDocument = HydratedDocument<IPracticeAccount>;

export type PracticeAccountModelType = Model<IPracticeAccount>;


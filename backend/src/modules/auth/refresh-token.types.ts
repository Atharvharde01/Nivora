import { HydratedDocument, Model, Types } from "mongoose";

export const REFRESH_TOKEN_STATUSES = [
  "ACTIVE",
  "ROTATED",
  "REVOKED",
] as const;

export type RefreshTokenStatus = (typeof REFRESH_TOKEN_STATUSES)[number];

export interface IRefreshToken {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  generation: number;
  status: RefreshTokenStatus;
  rotatedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;
export type RefreshTokenModelType = Model<IRefreshToken>;

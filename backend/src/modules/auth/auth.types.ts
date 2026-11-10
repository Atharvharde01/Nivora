import { HydratedDocument, Model, Types } from "mongoose";

export const OTP_CHALLENGE_STATUSES = [
  "PENDING",
  "CONSUMED",
  "EXHAUSTED",
  "SUPERSEDED",
] as const;

export type OtpChallengeStatus = (typeof OTP_CHALLENGE_STATUSES)[number];

export interface IOtpChallenge {
  email: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  status: OtpChallengeStatus;
  requestIp: string;
  resendAvailableAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type OtpChallengeDocument = HydratedDocument<IOtpChallenge>;

export type OtpChallengeModelType = Model<IOtpChallenge>;

export const SESSION_STATUSES = [
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
  "COMPROMISED",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_REVOCATION_REASONS = [
  "USER_LOGOUT",
  "LOGOUT_ALL",
  "TOKEN_REUSE_DETECTED",
  "IDLE_TIMEOUT",
  "ABSOLUTE_TIMEOUT",
] as const;

export type SessionRevocationReason =
  (typeof SESSION_REVOCATION_REASONS)[number];

export interface ISession {
  userId: Types.ObjectId;
  currentRefreshTokenHash: string;
  previousRefreshTokenHash?: string;
  status: SessionStatus;
  revokedReason?: SessionRevocationReason;
  revokedAt?: Date;
  ipAddress: string;
  userAgent: string;
  lastActiveAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<ISession>;

export type SessionModelType = Model<ISession>;



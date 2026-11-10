import { HydratedDocument, Model } from "mongoose";

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

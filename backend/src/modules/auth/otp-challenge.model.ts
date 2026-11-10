import mongoose from "mongoose";
import { IOtpChallenge, OtpChallengeModelType } from "./auth.types";
import { OtpChallengeSchema } from "./otp-challenge.schema";

export const OTP_CHALLENGE_MODEL_NAME = "OtpChallenge";
export const OTP_CHALLENGE_COLLECTION_NAME = "otp_challenges";

export const OtpChallengeModel: OtpChallengeModelType =
  (mongoose.models[OTP_CHALLENGE_MODEL_NAME] as
    | OtpChallengeModelType
    | undefined) ??
  mongoose.model<IOtpChallenge>(
    OTP_CHALLENGE_MODEL_NAME,
    OtpChallengeSchema,
    OTP_CHALLENGE_COLLECTION_NAME
  );


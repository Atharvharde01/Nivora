import { isIP } from "node:net";
import { Schema } from "mongoose";
import { IOtpChallenge, OTP_CHALLENGE_STATUSES } from "./auth.types";

export const OTP_EMAIL_MAX_LENGTH = 254;
export const OTP_HASH_HEX_LENGTH = 64;
export const OTP_DEFAULT_ATTEMPTS = 0;
export const OTP_MIN_ATTEMPTS = 0;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MIN_MAX_ATTEMPTS = 1;
export const REQUEST_IP_MAX_LENGTH = 45;
export const OTP_TTL_EXPIRE_AFTER_SECONDS = 3600;

export const OTP_PENDING_EMAIL_UNIQUE_INDEX_NAME =
  "otp_challenges_pending_email_unique_idx";
export const OTP_EMAIL_CREATED_AT_INDEX_NAME =
  "otp_challenges_email_created_at_idx";
export const OTP_REQUEST_IP_CREATED_AT_INDEX_NAME =
  "otp_challenges_request_ip_created_at_idx";
export const OTP_EXPIRES_AT_TTL_INDEX_NAME =
  "otp_challenges_expires_at_ttl_idx";

const LOCAL_PART_MAX_LENGTH = 64;
const DOMAIN_PART_MAX_LENGTH = 253;
const LOCAL_PART_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD_LABEL_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9]{2,59})$/i;
const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Validates an email address using the identical policy as the User module
 * without introducing cross-module runtime coupling.
 */
export function isValidChallengeEmail(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (
    value.length === 0 ||
    value.length > OTP_EMAIL_MAX_LENGTH ||
    /\s/.test(value)
  ) {
    return false;
  }

  const atIndex = value.indexOf("@");
  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) {
    return false;
  }

  const localPart = value.slice(0, atIndex);
  const domainPart = value.slice(atIndex + 1);

  if (
    localPart.length === 0 ||
    localPart.length > LOCAL_PART_MAX_LENGTH ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !LOCAL_PART_PATTERN.test(localPart)
  ) {
    return false;
  }

  if (
    domainPart.length === 0 ||
    domainPart.length > DOMAIN_PART_MAX_LENGTH ||
    domainPart.startsWith(".") ||
    domainPart.endsWith(".") ||
    domainPart.includes("..")
  ) {
    return false;
  }

  const domainLabels = domainPart.split(".");
  if (domainLabels.length < 2) {
    return false;
  }

  for (const label of domainLabels) {
    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      return false;
    }
  }

  const tldLabel = domainLabels[domainLabels.length - 1];
  if (!TLD_LABEL_PATTERN.test(tldLabel)) {
    return false;
  }

  return true;
}

/**
 * Validates that a value is a 64-character hexadecimal string (SHA-256 HMAC digest).
 */
export function isValidOtpHash(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length === OTP_HASH_HEX_LENGTH &&
    SHA256_HEX_PATTERN.test(value)
  );
}

/**
 * Validates IPv4 and IPv6 addresses using Node.js built-in `node:net` `isIP`.
 */
export function isValidIpAddress(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= REQUEST_IP_MAX_LENGTH &&
    isIP(value) !== 0
  );
}

/**
 * OTP Challenge Schema (`otp_challenges`).
 *
 * Security & Concurrency Notes:
 * 1. Atomic Attempt Enforcement: Mongoose document validation (`max: 5`) alone
 *    cannot prevent concurrent brute-force attempts when services use atomic `$inc`
 *    operations. The future OTP verification service MUST use a conditional
 *    database update filter requiring `attempts: { $lt: 5 }` (and `status: "PENDING"`).
 * 2. Explicit Expiry Check: MongoDB TTL deletion (`expireAfterSeconds: 3600`) is
 *    asynchronous and retains expired records for ~1 hour after `expiresAt`. Future
 *    authentication services MUST explicitly check `expiresAt > currentTime` and
 *    must never rely on TTL deletion to determine OTP validity or rate limiting.
 */
export const OtpChallengeSchema = new Schema<IOtpChallenge>(
  {
    email: {
      type: String,
      required: [true, "Email address is required."],
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: [
        OTP_EMAIL_MAX_LENGTH,
        `Email address must not exceed ${OTP_EMAIL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidChallengeEmail,
        message: "Email address format is invalid.",
      },
    },
    otpHash: {
      type: String,
      required: [true, "otpHash is required."],
      select: false,
      immutable: true,
      validate: {
        validator: isValidOtpHash,
        message:
          "otpHash must be an exact 64-character hexadecimal SHA-256 HMAC digest.",
      },
    },
    attempts: {
      type: Number,
      required: [true, "attempts is required."],
      default: OTP_DEFAULT_ATTEMPTS,
      min: [OTP_MIN_ATTEMPTS, `attempts must be at least ${OTP_MIN_ATTEMPTS}.`],
      max: [OTP_MAX_ATTEMPTS, `attempts must not exceed ${OTP_MAX_ATTEMPTS}.`],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "number" && Number.isInteger(value),
        message: "attempts must be an integer.",
      },
    },
    maxAttempts: {
      type: Number,
      required: [true, "maxAttempts is required."],
      default: OTP_MAX_ATTEMPTS,
      immutable: true,
      min: [
        OTP_MIN_MAX_ATTEMPTS,
        `maxAttempts must be at least ${OTP_MIN_MAX_ATTEMPTS}.`,
      ],
      max: [
        OTP_MAX_ATTEMPTS,
        `maxAttempts must not exceed ${OTP_MAX_ATTEMPTS}.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "number" && Number.isInteger(value),
        message: "maxAttempts must be an integer.",
      },
    },
    status: {
      type: String,
      required: [true, "OTP challenge status is required."],
      enum: {
        values: OTP_CHALLENGE_STATUSES,
        message: "Invalid OTP challenge status.",
      },
      default: "PENDING",
    },
    requestIp: {
      type: String,
      required: [true, "requestIp is required."],
      trim: true,
      select: false,
      immutable: true,
      maxlength: [
        REQUEST_IP_MAX_LENGTH,
        `requestIp must not exceed ${REQUEST_IP_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidIpAddress,
        message: "requestIp must be a valid IPv4 or IPv6 address.",
      },
    },
    resendAvailableAt: {
      type: Date,
      required: [true, "resendAvailableAt is required."],
      immutable: true,
    },
    expiresAt: {
      type: Date,
      required: [true, "expiresAt is required."],
      immutable: true,
    },
    consumedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "otp_challenges",
  }
);

// 1. Enforce at most one PENDING OTP challenge per normalized email at database level.
OtpChallengeSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "PENDING" },
    name: OTP_PENDING_EMAIL_UNIQUE_INDEX_NAME,
  }
);

// 2. Email rate-limiting lookup index.
OtpChallengeSchema.index(
  { email: 1, createdAt: -1 },
  {
    name: OTP_EMAIL_CREATED_AT_INDEX_NAME,
  }
);

// 3. IP rate-limiting lookup index.
OtpChallengeSchema.index(
  { requestIp: 1, createdAt: -1 },
  {
    name: OTP_REQUEST_IP_CREATED_AT_INDEX_NAME,
  }
);

// 4. TTL cleanup index retaining expired challenges for ~1 hour (3600s) after expiresAt.
OtpChallengeSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: OTP_TTL_EXPIRE_AFTER_SECONDS,
    name: OTP_EXPIRES_AT_TTL_INDEX_NAME,
  }
);


import crypto from "node:crypto";
import { Types } from "mongoose";
import {
  isValidChallengeEmail,
  isValidIpAddress,
} from "./otp-challenge.schema";
import { OtpChallengeModel } from "./otp-challenge.model";
import { IEmailDeliveryService } from "./email.service";
import { AuthError } from "./auth.errors";

export const OTP_DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_DEFAULT_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_DEFAULT_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_DEFAULT_EMAIL_RATE_LIMIT = 5;
export const OTP_DEFAULT_IP_RATE_LIMIT = 10;

/**
 * Generates a cryptographically secure 6-digit numeric OTP string (100000 - 999999).
 * Never uses Math.random().
 */
export function generateNumericOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes an HMAC-SHA256 digest of the OTP bound to the normalized email context.
 * Returns a 64-character lowercase hexadecimal string.
 */
export function computeOtpHmac(
  secret: string,
  email: string,
  otp: string
): string {
  if (!secret || secret.length < 16) {
    throw new Error(
      "OTP HMAC secret must be configured with a minimum length of 16 characters."
    );
  }
  const normalized = email.trim().toLowerCase();
  return crypto
    .createHmac("sha256", secret)
    .update(`${normalized}:${otp}`)
    .digest("hex");
}

/**
 * Verifies an OTP candidate against the stored HMAC hash using constant-time comparison.
 */
export function verifyOtpHmac(
  secret: string,
  email: string,
  candidateOtp: string,
  expectedHash: string
): boolean {
  if (!/^\d{6}$/.test(candidateOtp) || expectedHash.length !== 64) {
    return false;
  }
  const candidateHash = computeOtpHmac(secret, email, candidateOtp);
  const bufA = Buffer.from(candidateHash, "hex");
  const bufB = Buffer.from(expectedHash, "hex");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface OtpServiceOptions {
  hmacSecret: string;
  emailService: IEmailDeliveryService;
  expiryMs?: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
  emailRateLimit?: number;
  ipRateLimit?: number;
  rateLimitWindowMs?: number;
}

export interface OtpRequestResult {
  success: true;
  message: string;
  resendCooldownSeconds: number;
}

export interface OtpVerificationSuccess {
  email: string;
  challengeId: Types.ObjectId;
}

export class OtpService {
  private readonly hmacSecret: string;
  private readonly emailService: IEmailDeliveryService;
  private readonly expiryMs: number;
  private readonly resendCooldownMs: number;
  private readonly maxAttempts: number;
  private readonly emailRateLimit: number;
  private readonly ipRateLimit: number;
  private readonly rateLimitWindowMs: number;

  constructor(options: OtpServiceOptions) {
    if (!options.hmacSecret || options.hmacSecret.trim().length < 16) {
      throw new Error(
        "OtpService requires an HMAC secret of at least 16 characters."
      );
    }
    this.hmacSecret = options.hmacSecret;
    this.emailService = options.emailService;
    this.expiryMs = options.expiryMs ?? OTP_DEFAULT_EXPIRY_MS;
    this.resendCooldownMs =
      options.resendCooldownMs ?? OTP_DEFAULT_RESEND_COOLDOWN_MS;
    this.maxAttempts = options.maxAttempts ?? OTP_DEFAULT_MAX_ATTEMPTS;
    this.emailRateLimit =
      options.emailRateLimit ?? OTP_DEFAULT_EMAIL_RATE_LIMIT;
    this.ipRateLimit = options.ipRateLimit ?? OTP_DEFAULT_IP_RATE_LIMIT;
    this.rateLimitWindowMs =
      options.rateLimitWindowMs ?? OTP_RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Initiates an email OTP request:
   * - Validates email and IP format.
   * - Enforces resend cooldown on active challenges.
   * - Enforces rolling window rate limits by email and IP.
   * - Supersedes any prior pending challenge.
   * - Persists new challenge with HMAC-SHA256 digest.
   * - Sends transactional email via Brevo email adapter.
   * - Returns generic response preventing email enumeration.
   */
  public async requestOtp(
    email: string,
    requestIp: string,
    now = new Date()
  ): Promise<OtpRequestResult> {
    if (typeof email !== "string" || !isValidChallengeEmail(email)) {
      throw new AuthError("INVALID_EMAIL", "Invalid email address format.", 400);
    }
    if (typeof requestIp !== "string" || !isValidIpAddress(requestIp)) {
      throw new AuthError("INVALID_IP", "Invalid IP address.", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Resend cooldown check against active PENDING challenge
    const pendingChallenge = await OtpChallengeModel.findOne({
      email: normalizedEmail,
      status: "PENDING",
    });

    if (
      pendingChallenge &&
      pendingChallenge.resendAvailableAt.getTime() > now.getTime()
    ) {
      const waitSeconds = Math.max(
        1,
        Math.ceil(
          (pendingChallenge.resendAvailableAt.getTime() - now.getTime()) / 1000
        )
      );
      throw new AuthError(
        "RESEND_COOLDOWN_ACTIVE",
        `Please wait ${waitSeconds} seconds before requesting a new code.`,
        429,
        { retryAfterSeconds: waitSeconds }
      );
    }

    // 2. Rolling window rate limiting (by email and request IP)
    const windowStart = new Date(now.getTime() - this.rateLimitWindowMs);
    const [emailCount, ipCount] = await Promise.all([
      OtpChallengeModel.countDocuments({
        email: normalizedEmail,
        createdAt: { $gte: windowStart },
      }),
      OtpChallengeModel.countDocuments({
        requestIp,
        createdAt: { $gte: windowStart },
      }),
    ]);

    if (emailCount >= this.emailRateLimit) {
      throw new AuthError(
        "RATE_LIMIT_EXCEEDED",
        "Too many verification requests for this email address. Please try again later.",
        429
      );
    }

    if (ipCount >= this.ipRateLimit) {
      throw new AuthError(
        "RATE_LIMIT_EXCEEDED",
        "Too many verification requests from this network. Please try again later.",
        429
      );
    }

    // 3. Generate cryptographic 6-digit OTP and HMAC
    const rawOtp = generateNumericOtp();
    const otpHash = computeOtpHmac(this.hmacSecret, normalizedEmail, rawOtp);

    // 4. Atomically supersede any existing PENDING challenge so unique index allows new challenge
    await OtpChallengeModel.updateMany(
      { email: normalizedEmail, status: "PENDING" },
      { $set: { status: "SUPERSEDED" } }
    );

    // 5. Persist the new OTP challenge
    const newChallenge = new OtpChallengeModel({
      email: normalizedEmail,
      otpHash,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      status: "PENDING",
      requestIp,
      resendAvailableAt: new Date(now.getTime() + this.resendCooldownMs),
      expiresAt: new Date(now.getTime() + this.expiryMs),
    });

    await newChallenge.save();

    // 6. Deliver OTP via email
    try {
      await this.emailService.sendOtpEmail(normalizedEmail, rawOtp);
    } catch (deliveryErr: unknown) {
      // Invalidate the challenge immediately if delivery fails
      await OtpChallengeModel.updateOne(
        { _id: newChallenge._id },
        { $set: { status: "SUPERSEDED" } }
      );
      if (deliveryErr instanceof AuthError) {
        throw deliveryErr;
      }
      throw new AuthError(
        "EMAIL_DELIVERY_FAILED",
        "Failed to deliver verification code. Please try again.",
        502
      );
    }

    // Generic response preventing enumeration of registered vs unregistered accounts
    return {
      success: true,
      message:
        "If the email is valid, a verification code has been sent.",
      resendCooldownSeconds: Math.max(1, Math.ceil(this.resendCooldownMs / 1000)),
    };
  }

  /**
   * Validates and atomically consumes a PENDING OTP challenge:
   * - Validates numeric 6-digit format.
   * - Retrieves pending challenge.
   * - Checks application-level expiration.
   * - Verifies attempt counter.
   * - Performs constant-time HMAC comparison.
   * - On failure: safely increments attempts, transitions to EXHAUSTED on max attempts.
   * - On success: atomically transitions status to CONSUMED (single-use guarantee).
   */
  public async verifyOtp(
    email: string,
    rawOtp: string,
    now = new Date(),
    options?: {
      beforeConsume?: (normalizedEmail: string) => Promise<void>;
    }
  ): Promise<OtpVerificationSuccess> {
    if (typeof email !== "string" || !isValidChallengeEmail(email)) {
      throw new AuthError("INVALID_EMAIL", "Invalid email address format.", 400);
    }
    if (typeof rawOtp !== "string" || !/^\d{6}$/.test(rawOtp)) {
      throw new AuthError(
        "INVALID_OTP",
        "Verification code must be a 6-digit number.",
        400
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Find the active PENDING challenge (otpHash is select: false by default)
    const challenge = await OtpChallengeModel.findOne({
      email: normalizedEmail,
      status: "PENDING",
    }).select("+otpHash");

    if (!challenge) {
      throw new AuthError(
        "CHALLENGE_NOT_FOUND",
        "No active verification code found for this email. Please request a new code.",
        404
      );
    }

    // 2. Validate application-level expiration
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      await OtpChallengeModel.updateOne(
        { _id: challenge._id, status: "PENDING" },
        { $set: { status: "EXHAUSTED" } }
      );
      throw new AuthError(
        "OTP_EXPIRED",
        "Verification code has expired. Please request a new code.",
        400
      );
    }

    // 3. Validate attempt limit
    if (challenge.attempts >= challenge.maxAttempts) {
      await OtpChallengeModel.updateOne(
        { _id: challenge._id, status: "PENDING" },
        { $set: { status: "EXHAUSTED" } }
      );
      throw new AuthError(
        "OTP_EXHAUSTED",
        "Maximum verification attempts exceeded. Please request a new code.",
        400
      );
    }

    // 4. Constant-time HMAC comparison
    const isMatch = verifyOtpHmac(
      this.hmacSecret,
      normalizedEmail,
      rawOtp,
      challenge.otpHash
    );

    if (!isMatch) {
      // Atomically increment failed attempts
      const updated = await OtpChallengeModel.findOneAndUpdate(
        { _id: challenge._id, status: "PENDING" },
        { $inc: { attempts: 1 } },
        { new: true }
      );

      if (updated && updated.attempts >= updated.maxAttempts) {
        await OtpChallengeModel.updateOne(
          { _id: challenge._id },
          { $set: { status: "EXHAUSTED" } }
        );
        throw new AuthError(
          "OTP_EXHAUSTED",
          "Maximum verification attempts exceeded. Please request a new code.",
          400
        );
      }

      const remaining = updated ? updated.maxAttempts - updated.attempts : 0;
      throw new AuthError(
        "INVALID_OTP",
        `Invalid verification code. ${remaining} attempts remaining.`,
        400,
        { remainingAttempts: remaining }
      );
    }

    // 4.5. Optional pre-consumption guard (e.g., validating new-user name & consents
    // after OTP cryptographic verification so missing signup details never burn a valid OTP
    // and invalid OTPs never leak account existence)
    if (options?.beforeConsume) {
      await options.beforeConsume(normalizedEmail);
    }

    // 5. Atomically consume the challenge (guarantees single-use under concurrency)
    const consumed = await OtpChallengeModel.findOneAndUpdate(
      {
        _id: challenge._id,
        status: "PENDING",
        attempts: { $lt: challenge.maxAttempts },
      },
      {
        $set: {
          status: "CONSUMED",
          consumedAt: now,
        },
      },
      { new: true }
    );

    if (!consumed) {
      throw new AuthError(
        "CONCURRENCY_CONFLICT",
        "Verification code has already been consumed or exhausted.",
        409
      );
    }

    return {
      email: normalizedEmail,
      challengeId: consumed._id as Types.ObjectId,
    };
  }
}

import { isIP } from "node:net";
import { Schema } from "mongoose";
import {
  ISession,
  SESSION_REVOCATION_REASONS,
  SESSION_STATUSES,
} from "./auth.types";

export const REFRESH_TOKEN_HASH_HEX_LENGTH = 64;
export const SESSION_IP_MAX_LENGTH = 45;
export const SESSION_USER_AGENT_MAX_LENGTH = 512;
export const SESSION_ABSOLUTE_EXPIRY_TTL_SECONDS = 86400;

export const SESSION_CURRENT_REFRESH_HASH_UNIQUE_INDEX_NAME =
  "sessions_current_refresh_hash_unique_idx";
export const SESSION_PREVIOUS_REFRESH_HASH_UNIQUE_INDEX_NAME =
  "sessions_previous_refresh_hash_unique_idx";
export const SESSION_USER_STATUS_INDEX_NAME = "sessions_user_status_idx";
export const SESSION_ABSOLUTE_EXPIRY_TTL_INDEX_NAME =
  "sessions_absolute_expiry_ttl_idx";

const LOWERCASE_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Validates that a value is an exact 64-character lowercase hexadecimal SHA-256 digest.
 * Raw opaque refresh tokens must never be stored in the database.
 */
export function isValidRefreshTokenHash(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length === REFRESH_TOKEN_HASH_HEX_LENGTH &&
    LOWERCASE_SHA256_HEX_PATTERN.test(value)
  );
}

/**
 * Validates IPv4 and IPv6 addresses using Node.js built-in `node:net` `isIP`.
 */
export function isValidSessionIpAddress(value: string): boolean {
  return (
    typeof value !== "string"
      ? false
      : value.length > 0 &&
        value.length <= SESSION_IP_MAX_LENGTH &&
        isIP(value) !== 0
  );
}

/**
 * Session Schema (`sessions`).
 *
 * Security & Concurrency Notes:
 * 1. Atomic Refresh Rotation: Schema validation alone cannot enforce atomic
 *    refresh-token rotation under concurrent requests. The future refresh service
 *    MUST use conditional atomic database updates verifying:
 *    - `status === "ACTIVE"`
 *    - `idleExpiresAt > now`
 *    - `absoluteExpiresAt > now`
 *    - `currentRefreshTokenHash` matches the presented refresh-token hash.
 * 2. Single-Step Previous Token Tracking Limitation: This schema stores only
 *    `currentRefreshTokenHash` and `previousRefreshTokenHash` (the immediately
 *    preceding rotated token hash). This supports detecting reuse of the
 *    immediately preceding rotated refresh token, but does NOT retain a complete
 *    historical chain of every refresh token ever rotated across the session's
 *    lifetime.
 * 3. Asynchronous TTL Deletion: MongoDB TTL cleanup (`expireAfterSeconds: 86400`)
 *    runs asynchronously ~24 hours after `absoluteExpiresAt`. Authentication
 *    services MUST explicitly check both `absoluteExpiresAt > now` and
 *    `idleExpiresAt > now` on every session check.
 * 4. Untrusted Request Metadata: `userAgent` is stored as untrusted request
 *    metadata for diagnostics/audit only and must never be treated as an
 *    authenticated device identity.
 */
export const SessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required."],
      immutable: true,
    },
    currentRefreshTokenHash: {
      type: String,
      required: [true, "currentRefreshTokenHash is required."],
      select: false,
      validate: {
        validator: isValidRefreshTokenHash,
        message:
          "currentRefreshTokenHash must be an exact 64-character lowercase hexadecimal SHA-256 digest.",
      },
    },
    previousRefreshTokenHash: {
      type: String,
      required: false,
      select: false,
      validate: [
        {
          validator: (value: unknown): boolean =>
            typeof value === "string" && isValidRefreshTokenHash(value),
          message:
            "previousRefreshTokenHash must be an exact 64-character lowercase hexadecimal SHA-256 digest when provided.",
        },
        {
          validator: function (this: ISession, value: unknown): boolean {
            if (typeof value !== "string") {
              return false;
            }
            return value !== this.currentRefreshTokenHash;
          },
          message:
            "previousRefreshTokenHash must not equal currentRefreshTokenHash.",
        },
      ],
    },
    status: {
      type: String,
      required: [true, "Session status is required."],
      enum: {
        values: SESSION_STATUSES,
        message: "Invalid session status.",
      },
      default: "ACTIVE",
    },
    revokedReason: {
      type: String,
      required: [
        function (this: ISession): boolean {
          return this.status !== "ACTIVE";
        },
        "revokedReason is required when session status is not ACTIVE.",
      ],
      enum: {
        values: SESSION_REVOCATION_REASONS,
        message: "Invalid session revocation reason.",
      },
      validate: {
        validator: function (this: ISession, value: unknown): boolean {
          if (this.status === "ACTIVE") {
            return value === undefined || value === null;
          }
          return typeof value === "string";
        },
        message: "ACTIVE sessions must not contain revokedReason.",
      },
    },
    revokedAt: {
      type: Date,
      required: [
        function (this: ISession): boolean {
          return this.status !== "ACTIVE";
        },
        "revokedAt is required when session status is not ACTIVE.",
      ],
      validate: {
        validator: function (this: ISession, value: unknown): boolean {
          if (this.status === "ACTIVE") {
            return value === undefined || value === null;
          }
          return value instanceof Date && !Number.isNaN(value.getTime());
        },
        message: "ACTIVE sessions must not contain revokedAt.",
      },
    },
    ipAddress: {
      type: String,
      required: [true, "ipAddress is required."],
      trim: true,
      select: false,
      maxlength: [
        SESSION_IP_MAX_LENGTH,
        `ipAddress must not exceed ${SESSION_IP_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidSessionIpAddress,
        message: "ipAddress must be a valid IPv4 or IPv6 address.",
      },
    },
    userAgent: {
      type: String,
      required: [true, "userAgent is required."],
      trim: true,
      select: false,
      minlength: [1, "userAgent must not be empty."],
      maxlength: [
        SESSION_USER_AGENT_MAX_LENGTH,
        `userAgent must not exceed ${SESSION_USER_AGENT_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "string" && value.trim().length > 0,
        message: "userAgent must not be empty.",
      },
    },
    lastActiveAt: {
      type: Date,
      required: [true, "lastActiveAt is required."],
      validate: {
        validator: function (this: ISession, value: unknown): boolean {
          if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            return false;
          }
          if (
            this.idleExpiresAt instanceof Date &&
            !Number.isNaN(this.idleExpiresAt.getTime())
          ) {
            return value.getTime() <= this.idleExpiresAt.getTime();
          }
          return true;
        },
        message: "lastActiveAt must not exceed idleExpiresAt.",
      },
    },
    idleExpiresAt: {
      type: Date,
      required: [true, "idleExpiresAt is required."],
      validate: {
        validator: function (this: ISession, value: unknown): boolean {
          if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            return false;
          }
          if (
            this.absoluteExpiresAt instanceof Date &&
            !Number.isNaN(this.absoluteExpiresAt.getTime())
          ) {
            return value.getTime() <= this.absoluteExpiresAt.getTime();
          }
          return true;
        },
        message: "idleExpiresAt must not exceed absoluteExpiresAt.",
      },
    },
    absoluteExpiresAt: {
      type: Date,
      required: [true, "absoluteExpiresAt is required."],
      immutable: true,
    },
    rotatedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "sessions",
  }
);

// 1. Unique index on current refresh token hash.
SessionSchema.index(
  { currentRefreshTokenHash: 1 },
  {
    unique: true,
    name: SESSION_CURRENT_REFRESH_HASH_UNIQUE_INDEX_NAME,
  }
);

// 2. Sparse unique index on immediately preceding rotated refresh token hash.
SessionSchema.index(
  { previousRefreshTokenHash: 1 },
  {
    unique: true,
    sparse: true,
    name: SESSION_PREVIOUS_REFRESH_HASH_UNIQUE_INDEX_NAME,
  }
);

// 3. User session lookup index.
SessionSchema.index(
  { userId: 1, status: 1 },
  {
    name: SESSION_USER_STATUS_INDEX_NAME,
  }
);

// 4. Absolute session expiry TTL index (~24 hours after absoluteExpiresAt).
SessionSchema.index(
  { absoluteExpiresAt: 1 },
  {
    expireAfterSeconds: SESSION_ABSOLUTE_EXPIRY_TTL_SECONDS,
    name: SESSION_ABSOLUTE_EXPIRY_TTL_INDEX_NAME,
  }
);


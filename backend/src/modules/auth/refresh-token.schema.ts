import { Schema } from "mongoose";
import {
  IRefreshToken,
  REFRESH_TOKEN_STATUSES,
} from "./refresh-token.types";
import { isValidRefreshTokenHash } from "./session.schema";

export const REFRESH_TOKEN_HASH_UNIQUE_INDEX_NAME =
  "refresh_tokens_hash_unique_idx";
export const REFRESH_TOKEN_SESSION_STATUS_INDEX_NAME =
  "refresh_tokens_session_status_idx";
export const REFRESH_TOKEN_EXPIRES_AT_TTL_INDEX_NAME =
  "refresh_tokens_expires_at_ttl_idx";

export const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "Session",
      required: [true, "sessionId is required."],
      immutable: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required."],
      immutable: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: [true, "tokenHash is required."],
      select: false,
      immutable: true,
      validate: {
        validator: isValidRefreshTokenHash,
        message:
          "tokenHash must be an exact 64-character lowercase hexadecimal SHA-256 digest.",
      },
    },
    generation: {
      type: Number,
      required: [true, "generation is required."],
      min: [1, "generation must be at least 1."],
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === "number" && Number.isInteger(value),
        message: "generation must be an integer.",
      },
    },
    status: {
      type: String,
      required: [true, "status is required."],
      enum: {
        values: REFRESH_TOKEN_STATUSES,
        message: "Invalid refresh token status.",
      },
      default: "ACTIVE",
    },
    rotatedAt: {
      type: Date,
      required: false,
    },
    expiresAt: {
      type: Date,
      required: [true, "expiresAt is required."],
      immutable: true,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "refresh_tokens",
  }
);

// 1. Unique index on token hash (guarantees a hash can never exist twice)
RefreshTokenSchema.index(
  { tokenHash: 1 },
  {
    unique: true,
    name: REFRESH_TOKEN_HASH_UNIQUE_INDEX_NAME,
  }
);

// 2. Query index for active/rotated tokens by session
RefreshTokenSchema.index(
  { sessionId: 1, status: 1 },
  {
    name: REFRESH_TOKEN_SESSION_STATUS_INDEX_NAME,
  }
);

// 3. TTL index aligned with session absolute expiry
RefreshTokenSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    name: REFRESH_TOKEN_EXPIRES_AT_TTL_INDEX_NAME,
  }
);

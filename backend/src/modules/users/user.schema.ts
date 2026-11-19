import { Schema } from "mongoose";
import { IUser, USER_STATUSES } from "./user.types";

export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const USER_EMAIL_UNIQUE_INDEX_NAME = "users_email_unique_idx";

// Rejects C0/C1 control characters, line separators, and BiDi override characters
const CONTROL_OR_BIDI_CHAR_PATTERN =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
// Rejects HTML/script/NoSQL/email-like characters so emails or markup are not stored as display names
const DISALLOWED_DISPLAY_NAME_SYMBOL_PATTERN = /[<>{}[\]\\|`~^$@;]/;
// Requires at least one Unicode letter (supports Latin, Devanagari, CJK, Arabic, accented names, etc.)
const CONTAINS_UNICODE_LETTER_PATTERN = /\p{L}/u;

/**
 * Trims leading/trailing regular spaces and collapses consecutive spaces inside a display name.
 * Preserves control characters so validation explicitly rejects them instead of silently stripping them.
 */
export function sanitizeDisplayName(value: string): string {
  return value.replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

/**
 * Validates a user display name according to NIVORA's profile policy:
 * - String of 2..50 characters after trimming regular spaces.
 * - Supports normal Unicode names.
 * - Rejects empty/whitespace-only strings, control characters, BiDi overrides,
 *   HTML/injection characters, and email addresses.
 * - Requires at least one Unicode letter.
 */
export function isValidDisplayName(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (CONTROL_OR_BIDI_CHAR_PATTERN.test(value)) {
    return false;
  }
  if (DISALLOWED_DISPLAY_NAME_SYMBOL_PATTERN.test(value)) {
    return false;
  }

  const sanitized = sanitizeDisplayName(value);
  if (
    sanitized.length < DISPLAY_NAME_MIN_LENGTH ||
    sanitized.length > DISPLAY_NAME_MAX_LENGTH
  ) {
    return false;
  }

  return CONTAINS_UNICODE_LETTER_PATTERN.test(sanitized);
}

const LOCAL_PART_MAX_LENGTH = 64;
const DOMAIN_PART_MAX_LENGTH = 253;
const LOCAL_PART_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD_LABEL_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9]{2,59})$/i;

/**
 * Validates an email address according to NIVORA's email validation policy:
 * - Non-empty string, maximum 254 characters, no whitespace.
 * - Single '@' separating local-part (1..64 chars) and domain-part (1..253 chars).
 * - Local-part cannot start/end with '.' or contain consecutive '..'.
 * - Domain-part must have at least two labels separated by '.', each 1..63 chars,
 *   starting/ending with alphanumeric characters, with a valid TLD.
 */
export function isValidEmailAddress(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (
    value.length === 0 ||
    value.length > EMAIL_MAX_LENGTH ||
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

export const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, "Email address is required."],
      trim: true,
      lowercase: true,
      maxlength: [
        EMAIL_MAX_LENGTH,
        `Email address must not exceed ${EMAIL_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidEmailAddress,
        message: "Email address format is invalid.",
      },
    },
    emailVerifiedAt: {
      type: Date,
      required: false,
    },
    displayName: {
      type: String,
      required: false,
      set: (value: unknown): unknown =>
        typeof value === "string" ? sanitizeDisplayName(value) : value,
      minlength: [
        DISPLAY_NAME_MIN_LENGTH,
        `Display name must be at least ${DISPLAY_NAME_MIN_LENGTH} characters.`,
      ],
      maxlength: [
        DISPLAY_NAME_MAX_LENGTH,
        `Display name must not exceed ${DISPLAY_NAME_MAX_LENGTH} characters.`,
      ],
      validate: {
        validator: isValidDisplayName,
        message:
          "Display name must be 2 to 50 characters, contain letters, and not include control characters or email addresses.",
      },
    },
    status: {
      type: String,
      required: [true, "User status is required."],
      enum: {
        values: USER_STATUSES,
        message: "Invalid user status.",
      },
      default: "ACTIVE",
    },
    onboardingCompleted: {
      type: Boolean,
      required: [true, "onboardingCompleted is required."],
      default: false,
    },
    termsAcceptedAt: {
      type: Date,
      required: false,
    },
    termsVersion: {
      type: String,
      required: false,
      trim: true,
      maxlength: [32, "termsVersion must not exceed 32 characters."],
    },
    privacyAcceptedAt: {
      type: Date,
      required: false,
    },
    privacyVersion: {
      type: String,
      required: false,
      trim: true,
      maxlength: [32, "privacyVersion must not exceed 32 characters."],
    },
    simulationDisclosureAcceptedAt: {
      type: Date,
      required: false,
    },
    lastLoginAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    collection: "users",
  }
);

// Explicit named unique index on normalized email.
// Defined solely at schema level to avoid duplicate field+schema index declarations.
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    name: USER_EMAIL_UNIQUE_INDEX_NAME,
  }
);


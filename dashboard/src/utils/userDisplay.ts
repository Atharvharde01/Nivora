/**
 * NIVORA Trading Platform — User Display Name, Avatar Initials & Greeting Helpers
 * Always prioritizes persisted `displayName` over email address.
 * Falls back to email ONLY for legacy users who genuinely have no displayName.
 */

import { AuthUserDto } from "../api/types";

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

const DISALLOWED_DISPLAY_NAME_SYMBOL_PATTERN = /[<>{}[\]\\|`~^$@;]/;
const CONTAINS_UNICODE_LETTER_PATTERN = /\p{L}/u;

function hasControlOrBidiChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

export function sanitizeDisplayNameInput(raw: string): string {
  return raw.replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

export function validateDisplayNameInput(raw: string): {
  valid: boolean;
  sanitized: string;
  error: string | null;
} {
  if (hasControlOrBidiChar(raw)) {
    return {
      valid: false,
      sanitized: "",
      error: "Full name cannot contain control or hidden formatting characters.",
    };
  }

  const sanitized = sanitizeDisplayNameInput(raw);
  if (!sanitized) {
    return {
      valid: false,
      sanitized: "",
      error: "Full name cannot be empty.",
    };
  }

  if (
    sanitized.length < DISPLAY_NAME_MIN_LENGTH ||
    sanitized.length > DISPLAY_NAME_MAX_LENGTH
  ) {
    return {
      valid: false,
      sanitized,
      error: `Full name must be between ${DISPLAY_NAME_MIN_LENGTH} and ${DISPLAY_NAME_MAX_LENGTH} characters.`,
    };
  }

  if (
    DISALLOWED_DISPLAY_NAME_SYMBOL_PATTERN.test(sanitized) ||
    !CONTAINS_UNICODE_LETTER_PATTERN.test(sanitized)
  ) {
    return {
      valid: false,
      sanitized,
      error: "Please enter a valid full name without email addresses or special symbols.",
    };
  }

  return {
    valid: true,
    sanitized,
    error: null,
  };
}

export function getUserDisplayName(user: AuthUserDto | null | undefined): string {
  if (user?.displayName && user.displayName.trim().length > 0) {
    return user.displayName.trim();
  }
  if (user?.email && user.email.trim().length > 0) {
    return user.email.trim();
  }
  return "Account";
}

export function getUserFirstName(user: AuthUserDto | null | undefined): string {
  if (user?.displayName && user.displayName.trim().length > 0) {
    const tokens = user.displayName.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      return tokens[0];
    }
  }
  if (user?.email && user.email.trim().length > 0) {
    return user.email.trim();
  }
  return "Trader";
}

export function getUserAvatarInitials(
  user: AuthUserDto | null | undefined
): string {
  const displayName = user?.displayName?.trim();
  if (displayName && displayName.length > 0) {
    const parts = displayName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstChar = Array.from(parts[0])[0] ?? "";
      const lastChar = Array.from(parts[parts.length - 1])[0] ?? "";
      return `${firstChar}${lastChar}`.toUpperCase();
    }
    const chars = Array.from(parts[0]);
    return chars.slice(0, 2).join("").toUpperCase();
  }

  const email = user?.email?.trim();
  if (email && email.length > 0) {
    const localPart = email.includes("@") ? email.split("@")[0] : email;
    const parts = localPart.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstChar = Array.from(parts[0])[0] ?? "";
      const secondChar = Array.from(parts[1])[0] ?? "";
      return `${firstChar}${secondChar}`.toUpperCase();
    }
    return Array.from(localPart).slice(0, 2).join("").toUpperCase();
  }

  return "NV";
}

export function getTimeBasedGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

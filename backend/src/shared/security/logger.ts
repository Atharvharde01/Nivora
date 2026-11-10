import { Request } from "express";

const REDACTED_KEYS = new Set([
  "otp",
  "code",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "jwtaccesssecret",
  "otphmacsecret",
  "brevoapikey",
  "apikey",
  "creditcard",
  "xsrf-token",
  "x-csrf-token",
]);

/**
 * Recursively redacts sensitive keys from objects before logging.
 */
export function sanitizeForLogging(data: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH_REACHED]";
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForLogging(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeForLogging(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function logError(
  message: string,
  err?: unknown,
  req?: Request
): void {
  const reqId = req?.id ? `[req:${req.id}] ` : "";
  const errorMessage = err instanceof Error ? err.message : String(err || "Unknown error");
  console.error(`[ERROR] ${reqId}${message}:`, errorMessage);
}

export function logInfo(
  message: string,
  meta?: unknown,
  req?: Request
): void {
  const reqId = req?.id ? `[req:${req.id}] ` : "";
  if (meta !== undefined) {
    console.log(`[INFO] ${reqId}${message}`, sanitizeForLogging(meta));
  } else {
    console.log(`[INFO] ${reqId}${message}`);
  }
}

import crypto from "node:crypto";
import { Request } from "express";
import { AuthError } from "./auth.errors";

export const CSRF_COOKIE_NAME = "XSRF-TOKEN";
export const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * Generates a cryptographically random 64-character hexadecimal CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validates request Origin / Referer against allowed origins.
 */
export function validateRequestOrigin(
  req: Request,
  allowedOrigins: readonly string[]
): void {
  const origin = req.headers.origin;
  if (origin && typeof origin === "string") {
    if (!allowedOrigins.includes(origin)) {
      throw new AuthError(
        "FORBIDDEN",
        `Origin '${origin}' is not permitted.`,
        403
      );
    }
    return;
  }

  const referer = req.headers.referer;
  if (referer && typeof referer === "string") {
    try {
      const parsedReferer = new URL(referer);
      if (!allowedOrigins.includes(parsedReferer.origin)) {
        throw new AuthError(
          "FORBIDDEN",
          `Referer origin '${parsedReferer.origin}' is not permitted.`,
          403
        );
      }
    } catch {
      throw new AuthError("FORBIDDEN", "Malformed Referer header.", 403);
    }
  }
}

/**
 * Validates double-submit cookie CSRF protection.
 * Requires matching XSRF-TOKEN cookie and X-CSRF-Token request header using constant-time comparison.
 */
export function validateCsrfProtection(req: Request): void {
  const cookieToken =
    req.cookies?.[CSRF_COOKIE_NAME] ||
    req.headers["cookie"]
      ?.split(";")
      ?.map((c) => c.trim())
      ?.find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
      ?.slice(CSRF_COOKIE_NAME.length + 1);

  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || typeof cookieToken !== "string" || !cookieToken.trim()) {
    throw new AuthError(
      "CSRF_TOKEN_MISMATCH",
      "Missing required CSRF cookie.",
      403
    );
  }

  if (!headerToken || typeof headerToken !== "string" || !headerToken.trim()) {
    throw new AuthError(
      "CSRF_TOKEN_MISMATCH",
      "Missing required X-CSRF-Token header.",
      403
    );
  }

  const bufCookie = Buffer.from(cookieToken.trim());
  const bufHeader = Buffer.from(headerToken.trim());

  if (
    bufCookie.length !== bufHeader.length ||
    !crypto.timingSafeEqual(bufCookie, bufHeader)
  ) {
    throw new AuthError(
      "CSRF_TOKEN_MISMATCH",
      "CSRF token mismatch. Verification failed.",
      403
    );
  }
}

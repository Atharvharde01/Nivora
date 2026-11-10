import crypto from "node:crypto";
import { Request } from "express";
import { AuthError } from "./auth.errors";

export const CSRF_COOKIE_NAME = "XSRF-TOKEN";
export const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * Generates a cryptographically random 64-character hexadecimal CSRF token,
 * or a session-bound HMAC signed token if sessionId and secret are provided.
 */
export function generateCsrfToken(sessionId?: string, secret?: string): string {
  if (sessionId && secret) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hmac = crypto
      .createHmac("sha256", secret)
      .update(`${sessionId}:${salt}`)
      .digest("hex");
    return `${salt}.${hmac}`;
  }
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
 * If expectedSessionId and secret are provided, also cryptographically validates session binding.
 */
export function validateCsrfProtection(
  req: Request,
  expectedSessionId?: string,
  secret?: string
): void {
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

  const cleanCookie = cookieToken.trim();
  const cleanHeader = headerToken.trim();

  const bufCookie = Buffer.from(cleanCookie);
  const bufHeader = Buffer.from(cleanHeader);

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

  // Cryptographic session-binding check (if token is HMAC signed)
  if (expectedSessionId && secret && cleanCookie.includes(".")) {
    const [salt, hmac] = cleanCookie.split(".");
    if (!salt || !hmac) {
      throw new AuthError(
        "CSRF_TOKEN_MISMATCH",
        "Malformed session-bound CSRF token.",
        403
      );
    }
    const expectedHmac = crypto
      .createHmac("sha256", secret)
      .update(`${expectedSessionId}:${salt}`)
      .digest("hex");

    const bufHmac = Buffer.from(hmac);
    const bufExpected = Buffer.from(expectedHmac);

    if (
      bufHmac.length !== bufExpected.length ||
      !crypto.timingSafeEqual(bufHmac, bufExpected)
    ) {
      throw new AuthError(
        "CSRF_TOKEN_MISMATCH",
        "CSRF token is not bound to the authenticated session.",
        403
      );
    }
  }
}

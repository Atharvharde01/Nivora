export type AuthErrorCode =
  | "INVALID_EMAIL"
  | "INVALID_IP"
  | "INVALID_OTP"
  | "OTP_EXPIRED"
  | "OTP_EXHAUSTED"
  | "CHALLENGE_NOT_FOUND"
  | "RESEND_COOLDOWN_ACTIVE"
  | "RATE_LIMIT_EXCEEDED"
  | "EMAIL_DELIVERY_FAILED"
  | "CONCURRENCY_CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "TOKEN_EXPIRED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "USER_SUSPENDED"
  | "USER_NOT_FOUND"
  | "CSRF_TOKEN_MISMATCH"
  | "INVALID_REFRESH_TOKEN"
  | "REFRESH_TOKEN_REUSE_DETECTED"
  | "ACCOUNT_PROVISIONING_FAILED"
  | "CONSENT_REQUIRED"
  | "DISPLAY_NAME_REQUIRED"
  | "INVALID_DISPLAY_NAME";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: AuthErrorCode,
    message: string,
    statusCode = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

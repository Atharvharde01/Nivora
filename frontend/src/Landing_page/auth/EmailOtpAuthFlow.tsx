/**
 * NIVORA Public Website — Unified Passwordless Email OTP Authentication Flow
 * Serves `/signup` as the single authentication entry point for both new and returning users.
 *
 * Security & product invariants:
 * - Full Name is compulsory before requesting an OTP; trimmed and validated client-side & server-side.
 * - Backend authoritatively decides whether the verified email belongs to a new or existing account.
 * - For new users, backend saves the submitted displayName and creates one default PracticeAccount.
 * - For existing users with a registered name, backend ignores the submitted name and preserves it.
 * - Frontend NEVER sends `flow: "signup"` or `flow: "login"`.
 * - Relies on backend HttpOnly refresh_token cookie + XSRF-TOKEN cookie.
 * - Never passes JWT access/refresh tokens in URL query parameters or browser storage.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  AuthClientError,
  dashboardURL,
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  FrontendAuthApi,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "../../api/authClient";

export type AuthStep = "email" | "otp";

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

const EMAIL_VALIDATION_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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

export function sanitizeDisplayNameInput(rawName: string): string {
  return rawName.replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

export function validateDisplayName(
  rawName: string,
  options: { required?: boolean } = {}
): {
  valid: boolean;
  sanitized: string;
  error: string | null;
} {
  const { required = true } = options;

  if (hasControlOrBidiChar(rawName)) {
    return {
      valid: false,
      sanitized: "",
      error: "Full name cannot contain control or hidden formatting characters.",
    };
  }

  const sanitized = sanitizeDisplayNameInput(rawName);
  if (!sanitized) {
    if (required) {
      return {
        valid: false,
        sanitized: "",
        error: "Please enter your full name.",
      };
    }
    return {
      valid: true,
      sanitized: "",
      error: null,
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
      error:
        "Please enter a valid full name without email addresses or special symbols.",
    };
  }

  return {
    valid: true,
    sanitized,
    error: null,
  };
}

export function validateEmailAddress(rawEmail: string): {
  valid: boolean;
  normalized: string;
  error: string | null;
} {
  const trimmed = rawEmail.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalized: "",
      error: "Please enter your email address.",
    };
  }
  if (
    trimmed.length > 254 ||
    trimmed.includes("..") ||
    !EMAIL_VALIDATION_REGEX.test(trimmed)
  ) {
    return {
      valid: false,
      normalized: trimmed.toLowerCase(),
      error: "Please enter a valid email address.",
    };
  }
  return {
    valid: true,
    normalized: trimmed.toLowerCase(),
    error: null,
  };
}

export function maskEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) {
    return normalized;
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  if (local.length <= 4) {
    return `${local.slice(0, 1)}***${local.slice(-1)}@${domain}`;
  }
  return `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 3))}${local.slice(-1)}@${domain}`;
}

export interface EmailOtpAuthFlowProps {
  onStepChange?: (step: AuthStep) => void;
  onRedirect?: (url: string) => void;
  fullNameInputRef?: React.RefObject<HTMLInputElement | null>;
  emailInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const EmailOtpAuthFlow: React.FC<EmailOtpAuthFlowProps> = ({
  onStepChange,
  onRedirect,
  fullNameInputRef,
  emailInputRef,
}) => {
  const [step, setStep] = useState<AuthStep>("email");
  const [fullNameInput, setFullNameInput] = useState<string>("");
  const [submittedDisplayName, setSubmittedDisplayName] = useState<string>("");
  const [emailInput, setEmailInput] = useState<string>("");
  const [submittedEmail, setSubmittedEmail] = useState<string>("");
  const [otpInput, setOtpInput] = useState<string>("");
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [policyCooldownSeconds, setPolicyCooldownSeconds] = useState<number>(
    DEFAULT_RESEND_COOLDOWN_SECONDS
  );

  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Synchronous submission locks prevent accidental duplicate requests
  const isRequestingRef = useRef<boolean>(false);
  const isVerifyingRef = useRef<boolean>(false);

  const updateStep = useCallback(
    (nextStep: AuthStep) => {
      setStep(nextStep);
      if (onStepChange) {
        onStepChange(nextStep);
      }
    },
    [onStepChange]
  );

  // Countdown ticker for Resend OTP cooldown
  useEffect(() => {
    if (step !== "otp" || cooldownSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [step, cooldownSeconds]);

  const handleRequestOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isRequestingRef.current) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);

    // Full Name is compulsory before requesting an OTP
    const nameValidation = validateDisplayName(fullNameInput, { required: true });
    if (!nameValidation.valid) {
      setErrorMessage(nameValidation.error);
      return;
    }

    const emailValidation = validateEmailAddress(emailInput);
    if (!emailValidation.valid) {
      setErrorMessage(emailValidation.error);
      return;
    }

    isRequestingRef.current = true;
    setIsRequestingOtp(true);

    try {
      // Never send displayName during OTP request; backend returns a generic response
      const result = await FrontendAuthApi.requestOtp(emailValidation.normalized);
      const serverCooldown =
        typeof result.resendCooldownSeconds === "number" &&
        result.resendCooldownSeconds > 0
          ? result.resendCooldownSeconds
          : DEFAULT_RESEND_COOLDOWN_SECONDS;

      setSubmittedDisplayName(nameValidation.sanitized);
      setSubmittedEmail(emailValidation.normalized);
      setOtpInput("");
      setPolicyCooldownSeconds(serverCooldown);
      setCooldownSeconds(serverCooldown);
      setStatusMessage(
        result.message || "A 6-digit verification code has been sent to your email."
      );
      updateStep("otp");
    } catch (err: unknown) {
      if (err instanceof AuthClientError && err.code === "RESEND_COOLDOWN_ACTIVE") {
        const waitSec = err.retryAfterSeconds ?? DEFAULT_RESEND_COOLDOWN_SECONDS;
        setSubmittedDisplayName(nameValidation.sanitized);
        setSubmittedEmail(emailValidation.normalized);
        setOtpInput("");
        setCooldownSeconds(waitSec);
        setErrorMessage(err.message);
        updateStep("otp");
      } else {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to send verification code. Please try again."
        );
      }
    } finally {
      isRequestingRef.current = false;
      setIsRequestingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (isRequestingRef.current || cooldownSeconds > 0 || !submittedEmail) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    isRequestingRef.current = true;
    setIsRequestingOtp(true);

    try {
      const result = await FrontendAuthApi.requestOtp(submittedEmail);
      const serverCooldown =
        typeof result.resendCooldownSeconds === "number" &&
        result.resendCooldownSeconds > 0
          ? result.resendCooldownSeconds
          : DEFAULT_RESEND_COOLDOWN_SECONDS;
      setPolicyCooldownSeconds(serverCooldown);
      setCooldownSeconds(serverCooldown);
      setOtpInput("");
      setStatusMessage("A new verification code has been sent to your email.");
    } catch (err: unknown) {
      if (err instanceof AuthClientError && err.retryAfterSeconds) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Unable to resend verification code. Please try again."
      );
    } finally {
      isRequestingRef.current = false;
      setIsRequestingOtp(false);
    }
  };

  const handleChangeEmail = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setOtpInput("");
    setCooldownSeconds(0);
    updateStep("email");
  };

  const handleOtpInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 6);
    setOtpInput(digitsOnly);
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVerifyingRef.current) {
      return;
    }

    setErrorMessage(null);

    if (!/^\d{6}$/.test(otpInput)) {
      setErrorMessage("Please enter a valid 6-digit numeric OTP.");
      return;
    }

    const activeDisplayName =
      submittedDisplayName || sanitizeDisplayNameInput(fullNameInput);
    const nameValidation = validateDisplayName(activeDisplayName, {
      required: true,
    });
    if (!nameValidation.valid) {
      setErrorMessage(nameValidation.error);
      return;
    }

    isVerifyingRef.current = true;
    setIsVerifyingOtp(true);

    try {
      const res = await FrontendAuthApi.verifyOtp({
        email: submittedEmail,
        otp: otpInput,
        displayName: nameValidation.sanitized,
        consents: {
          acceptTerms: true,
          acceptPrivacy: true,
          acceptSimulationDisclosure: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        },
      });

      if (!res.success) {
        setErrorMessage("Verification could not be completed. Please try again.");
        return;
      }

      const resolvedName = res.user?.displayName?.trim();
      if (res.isNewUser) {
        setStatusMessage(
          resolvedName
            ? `Welcome to NIVORA, ${resolvedName}! Your account has been created and your virtual trading account is ready. Redirecting to your dashboard...`
            : "Welcome to NIVORA! Your account has been created and your virtual trading account is ready. Redirecting to your dashboard..."
        );
      } else {
        setStatusMessage(
          resolvedName
            ? `Welcome back, ${resolvedName}! Redirecting to your NIVORA dashboard...`
            : "Verification successful! Redirecting to your NIVORA dashboard..."
        );
      }

      // Redirect to the dashboard origin without passing tokens in URL query parameters.
      // Dashboard will bootstrap its in-memory access token via the HttpOnly refresh cookie.
      const redirectFn =
        onRedirect ?? ((url: string) => window.location.assign(url));
      redirectFn(dashboardURL);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Invalid or expired verification code. Please try again."
      );
    } finally {
      isVerifyingRef.current = false;
      setIsVerifyingOtp(false);
    }
  };

  // ==================== STEP 2: OTP VERIFICATION ====================
  if (step === "otp") {
    return (
      <div className="nivora-auth-form-panel" data-testid="otp-verification-step">
        <h2 className="nivora-auth-heading">Email OTP</h2>
        <p className="nivora-otp-sent-line">
          Sent to{" "}
          <strong data-testid="masked-email">
            {maskEmailAddress(submittedEmail)}
          </strong>{" "}
          <button
            type="button"
            className="nivora-auth-btn-link"
            onClick={handleChangeEmail}
            disabled={isVerifyingOtp || isRequestingOtp}
          >
            (change)
          </button>
        </p>

        {statusMessage && !errorMessage && (
          <div className="nivora-auth-alert nivora-auth-alert-success" role="status">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="nivora-auth-alert nivora-auth-alert-error" role="alert">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleVerifyOtp} noValidate>
          <div className="nivora-auth-field-group">
            <div
              className={`nivora-auth-input-wrapper ${
                errorMessage ? "has-error" : ""
              }`}
            >
              <span className="nivora-auth-input-addon" aria-hidden="true">
                <i className="bi bi-envelope" />
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-label="Enter 6-digit OTP"
                placeholder="• • • • • •"
                className="nivora-auth-input nivora-otp-input"
                value={otpInput}
                onChange={handleOtpInputChange}
                disabled={isVerifyingOtp}
                autoFocus
              />
            </div>

            <p className="nivora-otp-helper">
              Enter the 6-digit OTP. You can request a new OTP after{" "}
              {policyCooldownSeconds} seconds.
            </p>
          </div>

          <div className="nivora-otp-resend-row">
            {cooldownSeconds > 0 ? (
              <span data-testid="resend-countdown">
                Resend OTP in{" "}
                <span className="nivora-otp-countdown">{cooldownSeconds}</span>{" "}
                seconds
              </span>
            ) : (
              <button
                type="button"
                className="nivora-auth-btn-link"
                onClick={handleResendOtp}
                disabled={isRequestingOtp || isVerifyingOtp}
              >
                {isRequestingOtp ? "Resending OTP..." : "Resend OTP"}
              </button>
            )}
          </div>

          <div className="nivora-otp-footer-bar">
            <button
              type="submit"
              className="nivora-auth-btn-primary"
              disabled={otpInput.length !== 6 || isVerifyingOtp}
            >
              {isVerifyingOtp ? "Verifying..." : "Continue"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ==================== STEP 1: UNIFIED FULL NAME + EMAIL ENTRY ====================
  const isNameEmpty = fullNameInput.trim().length === 0;
  const isWhitespaceOnlyName = fullNameInput.length > 0 && isNameEmpty;

  return (
    <div className="nivora-auth-form-panel" data-testid="email-entry-step">
      <h2 className="nivora-auth-heading">Signup now</h2>
      <p className="nivora-auth-subtext">
        Create a new NIVORA account or sign in with your email OTP.
      </p>

      {errorMessage && (
        <div className="nivora-auth-alert nivora-auth-alert-error" role="alert">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleRequestOtp} noValidate>
        {/* First field: Full Name (compulsory) */}
        <div className="nivora-auth-field-group">
          <label htmlFor="nivora-full-name" className="nivora-auth-label">
            Full Name <span className="nivora-required-star" aria-hidden="true">*</span>
          </label>
          <div
            className={`nivora-auth-input-wrapper ${
              isWhitespaceOnlyName ? "has-error" : ""
            }`}
          >
            <span className="nivora-auth-input-addon" aria-hidden="true">
              <i className="bi bi-person" />
            </span>
            <input
              ref={fullNameInputRef as React.RefObject<HTMLInputElement>}
              id="nivora-full-name"
              type="text"
              name="displayName"
              autoComplete="name"
              required
              aria-required="true"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Enter your full name"
              className="nivora-auth-input"
              value={fullNameInput}
              onChange={(e) => {
                setFullNameInput(e.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              disabled={isRequestingOtp}
            />
          </div>
          {isWhitespaceOnlyName ? (
            <p className="nivora-field-error-inline" role="alert">
              Please enter your full name (cannot be whitespace only).
            </p>
          ) : (
            <p className="nivora-field-helper">
              Required for new accounts. Existing users will continue with their
              registered name.
            </p>
          )}
        </div>

        {/* Second field: Email Address */}
        <div className="nivora-auth-field-group">
          <label htmlFor="nivora-email-address" className="nivora-auth-label">
            Email Address <span className="nivora-required-star" aria-hidden="true">*</span>
          </label>
          <div
            className={`nivora-auth-input-wrapper ${
              errorMessage ? "has-error" : ""
            }`}
          >
            <span className="nivora-auth-input-addon" aria-hidden="true">
              <i className="bi bi-envelope" />
            </span>
            <input
              ref={emailInputRef as React.RefObject<HTMLInputElement>}
              id="nivora-email-address"
              type="email"
              name="email"
              autoComplete="email"
              required
              aria-required="true"
              placeholder="Enter your email address"
              className="nivora-auth-input"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              disabled={isRequestingOtp}
            />
          </div>
        </div>

        <button
          type="submit"
          className="nivora-auth-btn-primary"
          disabled={isRequestingOtp || isNameEmpty}
        >
          {isRequestingOtp ? "Sending OTP..." : "Get OTP"}
        </button>
      </form>

      <p className="nivora-auth-consent">
        By proceeding, you agree to the NIVORA Terms of Service and Privacy
        Policy.
      </p>

      <div className="nivora-auth-sim-notice">
        NIVORA is a simulated trading platform. All trades use virtual funds. No
        real money or securities are involved.
      </div>

      <div className="nivora-auth-switch">
        Already registered? Enter your email to receive an OTP and sign in.
      </div>
    </div>
  );
};

export default EmailOtpAuthFlow;

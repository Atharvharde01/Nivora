/**
 * NIVORA Public Website — Typed Authentication API Client
 * Communicates with the backend on port 5000 using credentialed requests so
 * the browser receives and stores the HttpOnly refresh token cookie and XSRF-TOKEN cookie.
 * NEVER stores tokens in localStorage or sessionStorage.
 */

import axios, { AxiosError, AxiosInstance } from "axios";

export const DEFAULT_API_URL = "http://localhost:5000";
export const DEFAULT_DASHBOARD_URL = "http://localhost:3001";
export const AUTH_API_TIMEOUT_MS = 12000;
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "1.0";

export const apiBaseURL =
  process.env.REACT_APP_API_URL && process.env.REACT_APP_API_URL.trim().length > 0
    ? process.env.REACT_APP_API_URL.trim().replace(/\/+$/, "")
    : DEFAULT_API_URL;

export const dashboardURL =
  process.env.REACT_APP_DASHBOARD_URL &&
  process.env.REACT_APP_DASHBOARD_URL.trim().length > 0
    ? process.env.REACT_APP_DASHBOARD_URL.trim().replace(/\/+$/, "")
    : DEFAULT_DASHBOARD_URL;

export const authHttpClient: AxiosInstance = axios.create({
  baseURL: apiBaseURL,
  timeout: AUTH_API_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export interface SignupConsentsPayload {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptSimulationDisclosure: boolean;
  termsVersion: string;
  privacyVersion: string;
}

export interface OtpRequestResponse {
  success: boolean;
  message: string;
  resendCooldownSeconds?: number;
}

export interface OtpVerifyPayload {
  email: string;
  otp: string;
  displayName?: string;
  consents?: SignupConsentsPayload;
}

export interface AuthenticatedUserSummary {
  id: string;
  userId?: string;
  email: string;
  emailVerifiedAt?: string;
  displayName?: string;
  status: string;
  onboardingCompleted: boolean;
}

export interface OtpVerifyResponse {
  success: boolean;
  isNewUser?: boolean;
  user: AuthenticatedUserSummary;
  session: {
    id: string;
    status: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
  accessToken: string;
}

interface BackendErrorEnvelope {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    details?: {
      retryAfterSeconds?: number;
      [key: string]: unknown;
    };
  };
}

export class AuthClientError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code = "AUTH_REQUEST_FAILED",
    status?: number,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AuthClientError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function extractAuthClientError(err: unknown, fallbackMessage: string): AuthClientError {
  if (err instanceof AuthClientError) {
    return err;
  }

  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<BackendErrorEnvelope>;
    const status = axiosErr.response?.status;
    const envelope = axiosErr.response?.data?.error;

    if (envelope?.message) {
      const retryVal = envelope.details?.retryAfterSeconds;
      return new AuthClientError(
        envelope.message,
        envelope.code || "AUTH_REQUEST_FAILED",
        status,
        typeof retryVal === "number" && retryVal > 0 ? retryVal : undefined
      );
    }

    if (axiosErr.code === "ECONNABORTED") {
      return new AuthClientError(
        "The request timed out. Please check your connection and try again.",
        "REQUEST_TIMEOUT",
        status
      );
    }

    if (!axiosErr.response) {
      return new AuthClientError(
        "Unable to reach the NIVORA server. Please ensure the backend service is running and try again.",
        "NETWORK_ERROR"
      );
    }
  }

  if (err instanceof Error && err.message) {
    return new AuthClientError(err.message, "AUTH_REQUEST_FAILED");
  }

  return new AuthClientError(fallbackMessage, "AUTH_REQUEST_FAILED");
}

export const FrontendAuthApi = {
  /**
   * POST /auth/otp/request
   * Requests a 6-digit single-use verification code sent via Brevo email.
   */
  async requestOtp(email: string): Promise<OtpRequestResponse> {
    try {
      const response = await authHttpClient.post<OtpRequestResponse>(
        "/auth/otp/request",
        { email: email.trim().toLowerCase() }
      );
      return response.data;
    } catch (err: unknown) {
      throw extractAuthClientError(
        err,
        "Unable to send verification code. Please try again."
      );
    }
  },

  /**
   * POST /auth/otp/verify
   * Verifies the 6-digit email OTP, provisions/resolves the user and practice account,
   * and sets the HttpOnly refresh_token + XSRF-TOKEN cookies on the browser.
   */
  async verifyOtp(payload: OtpVerifyPayload): Promise<OtpVerifyResponse> {
    try {
      const trimmedDisplayName =
        typeof payload.displayName === "string"
          ? payload.displayName.trim()
          : "";
      const response = await authHttpClient.post<OtpVerifyResponse>(
        "/auth/otp/verify",
        {
          email: payload.email.trim().toLowerCase(),
          otp: payload.otp.trim(),
          ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
          ...(payload.consents ? { consents: payload.consents } : {}),
        }
      );
      return response.data;
    } catch (err: unknown) {
      throw extractAuthClientError(
        err,
        "Verification failed. Please check your code and try again."
      );
    }
  },
};

import { Request, Response, NextFunction } from "express";
import { OtpService } from "./otp.service";
import { AuthService } from "./auth.service";
import { AuthError } from "./auth.errors";
import { generateCsrfToken, validateCsrfProtection, validateRequestOrigin } from "./csrf.utils";
import {
  clearAuthCookies,
  CookieConfig,
  extractRefreshTokenFromRequest,
  setAuthCookies,
} from "./cookie.utils";

export interface AuthControllerDependencies {
  otpService: OtpService;
  authService?: AuthService;
  cookieConfig?: CookieConfig;
  allowedOrigins?: readonly string[];
}

export class AuthController {
  private readonly otpService: OtpService;
  private readonly authService?: AuthService;
  private readonly cookieConfig: CookieConfig;
  private readonly allowedOrigins: readonly string[];

  constructor(dependencies: AuthControllerDependencies) {
    this.otpService = dependencies.otpService;
    this.authService = dependencies.authService;
    this.cookieConfig = dependencies.cookieConfig ?? { isProduction: false };
    this.allowedOrigins = dependencies.allowedOrigins ?? [];
  }

  /**
   * Helper to safely extract client IP
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }
    return req.ip || "127.0.0.1";
  }

  /**
   * POST /auth/otp/request
   */
  public requestOtp = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const email = req.body?.email;
      if (!email || typeof email !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_EMAIL",
            message: "Email address is required in request body.",
          },
        });
        return;
      }

      const clientIp = this.getClientIp(req);
      const result = await this.otpService.requestOtp(email, clientIp);
      res.status(200).json(result);
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  /**
   * POST /auth/otp/verify
   */
  public verifyOtp = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }

      const { email, otp, displayName, consents } = req.body ?? {};
      if (!email || typeof email !== "string") {
        throw new AuthError("INVALID_EMAIL", "Email address is required.", 400);
      }
      if (!otp || typeof otp !== "string") {
        throw new AuthError("INVALID_OTP", "Verification code is required.", 400);
      }

      const clientIp = this.getClientIp(req);
      const userAgent = (req.headers["user-agent"] || "unknown").slice(0, 512);

      const loginResult = await this.authService.verifyOtpAndLogin({
        email,
        otp,
        ipAddress: clientIp,
        userAgent,
        displayName: typeof displayName === "string" ? displayName : undefined,
        consents,
      });

      // Issue CSRF token and set HttpOnly refresh token cookie + readable CSRF cookie
      const csrfToken = generateCsrfToken();
      setAuthCookies(
        res,
        loginResult.refreshToken,
        csrfToken,
        this.cookieConfig
      );

      // Return user, session, and 15m access token in JSON (raw refresh token is in cookie)
      res.status(200).json({
        success: true,
        isNewUser: loginResult.isNewUser,
        user: loginResult.user,
        session: loginResult.session,
        accessToken: loginResult.accessToken,
      });
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  /**
   * POST /auth/refresh
   * Rotates refresh token, sets replacement cookie, issues new access token.
   */
  public refresh = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }

      // 1. Origin and CSRF validation
      if (this.allowedOrigins.length > 0) {
        validateRequestOrigin(req, this.allowedOrigins);
      }
      validateCsrfProtection(req);

      // 2. Extract refresh token from cookie
      const rawRefreshToken = extractRefreshTokenFromRequest(
        req,
        this.cookieConfig.isProduction
      );
      if (!rawRefreshToken) {
        throw new AuthError(
          "INVALID_REFRESH_TOKEN",
          "Refresh token cookie is missing.",
          401
        );
      }

      const clientIp = this.getClientIp(req);
      const userAgent = (req.headers["user-agent"] || "unknown").slice(0, 512);

      // 3. Rotate refresh token (with multi-generation reuse detection)
      const rotationResult = await this.authService.rotateRefreshToken({
        rawRefreshToken,
        ipAddress: clientIp,
        userAgent,
      });

      // 4. Set replacement cookies
      const newCsrfToken = generateCsrfToken();
      setAuthCookies(
        res,
        rotationResult.newRefreshToken,
        newCsrfToken,
        this.cookieConfig
      );

      res.status(200).json({
        success: true,
        accessToken: rotationResult.accessToken,
        session: rotationResult.session,
        user: rotationResult.user,
      });
    } catch (err: unknown) {
      if (
        err instanceof AuthError &&
        (err.code === "REFRESH_TOKEN_REUSE_DETECTED" ||
          err.code === "SESSION_REVOKED" ||
          err.code === "SESSION_EXPIRED")
      ) {
        clearAuthCookies(res, this.cookieConfig);
      }
      this.handleError(err, res);
    }
  };

  /**
   * POST /auth/logout
   * Logs out current session, revokes refresh token family, clears cookies.
   */
  public logout = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }

      // Origin and CSRF validation for cookie-authenticated state-changing operation
      if (this.allowedOrigins.length > 0) {
        validateRequestOrigin(req, this.allowedOrigins);
      }
      validateCsrfProtection(req);

      const rawRefreshToken = extractRefreshTokenFromRequest(
        req,
        this.cookieConfig.isProduction
      );
      const sessionId = req.session?._id?.toString();

      await this.authService.logoutCurrentSession({
        rawRefreshToken,
        sessionId,
      });

      clearAuthCookies(res, this.cookieConfig);

      res.status(200).json({
        success: true,
        message: "Logged out successfully.",
      });
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  /**
   * POST /auth/logout-all
   * Logs out all active sessions belonging to the user.
   */
  public logoutAll = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }

      if (!req.user) {
        throw new AuthError("UNAUTHORIZED", "Authentication required.", 401);
      }

      validateCsrfProtection(req);

      await this.authService.logoutAllSessions(req.user._id);

      clearAuthCookies(res, this.cookieConfig);

      res.status(200).json({
        success: true,
        message: "All sessions logged out successfully.",
      });
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  /**
   * GET /auth/me
   */
  public getMe = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    if (!req.user || !req.session) {
      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      user: {
        id: req.user._id.toString(),
        userId: req.user._id.toString(),
        email: req.user.email,
        emailVerifiedAt: req.user.emailVerifiedAt,
        displayName: req.user.displayName,
        status: req.user.status,
        onboardingCompleted: req.user.onboardingCompleted,
        termsAcceptedAt: req.user.termsAcceptedAt,
        termsVersion: req.user.termsVersion,
        privacyAcceptedAt: req.user.privacyAcceptedAt,
        privacyVersion: req.user.privacyVersion,
        simulationDisclosureAcceptedAt: req.user.simulationDisclosureAcceptedAt,
        createdAt: req.user.createdAt,
      },
      session: {
        id: req.session._id.toString(),
        status: req.session.status,
        lastActiveAt: req.session.lastActiveAt,
        idleExpiresAt: req.session.idleExpiresAt,
        absoluteExpiresAt: req.session.absoluteExpiresAt,
      },
    });
  };

  /**
   * GET /auth/sessions
   * Lists all sessions belonging to the current user.
   */
  public getSessions = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }
      if (!req.user) {
        throw new AuthError("UNAUTHORIZED", "Authentication required.", 401);
      }

      const sessions = await this.authService.getUserSessions(req.user._id);

      const mapped = sessions.map((s) => ({
        ...s,
        isCurrent: req.session ? s.id === req.session._id.toString() : false,
      }));

      res.status(200).json({
        success: true,
        sessions: mapped,
      });
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  /**
   * DELETE /auth/sessions/:sessionId
   * Revokes a specific session belonging to the user.
   */
  public revokeSession = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        throw new AuthError("ACCOUNT_PROVISIONING_FAILED", "AuthService is not configured.", 500);
      }
      if (!req.user) {
        throw new AuthError("UNAUTHORIZED", "Authentication required.", 401);
      }

      const { sessionId } = req.params;
      if (!sessionId) {
        throw new AuthError("INVALID_EMAIL", "sessionId parameter is required.", 400);
      }

      await this.authService.revokeUserSession({
        userId: req.user._id,
        sessionId,
      });

      if (req.session && req.session._id.toString() === sessionId) {
        clearAuthCookies(res, this.cookieConfig);
      }

      res.status(200).json({
        success: true,
        message: "Session revoked successfully.",
      });
    } catch (err: unknown) {
      this.handleError(err, res);
    }
  };

  private handleError(err: unknown, res: Response): void {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }

    console.error("[AUTH] Unexpected error:", err);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  }
}

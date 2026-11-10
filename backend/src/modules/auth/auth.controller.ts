import { Request, Response, NextFunction } from "express";
import { OtpService } from "./otp.service";
import { AuthService } from "./auth.service";
import { AuthError } from "./auth.errors";

export interface AuthControllerDependencies {
  otpService: OtpService;
  authService?: AuthService;
}

export class AuthController {
  private readonly otpService: OtpService;
  private readonly authService?: AuthService;

  constructor(dependencies: AuthControllerDependencies) {
    this.otpService = dependencies.otpService;
    this.authService = dependencies.authService;
  }

  /**
   * POST /auth/otp/request
   * Initiates passwordless email OTP generation and delivery.
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

      // Extract client IP address safely
      const forwarded = req.headers["x-forwarded-for"];
      let clientIp = req.ip || "127.0.0.1";
      if (typeof forwarded === "string" && forwarded.trim()) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) {
          clientIp = first;
        }
      }

      const result = await this.otpService.requestOtp(email, clientIp);
      res.status(200).json(result);
    } catch (err: unknown) {
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

      console.error("[AUTH] Unexpected error during OTP request:", err);
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred. Please try again later.",
        },
      });
    }
  };

  /**
   * POST /auth/otp/verify
   * Verifies OTP, provisions or loads user, provisions practice account, creates session, and issues access token.
   */
  public verifyOtp = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.authService) {
        res.status(500).json({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "AuthService is not configured.",
          },
        });
        return;
      }

      const { email, otp } = req.body ?? {};
      if (!email || typeof email !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_EMAIL",
            message: "Email address is required.",
          },
        });
        return;
      }

      if (!otp || typeof otp !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_OTP",
            message: "Verification code is required.",
          },
        });
        return;
      }

      const forwarded = req.headers["x-forwarded-for"];
      let clientIp = req.ip || "127.0.0.1";
      if (typeof forwarded === "string" && forwarded.trim()) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) {
          clientIp = first;
        }
      }

      const userAgent = (req.headers["user-agent"] || "unknown").slice(0, 512);

      const loginResult = await this.authService.verifyOtpAndLogin({
        email,
        otp,
        ipAddress: clientIp,
        userAgent,
      });

      res.status(200).json({
        success: true,
        ...loginResult,
      });
    } catch (err: unknown) {
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

      console.error("[AUTH] Unexpected error during OTP verification:", err);
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred during verification.",
        },
      });
    }
  };

  /**
   * GET /auth/me
   * Returns authenticated user profile and session identity without sensitive secrets or hashes.
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
        email: req.user.email,
        displayName: req.user.displayName,
        status: req.user.status,
        onboardingCompleted: req.user.onboardingCompleted,
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
}

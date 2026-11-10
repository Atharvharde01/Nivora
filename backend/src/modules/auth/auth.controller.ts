import { Request, Response, NextFunction } from "express";
import { OtpService } from "./otp.service";
import { AuthError } from "./auth.errors";

export interface AuthControllerDependencies {
  otpService: OtpService;
}

export class AuthController {
  private readonly otpService: OtpService;

  constructor(dependencies: AuthControllerDependencies) {
    this.otpService = dependencies.otpService;
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
}

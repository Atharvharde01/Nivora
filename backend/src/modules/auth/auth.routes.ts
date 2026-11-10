import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "./auth.controller";
import { JwtService } from "./jwt.service";
import { createAuthMiddleware } from "./auth.middleware";

export interface AuthRouterDependencies {
  authController: AuthController;
  jwtService?: JwtService;
}

export function createAuthRouter(
  dependencies: AuthRouterDependencies
): Router {
  const router = Router();
  const { authController, jwtService } = dependencies;

  // Rate limiter specifically for OTP request endpoint: 10 requests per 15 minutes per IP
  const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests from this IP address. Please try again later.",
      },
    },
  });

  // Rate limiter specifically for OTP verify endpoint: 15 attempts per 15 minutes per IP
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many verification attempts from this IP address. Please try again later.",
      },
    },
  });

  router.post("/otp/request", otpRequestLimiter, authController.requestOtp);
  router.post("/otp/verify", otpVerifyLimiter, authController.verifyOtp);

  if (jwtService) {
    const authMiddleware = createAuthMiddleware(jwtService);
    router.get("/me", authMiddleware, authController.getMe);
  }

  return router;
}

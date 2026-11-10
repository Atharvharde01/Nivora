import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "./auth.controller";

export interface AuthRouterDependencies {
  authController: AuthController;
}

export function createAuthRouter(
  dependencies: AuthRouterDependencies
): Router {
  const router = Router();
  const { authController } = dependencies;

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

  router.post("/otp/request", otpRequestLimiter, authController.requestOtp);

  return router;
}

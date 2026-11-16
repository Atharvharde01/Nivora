import { Router } from "express";
import { AuthController } from "./auth.controller";
import { JwtService } from "./jwt.service";
import { createAuthMiddleware } from "./auth.middleware";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  requestOtpBodySchema,
  sessionIdParamsSchema,
  verifyOtpBodySchema,
} from "../../shared/validation/schemas";
import {
  otpRequestRateLimiter,
  otpVerifyRateLimiter,
  tokenRefreshRateLimiter,
} from "../../shared/security";

export interface AuthRouterDependencies {
  authController: AuthController;
  jwtService?: JwtService;
}

export function createAuthRouter(
  dependencies: AuthRouterDependencies
): Router {
  const router = Router();
  const { authController, jwtService } = dependencies;

  router.post(
    "/otp/request",
    otpRequestRateLimiter,
    validateRequest({ body: requestOtpBodySchema }),
    authController.requestOtp
  );
  router.post(
    "/otp/verify",
    otpVerifyRateLimiter,
    validateRequest({ body: verifyOtpBodySchema }),
    authController.verifyOtp
  );
  router.post("/refresh", tokenRefreshRateLimiter, authController.refresh);
  router.post("/logout", authController.logout);

  if (jwtService) {
    const authMiddleware = createAuthMiddleware(jwtService);
    router.get("/me", authMiddleware, authController.getMe);
    router.post("/logout-all", authMiddleware, authController.logoutAll);
    router.get("/sessions", authMiddleware, authController.getSessions);
    router.delete(
      "/sessions/:sessionId",
      authMiddleware,
      validateRequest({ params: sessionIdParamsSchema }),
      authController.revokeSession
    );
  }

  return router;
}

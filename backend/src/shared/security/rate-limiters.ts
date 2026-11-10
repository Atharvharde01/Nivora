import { Request, Response } from "express";
import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";

/**
 * ARCHITECTURAL NOTE: In-Memory Rate Limiting vs Distributed Cache
 * ================================================================
 * All rate limiters below use Express-Rate-Limit's built-in in-memory store.
 * - Suitable for single-process deployments (e.g., standard Render web services).
 * - Imposes zero latency penalty and requires no external infrastructure.
 * - State resets cleanly on application restart.
 *
 * For horizontal multi-instance scaling in future production tiers:
 * The store option in `createStandardRateLimiter` can be swapped to `rate-limit-redis`
 * without altering any route handlers, controller logic, or API response contracts.
 */

export interface CreateRateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
  skip?: (req: Request) => boolean;
  keyGenerator?: (req: Request) => string;
}

export function userOrIpKeyGenerator(req: Request): string {
  const customUser = (req as Request & { user?: { _id?: { toString(): string } } }).user;
  if (customUser?._id) {
    return `usr_${customUser._id.toString()}`;
  }
  return req.ip || req.socket.remoteAddress || "unknown_ip";
}

export function createStandardRateLimiter(
  options: CreateRateLimiterOptions
): RateLimitRequestHandler {
  const messageText = options.message || "Too many requests. Please try again later.";

  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip,
    keyGenerator: options.keyGenerator,
    validate: { keyGeneratorIpFallback: false },
    handler: (req: Request, res: Response, _next, limiterOptions) => {
      const retryAfter = Math.ceil(limiterOptions.windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      if (req.id) {
        res.setHeader("X-Request-Id", req.id);
      }
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: messageText,
          retryAfterSeconds: retryAfter,
        },
      });
    },
  });
}

// 1. Trading order placement rate limiter: 30 requests / 1 minute
export const tradingRateLimiter = createStandardRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 orders per minute
  message: "Trading rate limit exceeded. You can place at most 30 orders per minute.",
  keyGenerator: userOrIpKeyGenerator,
});

// 2. Account reset rate limiter: 5 requests / 15 minutes
export const accountResetRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 resets per 15 minutes
  message: "Account reset limit exceeded. You can reset your practice account at most 5 times per 15 minutes.",
  keyGenerator: userOrIpKeyGenerator,
});

// 3. Global API rate limiter: 200 requests / 15 minutes (exempts health checks)
export const globalApiRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: "Too many requests. Please try again later.",
  skip: (req: Request) => req.path.startsWith("/health"),
});

// 4. OTP Request limiter: 10 requests / 15 minutes
export const otpRequestRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many requests from this IP address. Please try again later.",
});

// 5. OTP Verify limiter: 15 attempts / 15 minutes
export const otpVerifyRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many verification attempts from this IP address. Please try again later.",
});

// 6. Token Refresh limiter: 60 refreshes / 15 minutes
export const tokenRefreshRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many token refresh requests. Please try again later.",
});

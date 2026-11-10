import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import express, { Request, Response } from "express";
import { createApp } from "../../app";
import { createAppRouter } from "../../routes";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthController } from "../../modules/auth/auth.controller";
import { OtpService } from "../../modules/auth/otp.service";
import { AuthService } from "../../modules/auth/auth.service";
import { MockEmailService } from "../../modules/auth/email.service";
import {
  createStandardRateLimiter,
  sanitizeForLogging,
} from "../../shared/security";
import {
  validateCsrfProtection,
  generateCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../modules/auth/csrf.utils";

describe("Task 30 — API Security, Rate Limiting & Correlation (Integration)", () => {
  const TEST_JWT_SECRET =
    "test_security_ratelimit_jwt_secret_min_32_chars_ok";
  const ALLOWED_ORIGIN = "http://localhost:3000";
  const DISALLOWED_ORIGIN = "http://malicious-site.com";

  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const jwtService = new JwtService({ accessSecret: TEST_JWT_SECRET });
    const otpService = new OtpService({
      hmacSecret: "test_hmac_secret_key_minimum_32_characters",
      emailService: new MockEmailService(),
    });
    const authService = new AuthService({ otpService, jwtService });
    const authController = new AuthController({
      otpService,
      authService,
      cookieConfig: { isProduction: false },
      allowedOrigins: [ALLOWED_ORIGIN],
    });

    const router = createAppRouter({
      authDependencies: { authController, jwtService },
    });

    const app = createApp({
      isProduction: false,
      allowedOrigins: [ALLOWED_ORIGIN],
      router,
    });

    server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to obtain server address");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server?.close();
  });

  describe("1. Helmet Security Headers", () => {
    it("sets X-Content-Type-Options: nosniff and X-Frame-Options: DENY", async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.equal(
        res.headers.get("referrer-policy"),
        "strict-origin-when-cross-origin"
      );
    });

    it("omits HSTS header in non-production environments", async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      assert.equal(res.headers.get("strict-transport-security"), null);
    });

    it("enables HSTS with max-age and preload when isProduction is true", async () => {
      const prodApp = createApp({
        isProduction: true,
        allowedOrigins: [ALLOWED_ORIGIN],
      });
      const prodServer = prodApp.listen(0);
      const addr = prodServer.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Failed to obtain prod server address");
      }
      const prodUrl = `http://127.0.0.1:${addr.port}`;

      try {
        const res = await fetch(`${prodUrl}/health/live`);
        assert.equal(
          res.headers.get("strict-transport-security"),
          "max-age=31536000; includeSubDomains; preload"
        );
      } finally {
        prodServer.close();
      }
    });
  });

  describe("2. CORS Hardening & Trust Proxy", () => {
    it("allows request from permitted origin and returns CORS credentials and expose headers", async () => {
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { Origin: ALLOWED_ORIGIN },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.equal(res.headers.get("access-control-allow-credentials"), "true");
      const exposed = res.headers.get("access-control-expose-headers");
      assert.ok(exposed?.includes("X-Request-Id"));
    });

    it("rejects request from unapproved origin with 403 Forbidden", async () => {
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { Origin: DISALLOWED_ORIGIN },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.status, 403);
      assert.ok(data.error.includes("CORS blocked"));
    });

    it("allows requests with no origin (direct server/CLI/curl requests)", async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    });

    it("handles CORS preflight OPTIONS request with permitted methods and headers", async () => {
      const res = await fetch(`${baseUrl}/auth/otp/request`, {
        method: "OPTIONS",
        headers: {
          Origin: ALLOWED_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type,Idempotency-Key,X-CSRF-Token,X-Request-Id",
        },
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      const allowMethods = res.headers.get("access-control-allow-methods");
      assert.ok(allowMethods?.includes("POST"));
      assert.ok(allowMethods?.includes("PATCH"));
    });
  });

  describe("3. Request Correlation (X-Request-Id)", () => {
    it("generates a new UUID v4 request ID when client does not supply one", async () => {
      const res = await fetch(`${baseUrl}/health/live`);
      const reqId = res.headers.get("x-request-id");
      assert.ok(reqId);
      // Verify valid UUID v4 format
      assert.match(
        reqId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("preserves a valid upstream request ID provided by client or reverse proxy", async () => {
      const customId = "trace-req-client-987654";
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { "X-Request-Id": customId },
      });
      assert.equal(res.headers.get("x-request-id"), customId);
    });

    it("replaces an invalid or malformed upstream request ID with a new safe UUID", async () => {
      const malformedId = "bad id with spaces and <script>";
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { "X-Request-Id": malformedId },
      });
      const reqId = res.headers.get("x-request-id");
      assert.ok(reqId);
      assert.notEqual(reqId, malformedId);
      assert.match(
        reqId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("4. Rate Limiting Strategy & 429 Status", () => {
    it("exempts health endpoints from rate limiting", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/health/live`);
        assert.equal(res.status, 200);
      }
    });

    it("triggers 429 and sets Retry-After header when rate limit is exceeded on a standard limiter", async () => {
      const testApp = express();
      const testLimiter = createStandardRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        message: "Test limit exceeded.",
      });

      testApp.get("/test-limited", testLimiter, (_req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const testServer = testApp.listen(0);
      const addr = testServer.address();
      if (!addr || typeof addr === "string") throw new Error("Addr failed");
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        // First 3 requests succeed
        for (let i = 0; i < 3; i++) {
          const res = await fetch(`${url}/test-limited`);
          assert.equal(res.status, 200);
        }

        // 4th request must be rate limited with 429
        const blockedRes = await fetch(`${url}/test-limited`);
        assert.equal(blockedRes.status, 429);
        assert.ok(blockedRes.headers.get("retry-after"));
        const body = await blockedRes.json();
        assert.equal(body.success, false);
        assert.equal(body.error.code, "RATE_LIMIT_EXCEEDED");
        assert.equal(body.error.message, "Test limit exceeded.");
        assert.ok(body.error.retryAfterSeconds > 0);
      } finally {
        testServer.close();
      }
    });
  });

  describe("5. CSRF Protection Double-Submit Token & Constant-Time Verification", () => {
    it("accepts request when XSRF-TOKEN cookie and X-CSRF-Token header match", () => {
      const token = generateCsrfToken();
      const mockReq = {
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: token },
      } as unknown as Request;

      assert.doesNotThrow(() => validateCsrfProtection(mockReq));
    });

    it("rejects request when CSRF cookie is missing with 403 CSRF_TOKEN_MISMATCH", () => {
      const token = generateCsrfToken();
      const mockReq = {
        cookies: {},
        headers: { [CSRF_HEADER_NAME]: token },
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(mockReq),
        (err: any) => err.code === "CSRF_TOKEN_MISMATCH" && err.statusCode === 403
      );
    });

    it("rejects request when X-CSRF-Token header is missing with 403 CSRF_TOKEN_MISMATCH", () => {
      const token = generateCsrfToken();
      const mockReq = {
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: {},
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(mockReq),
        (err: any) => err.code === "CSRF_TOKEN_MISMATCH" && err.statusCode === 403
      );
    });

    it("rejects request when tokens do not match with 403 CSRF_TOKEN_MISMATCH", () => {
      const tokenA = generateCsrfToken();
      const tokenB = generateCsrfToken();
      const mockReq = {
        cookies: { [CSRF_COOKIE_NAME]: tokenA },
        headers: { [CSRF_HEADER_NAME]: tokenB },
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(mockReq),
        (err: any) => err.code === "CSRF_TOKEN_MISMATCH" && err.statusCode === 403
      );
    });
  });

  describe("6. Sanitized Logging Redaction", () => {
    it("redacts sensitive authentication keys from logged data", () => {
      const sensitiveData = {
        userId: "12345",
        email: "trader@nivora.in",
        otp: "839201",
        password: "secret_password",
        token: "jwt.access.token",
        jwtAccessSecret: "super_secret_jwt",
        brevoApiKey: "xkeysib-abc123",
        nested: {
          refreshToken: "refresh_token_xyz",
          authorization: "Bearer sensitive",
          safeField: "safe_value",
        },
      };

      const sanitized: any = sanitizeForLogging(sensitiveData);
      assert.equal(sanitized.userId, "12345");
      assert.equal(sanitized.email, "trader@nivora.in");
      assert.equal(sanitized.otp, "[REDACTED]");
      assert.equal(sanitized.password, "[REDACTED]");
      assert.equal(sanitized.token, "[REDACTED]");
      assert.equal(sanitized.jwtAccessSecret, "[REDACTED]");
      assert.equal(sanitized.brevoApiKey, "[REDACTED]");
      assert.equal(sanitized.nested.refreshToken, "[REDACTED]");
      assert.equal(sanitized.nested.authorization, "[REDACTED]");
      assert.equal(sanitized.nested.safeField, "safe_value");
    });
  });
});

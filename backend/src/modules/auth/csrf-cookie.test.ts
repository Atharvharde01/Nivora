import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Request, Response } from "express";
import {
  generateCsrfToken,
  validateCsrfProtection,
  validateRequestOrigin,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "./csrf.utils";
import {
  setAuthCookies,
  clearAuthCookies,
  extractRefreshTokenFromRequest,
  PROD_REFRESH_COOKIE_NAME,
  DEV_REFRESH_COOKIE_NAME,
} from "./cookie.utils";
import { AuthError } from "./auth.errors";

describe("Task 24 — CSRF & Secure Cookie Helpers (Unit)", () => {
  describe("A. CSRF Token Generation & Validation", () => {
    it("generates a 64-character hexadecimal high-entropy token", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();

      assert.equal(typeof token1, "string");
      assert.equal(token1.length, 64);
      assert.match(token1, /^[0-9a-f]{64}$/);
      assert.notEqual(token1, token2);
    });

    it("accepts request when cookie and header CSRF tokens match", () => {
      const token = generateCsrfToken();
      const req = {
        cookies: {
          [CSRF_COOKIE_NAME]: token,
        },
        headers: {
          [CSRF_HEADER_NAME]: token,
        },
      } as unknown as Request;

      // Should not throw
      validateCsrfProtection(req);
    });

    it("rejects request when CSRF cookie is missing", () => {
      const token = generateCsrfToken();
      const req = {
        cookies: {},
        headers: {
          [CSRF_HEADER_NAME]: token,
        },
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(req),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CSRF_TOKEN_MISMATCH");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it("rejects request when X-CSRF-Token header is missing", () => {
      const token = generateCsrfToken();
      const req = {
        cookies: {
          [CSRF_COOKIE_NAME]: token,
        },
        headers: {},
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(req),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CSRF_TOKEN_MISMATCH");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it("rejects request when CSRF cookie and header tokens do not match", () => {
      const req = {
        cookies: {
          [CSRF_COOKIE_NAME]: "a".repeat(64),
        },
        headers: {
          [CSRF_HEADER_NAME]: "b".repeat(64),
        },
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(req),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CSRF_TOKEN_MISMATCH");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it("generates and validates a session-bound HMAC CSRF token", () => {
      const sessionId = "session_12345";
      const secret = "secret_key_minimum_32_characters";
      const boundToken = generateCsrfToken(sessionId, secret);

      assert.ok(boundToken.includes("."));
      const [salt, hmac] = boundToken.split(".");
      assert.equal(salt.length, 32);
      assert.equal(hmac.length, 64);

      const req = {
        cookies: { [CSRF_COOKIE_NAME]: boundToken },
        headers: { [CSRF_HEADER_NAME]: boundToken },
      } as unknown as Request;

      assert.doesNotThrow(() => validateCsrfProtection(req, sessionId, secret));
    });

    it("rejects session-bound CSRF token when presented for a different session", () => {
      const sessionIdA = "session_alice";
      const sessionIdB = "session_bob";
      const secret = "secret_key_minimum_32_characters";
      const aliceToken = generateCsrfToken(sessionIdA, secret);

      const req = {
        cookies: { [CSRF_COOKIE_NAME]: aliceToken },
        headers: { [CSRF_HEADER_NAME]: aliceToken },
      } as unknown as Request;

      assert.throws(
        () => validateCsrfProtection(req, sessionIdB, secret),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CSRF_TOKEN_MISMATCH");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe("B. Request Origin Enforcement", () => {
    const allowed = ["http://localhost:3000", "http://localhost:3001"];

    it("accepts approved origin", () => {
      const req = {
        headers: {
          origin: "http://localhost:3000",
        },
      } as unknown as Request;

      validateRequestOrigin(req, allowed);
    });

    it("rejects unapproved origin", () => {
      const req = {
        headers: {
          origin: "https://evil-attacker.example.com",
        },
      } as unknown as Request;

      assert.throws(
        () => validateRequestOrigin(req, allowed),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "FORBIDDEN");
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it("accepts approved referer if origin header is omitted", () => {
      const req = {
        headers: {
          referer: "http://localhost:3001/dashboard/trade",
        },
      } as unknown as Request;

      validateRequestOrigin(req, allowed);
    });
  });

  describe("C. Cookie Configuration & Security Attributes", () => {
    it("sets HttpOnly, Path=/, Host-only refresh cookie and non-HttpOnly CSRF cookie", () => {
      const setCookies: Array<{
        name: string;
        val: string;
        options: Record<string, unknown>;
      }> = [];

      const res = {
        cookie: (name: string, val: string, options: Record<string, unknown>) => {
          setCookies.push({ name, val, options });
        },
      } as unknown as Response;

      setAuthCookies(res, "mock-refresh-token", "mock-csrf-token", {
        isProduction: false,
      });

      assert.equal(setCookies.length, 2);

      const refreshCookie = setCookies.find(
        (c) => c.name === DEV_REFRESH_COOKIE_NAME
      );
      assert.ok(refreshCookie);
      assert.equal(refreshCookie.options.httpOnly, true);
      assert.equal(refreshCookie.options.path, "/");
      assert.equal(refreshCookie.options.sameSite, "lax");
      assert.equal(refreshCookie.options.domain, undefined); // Host-only (no Domain attribute)

      const csrfCookie = setCookies.find((c) => c.name === CSRF_COOKIE_NAME);
      assert.ok(csrfCookie);
      assert.equal(csrfCookie.options.httpOnly, false); // Accessible to JavaScript
      assert.equal(csrfCookie.options.path, "/");
    });

    it("uses __Host- prefix and secure: true in production", () => {
      const setCookies: Array<{
        name: string;
        options: Record<string, unknown>;
      }> = [];

      const res = {
        cookie: (name: string, _val: string, options: Record<string, unknown>) => {
          setCookies.push({ name, options });
        },
      } as unknown as Response;

      setAuthCookies(res, "mock-refresh-token", "mock-csrf-token", {
        isProduction: true,
      });

      const refreshCookie = setCookies.find(
        (c) => c.name === PROD_REFRESH_COOKIE_NAME
      );
      assert.ok(refreshCookie);
      assert.equal(refreshCookie.options.secure, true);
      assert.equal(refreshCookie.options.domain, undefined);
    });

    it("clears cookies with matching path and attributes", () => {
      const clearedCookies: string[] = [];
      const res = {
        clearCookie: (name: string) => {
          clearedCookies.push(name);
        },
      } as unknown as Response;

      clearAuthCookies(res, { isProduction: true });
      assert.ok(clearedCookies.includes(PROD_REFRESH_COOKIE_NAME));
      assert.ok(clearedCookies.includes(CSRF_COOKIE_NAME));
    });

    it("extracts refresh token safely from cookie object or raw header", () => {
      const reqWithCookies = {
        cookies: {
          [DEV_REFRESH_COOKIE_NAME]: "token-from-cookies",
        },
        headers: {},
      } as unknown as Request;

      assert.equal(
        extractRefreshTokenFromRequest(reqWithCookies, false),
        "token-from-cookies"
      );

      const reqWithHeaderOnly = {
        headers: {
          cookie: `other=123; ${DEV_REFRESH_COOKIE_NAME}=token-from-header; test=456`,
        },
      } as unknown as Request;

      assert.equal(
        extractRefreshTokenFromRequest(reqWithHeaderOnly, false),
        "token-from-header"
      );
    });
  });
});

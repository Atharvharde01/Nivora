import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOtpHmac,
  generateNumericOtp,
  verifyOtpHmac,
} from "./otp.service";
import { BrevoEmailService } from "./email.service";
import { AuthError } from "./auth.errors";

describe("Task 22 — Email OTP Authentication (Unit)", () => {
  const TEST_SECRET = "test_otp_hmac_secret_key_32_characters_minimum";

  describe("A. Numeric OTP Generation", () => {
    it("generates a 6-digit numeric string within 100000 to 999999", () => {
      for (let i = 0; i < 50; i++) {
        const otp = generateNumericOtp();
        assert.equal(typeof otp, "string");
        assert.equal(otp.length, 6);
        assert.match(otp, /^\d{6}$/);
        const num = Number(otp);
        assert.ok(num >= 100000 && num <= 999999);
      }
    });

    it("produces high-entropy distributed values across iterations", () => {
      const generated = new Set<string>();
      for (let i = 0; i < 100; i++) {
        generated.add(generateNumericOtp());
      }
      // With 900,000 possibilities, 100 random values should almost certainly have >= 95 unique entries
      assert.ok(
        generated.size >= 95,
        `Expected >= 95 unique values, got ${generated.size}`
      );
    });
  });

  describe("B. HMAC-SHA256 Digest & Constant-Time Verification", () => {
    it("computes a deterministic 64-character lowercase hex digest", () => {
      const hash1 = computeOtpHmac(TEST_SECRET, "trader@nivora.test", "123456");
      const hash2 = computeOtpHmac(TEST_SECRET, "trader@nivora.test", "123456");

      assert.equal(typeof hash1, "string");
      assert.equal(hash1.length, 64);
      assert.match(hash1, /^[0-9a-f]{64}$/);
      assert.equal(hash1, hash2);
    });

    it("normalizes email to lowercase and trims whitespace before computing HMAC", () => {
      const hashLower = computeOtpHmac(
        TEST_SECRET,
        "trader@nivora.test",
        "654321"
      );
      const hashUpper = computeOtpHmac(
        TEST_SECRET,
        "  TRADER@NIVORA.TEST  ",
        "654321"
      );
      assert.equal(hashUpper, hashLower);
    });

    it("binds HMAC to email (different emails produce different digests for same OTP)", () => {
      const hashA = computeOtpHmac(TEST_SECRET, "alice@nivora.test", "111222");
      const hashB = computeOtpHmac(TEST_SECRET, "bob@nivora.test", "111222");
      assert.notEqual(hashA, hashB);
    });

    it("binds HMAC to OTP value (different OTPs produce different digests for same email)", () => {
      const hashA = computeOtpHmac(TEST_SECRET, "alice@nivora.test", "111222");
      const hashB = computeOtpHmac(TEST_SECRET, "alice@nivora.test", "111223");
      assert.notEqual(hashA, hashB);
    });

    it("rejects secrets that are missing or shorter than 16 characters", () => {
      assert.throws(
        () => computeOtpHmac("", "user@nivora.test", "123456"),
        /minimum length of 16 characters/
      );
      assert.throws(
        () => computeOtpHmac("short-key", "user@nivora.test", "123456"),
        /minimum length of 16 characters/
      );
    });

    it("successfully verifies valid OTP with constant-time comparison", () => {
      const validHash = computeOtpHmac(
        TEST_SECRET,
        "user@nivora.test",
        "789012"
      );
      const verified = verifyOtpHmac(
        TEST_SECRET,
        "user@nivora.test",
        "789012",
        validHash
      );
      assert.equal(verified, true);
    });

    it("rejects mismatched OTP, invalid length, and malformed expected hashes", () => {
      const validHash = computeOtpHmac(
        TEST_SECRET,
        "user@nivora.test",
        "789012"
      );
      assert.equal(
        verifyOtpHmac(TEST_SECRET, "user@nivora.test", "789013", validHash),
        false
      );
      assert.equal(
        verifyOtpHmac(TEST_SECRET, "user@nivora.test", "78901", validHash),
        false
      );
      assert.equal(
        verifyOtpHmac(TEST_SECRET, "user@nivora.test", "7890123", validHash),
        false
      );
      assert.equal(
        verifyOtpHmac(TEST_SECRET, "user@nivora.test", "789012", "invalid-hash"),
        false
      );
    });
  });

  describe("C. Brevo Email Service Adapter", () => {
    it("validates required constructor credentials and options", () => {
      assert.throws(
        () =>
          new BrevoEmailService({
            apiKey: "",
            senderEmail: "noreply@nivora.app",
          }),
        /requires a valid API key/
      );
      assert.throws(
        () =>
          new BrevoEmailService({
            apiKey: "some-key",
            senderEmail: "",
          }),
        /requires a valid sender email/
      );
    });

    it("sends structured transactional email via Brevo REST API", async () => {
      let capturedUrl = "";
      let capturedOptions: RequestInit | undefined;

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedOptions = init;
        return new Response(JSON.stringify({ messageId: "<test-id>" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      };

      const service = new BrevoEmailService({
        apiKey: "xkeysib-mock-api-key",
        senderEmail: "noreply@nivora.app",
        senderName: "NIVORA Trading",
        fetchFn: mockFetch,
      });

      await service.sendOtpEmail("trader@nivora.test", "852963");

      assert.equal(capturedUrl, "https://api.brevo.com/v3/smtp/email");
      assert.ok(capturedOptions);
      assert.equal(capturedOptions.method, "POST");

      const headers = capturedOptions.headers as Record<string, string>;
      assert.equal(headers["api-key"], "xkeysib-mock-api-key");
      assert.equal(headers["Content-Type"], "application/json");

      const body = JSON.parse(String(capturedOptions.body));
      assert.equal(body.sender.email, "noreply@nivora.app");
      assert.equal(body.sender.name, "NIVORA Trading");
      assert.equal(body.to[0].email, "trader@nivora.test");
      assert.equal(body.subject, "Your NIVORA Sign-In Verification Code");
      assert.ok(body.textContent.includes("852963"));
      assert.ok(body.textContent.includes("5 minutes"));
      assert.ok(body.htmlContent.includes("852963"));
      assert.ok(body.htmlContent.includes("NIVORA"));
    });

    it("catches provider HTTP failure, sanitizes error, and throws EMAIL_DELIVERY_FAILED without leaking secrets", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({ code: "unauthorized", message: "Key invalid" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      const service = new BrevoEmailService({
        apiKey: "sensitive-secret-api-key-12345",
        senderEmail: "noreply@nivora.app",
        fetchFn: mockFetch,
      });

      await assert.rejects(
        async () => {
          await service.sendOtpEmail("trader@nivora.test", "123456");
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "EMAIL_DELIVERY_FAILED");
          assert.equal(err.statusCode, 502);
          // Crucial security requirement: ensure sensitive API key is NOT leaked in message
          assert.ok(!err.message.includes("sensitive-secret-api-key-12345"));
          return true;
        }
      );
    });

    it("catches network timeout and throws EMAIL_DELIVERY_FAILED", async () => {
      const mockFetch: typeof fetch = async () => {
        const timeoutError = new Error("The operation was aborted due to timeout");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      };

      const service = new BrevoEmailService({
        apiKey: "mock-key",
        senderEmail: "noreply@nivora.app",
        fetchFn: mockFetch,
      });

      await assert.rejects(
        async () => {
          await service.sendOtpEmail("trader@nivora.test", "123456");
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "EMAIL_DELIVERY_FAILED");
          assert.equal(err.statusCode, 502);
          return true;
        }
      );
    });
  });
});

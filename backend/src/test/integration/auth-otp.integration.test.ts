import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  clearDatabase,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { OtpChallengeModel } from "../../modules/auth/otp-challenge.model";
import { MockEmailService } from "../../modules/auth/email.service";
import { OtpService } from "../../modules/auth/otp.service";
import { AuthError } from "../../modules/auth/auth.errors";

describe("Task 22 — Email OTP Authentication (Real Replica-Set Integration)", () => {
  const TEST_HMAC_SECRET =
    "integration_test_otp_hmac_secret_key_minimum_32_characters";
  let mockEmailService: MockEmailService;
  let otpService: OtpService;

  before(async () => {
    await setupIntegrationTestDb();
  });

  after(async () => {
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    mockEmailService = new MockEmailService();
    otpService = new OtpService({
      hmacSecret: TEST_HMAC_SECRET,
      emailService: mockEmailService,
      expiryMs: 5 * 60 * 1000,
      resendCooldownMs: 60 * 1000,
      maxAttempts: 5,
      emailRateLimit: 5,
      ipRateLimit: 10,
    });
  });

  describe("1. OTP Challenge Creation & Persistence", () => {
    it("persists PENDING challenge, hides hash by default, and triggers email delivery", async () => {
      const email = "trader.alpha@nivora.test";
      const requestIp = "192.168.1.50";

      const result = await otpService.requestOtp(email, requestIp);

      assert.equal(result.success, true);
      assert.equal(
        result.message,
        "If the email is valid, a verification code has been sent."
      );

      // Verify email was sent via mock
      assert.equal(mockEmailService.sentEmails.length, 1);
      const sent = mockEmailService.sentEmails[0];
      assert.equal(sent.toEmail, email);
      assert.match(sent.otp, /^\d{6}$/);

      // Query database: challenge exists with status PENDING
      const doc = await OtpChallengeModel.findOne({ email }).lean();
      assert.ok(doc);
      assert.equal(doc.email, email);
      assert.equal(doc.status, "PENDING");
      assert.equal(doc.attempts, 0);
      assert.equal(doc.maxAttempts, 5);
      // Ensure select: false fields are excluded in standard query
      assert.equal((doc as Record<string, unknown>).otpHash, undefined);
      assert.equal((doc as Record<string, unknown>).requestIp, undefined);
    });

    it("enforces resend cooldown on active challenge and rejects premature resend", async () => {
      const email = "cooldown.trader@nivora.test";
      const requestIp = "10.0.0.1";
      const startTime = new Date("2026-11-10T12:00:00.000Z");

      await otpService.requestOtp(email, requestIp, startTime);

      // Attempt immediate resend at T + 10s (cooldown is 60s)
      const prematureTime = new Date("2026-11-10T12:00:10.000Z");
      await assert.rejects(
        async () => {
          await otpService.requestOtp(email, requestIp, prematureTime);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "RESEND_COOLDOWN_ACTIVE");
          assert.equal(err.statusCode, 429);
          assert.equal(err.details?.retryAfterSeconds, 50);
          return true;
        }
      );

      // Exactly 1 email was sent (the second request was rejected before delivery)
      assert.equal(mockEmailService.sentEmails.length, 1);
    });

    it("supersedes older pending challenge and allows resend once cooldown elapsed", async () => {
      const email = "supersede.trader@nivora.test";
      const requestIp = "10.0.0.2";
      const t0 = new Date("2026-11-10T12:00:00.000Z");

      await otpService.requestOtp(email, requestIp, t0);
      assert.equal(mockEmailService.sentEmails.length, 1);
      const firstOtp = mockEmailService.sentEmails[0].otp;

      // Resend after 61 seconds
      const t1 = new Date("2026-11-10T12:01:01.000Z");
      await otpService.requestOtp(email, requestIp, t1);
      assert.equal(mockEmailService.sentEmails.length, 2);
      const secondOtp = mockEmailService.sentEmails[1].otp;

      // Old challenge must now be SUPERSEDED
      const supersededDoc = await OtpChallengeModel.findOne({
        email,
        status: "SUPERSEDED",
      }).lean();
      assert.ok(supersededDoc);

      // New challenge is PENDING
      const activeDoc = await OtpChallengeModel.findOne({
        email,
        status: "PENDING",
      }).lean();
      assert.ok(activeDoc);
      assert.notEqual(activeDoc._id.toString(), supersededDoc._id.toString());

      // Attempting to verify with old OTP fails
      await assert.rejects(async () => {
        await otpService.verifyOtp(email, firstOtp, t1);
      });

      // Verifying with new OTP succeeds
      const verifyRes = await otpService.verifyOtp(email, secondOtp, t1);
      assert.equal(verifyRes.email, email);
    });

    it("marks challenge SUPERSEDED if email delivery fails, preventing orphaned usable OTPs", async () => {
      const email = "fail.trader@nivora.test";
      const requestIp = "10.0.0.3";

      mockEmailService.shouldFail = true;

      await assert.rejects(
        async () => {
          await otpService.requestOtp(email, requestIp);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "EMAIL_DELIVERY_FAILED");
          return true;
        }
      );

      // Challenge in DB must not remain PENDING
      const doc = await OtpChallengeModel.findOne({ email }).lean();
      assert.ok(doc);
      assert.equal(doc.status, "SUPERSEDED");
    });
  });

  describe("2. Rate Limiting", () => {
    it("enforces rolling window rate limit by email address (max 5 in 15 mins)", async () => {
      const email = "ratelimit.email@nivora.test";
      const baseTime = new Date("2026-11-10T12:00:00.000Z");

      // Send 5 OTPs spaced by 65s (respecting 60s cooldown)
      for (let i = 0; i < 5; i++) {
        const time = new Date(baseTime.getTime() + i * 65_000);
        await otpService.requestOtp(email, `10.0.1.${i + 1}`, time);
      }

      // 6th request within the 15-minute window must be blocked by rate limiting
      const sixthTime = new Date(baseTime.getTime() + 5 * 65_000); // T + 325s (~5.4 mins)
      await assert.rejects(
        async () => {
          await otpService.requestOtp(email, "10.0.1.99", sixthTime);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
          assert.equal(err.statusCode, 429);
          return true;
        }
      );
    });

    it("enforces rolling window rate limit by request IP (max 10 in 15 mins)", async () => {
      const requestIp = "198.51.100.25";
      const baseTime = new Date("2026-11-10T12:00:00.000Z");

      // 10 different emails from the same IP
      for (let i = 0; i < 10; i++) {
        await otpService.requestOtp(
          `trader.${i}@nivora.test`,
          requestIp,
          baseTime
        );
      }

      // 11th request from this IP must be blocked
      await assert.rejects(
        async () => {
          await otpService.requestOtp("trader.11@nivora.test", requestIp, baseTime);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
          assert.equal(err.statusCode, 429);
          return true;
        }
      );
    });
  });

  describe("3. OTP Verification Lifecycle & Concurrency", () => {
    it("safely increments failed attempts and transitions to EXHAUSTED on 5th failure", async () => {
      const email = "exhaust.trader@nivora.test";
      const requestIp = "10.0.0.5";

      await otpService.requestOtp(email, requestIp);
      const correctOtp = mockEmailService.sentEmails[0].otp;
      const wrongOtp = "999999";

      // 4 wrong attempts
      for (let attempt = 1; attempt <= 4; attempt++) {
        await assert.rejects(
          async () => {
            await otpService.verifyOtp(email, wrongOtp);
          },
          (err: unknown) => {
            assert.ok(err instanceof AuthError);
            assert.equal(err.code, "INVALID_OTP");
            assert.equal(err.details?.remainingAttempts, 5 - attempt);
            return true;
          }
        );
      }

      // 5th wrong attempt -> exhausts challenge
      await assert.rejects(
        async () => {
          await otpService.verifyOtp(email, wrongOtp);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "OTP_EXHAUSTED");
          return true;
        }
      );

      // Verify in DB that status is now EXHAUSTED
      const doc = await OtpChallengeModel.findOne({ email }).lean();
      assert.ok(doc);
      assert.equal(doc.status, "EXHAUSTED");
      assert.equal(doc.attempts, 5);

      // Even supplying the correct OTP is now rejected because the challenge is exhausted
      await assert.rejects(
        async () => {
          await otpService.verifyOtp(email, correctOtp);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CHALLENGE_NOT_FOUND");
          return true;
        }
      );
    });

    it("atomically consumes challenge on valid verification and enforces single-use", async () => {
      const email = "consume.trader@nivora.test";
      const requestIp = "10.0.0.6";

      await otpService.requestOtp(email, requestIp);
      const correctOtp = mockEmailService.sentEmails[0].otp;

      // 1. First verification succeeds
      const result = await otpService.verifyOtp(email, correctOtp);
      assert.equal(result.email, email);
      assert.ok(result.challengeId);

      // DB check: status is CONSUMED and consumedAt is set
      const doc = await OtpChallengeModel.findById(result.challengeId).lean();
      assert.ok(doc);
      assert.equal(doc.status, "CONSUMED");
      assert.ok(doc.consumedAt instanceof Date);

      // 2. Second verification with same valid OTP fails (single-use invariant)
      await assert.rejects(
        async () => {
          await otpService.verifyOtp(email, correctOtp);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "CHALLENGE_NOT_FOUND");
          return true;
        }
      );
    });

    it("rejects expired OTP challenge and marks it EXHAUSTED", async () => {
      const email = "expire.trader@nivora.test";
      const requestIp = "10.0.0.7";
      const requestTime = new Date("2026-11-10T12:00:00.000Z");

      await otpService.requestOtp(email, requestIp, requestTime);
      const otp = mockEmailService.sentEmails[0].otp;

      // Attempt verify at T + 5m 1s (past 5-minute expiry)
      const expiredTime = new Date("2026-11-10T12:05:01.000Z");
      await assert.rejects(
        async () => {
          await otpService.verifyOtp(email, otp, expiredTime);
        },
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "OTP_EXPIRED");
          return true;
        }
      );

      const doc = await OtpChallengeModel.findOne({ email }).lean();
      assert.ok(doc);
      assert.equal(doc.status, "EXHAUSTED");
    });

    it("prevents duplicate consumption under concurrent verification attempts", async () => {
      const email = "concurrency.otp@nivora.test";
      const requestIp = "10.0.0.8";

      await otpService.requestOtp(email, requestIp);
      const validOtp = mockEmailService.sentEmails[0].otp;

      // Fire two simultaneous verification requests with the same valid OTP
      const results = await Promise.allSettled([
        otpService.verifyOtp(email, validOtp),
        otpService.verifyOtp(email, validOtp),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly ONE request must succeed in consuming the challenge
      assert.equal(
        fulfilled.length,
        1,
        "Expected exactly 1 verification to succeed"
      );
      assert.equal(
        rejected.length,
        1,
        "Expected exactly 1 verification to be rejected"
      );

      const rejectedError = (
        rejected[0] as PromiseRejectedResult
      ).reason as AuthError;
      assert.ok(
        rejectedError.code === "CONCURRENCY_CONFLICT" ||
          rejectedError.code === "CHALLENGE_NOT_FOUND"
      );

      // Verify in DB that only 1 challenge exists and is CONSUMED
      const consumedCount = await OtpChallengeModel.countDocuments({
        email,
        status: "CONSUMED",
      });
      assert.equal(consumedCount, 1);
    });
  });
});

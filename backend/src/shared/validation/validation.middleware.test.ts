import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  escapeRegex,
  hasNoSqlInjectionKeys,
  noSqlSanitizer,
  validateRequest,
} from "./validation.middleware";
import {
  createOrderBodySchema,
  dateRangeQuerySchema,
  emailSchema,
  idempotencyKeyHeaderObjectSchema,
  objectIdSchema,
  paginationQuerySchema,
  quantitySchema,
} from "./schemas";

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

describe("Task 29 — Centralized Request Validation (Unit)", () => {
  describe("A. Primitive Schemas", () => {
    it("validates standard 24-character hexadecimal MongoDB ObjectIds and rejects malformed values", () => {
      const valid = "507f1f77bcf86cd799439011";
      const parsed = objectIdSchema.parse(valid);
      assert.equal(parsed, valid);

      assert.throws(() => objectIdSchema.parse("invalid-id"));
      assert.throws(() => objectIdSchema.parse("12345"));
      assert.throws(() => objectIdSchema.parse("507f1f77bcf86cd79943901z")); // non-hex
    });

    it("validates and normalizes email addresses to lowercase", () => {
      const email = "  Trader.Alpha@Nivora.IO  ";
      const parsed = emailSchema.parse(email);
      assert.equal(parsed, "trader.alpha@nivora.io");

      assert.throws(() => emailSchema.parse("not-an-email"));
      assert.throws(() => emailSchema.parse(""));
    });

    it("validates quantities: positive whole integers only", () => {
      assert.equal(quantitySchema.parse(1), 1);
      assert.equal(quantitySchema.parse(500), 500);

      assert.throws(() => quantitySchema.parse(0));
      assert.throws(() => quantitySchema.parse(-5));
      assert.throws(() => quantitySchema.parse(1.5));
      assert.throws(() => quantitySchema.parse(NaN));
      assert.throws(() => quantitySchema.parse(Infinity));
    });

    it("validates pagination with defaults: page=1, limit=20 (capped at 100)", () => {
      const defaultParsed = paginationQuerySchema.parse({});
      assert.equal(defaultParsed.page, 1);
      assert.equal(defaultParsed.limit, 20);

      const customParsed = paginationQuerySchema.parse({ page: "3", limit: "50" });
      assert.equal(customParsed.page, 3);
      assert.equal(customParsed.limit, 50);

      assert.throws(() => paginationQuerySchema.parse({ page: "0" }));
      assert.throws(() => paginationQuerySchema.parse({ page: "-1" }));
      assert.throws(() => paginationQuerySchema.parse({ limit: "150" }));
      assert.throws(() => paginationQuerySchema.parse({ page: "1.5" }));
    });

    it("validates date ranges and rejects from > to", () => {
      const valid = dateRangeQuerySchema.parse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
      });
      assert.ok(valid.from && valid.to);

      assert.throws(() =>
        dateRangeQuerySchema.parse({
          from: "2026-01-05T00:00:00.000Z",
          to: "2026-01-01T00:00:00.000Z",
        })
      );
    });
  });

  describe("B. NoSQL Query Injection & Regex Sanitization", () => {
    it("detects keys starting with $ or containing .", () => {
      assert.equal(hasNoSqlInjectionKeys({ $gt: 5 }), true);
      assert.equal(hasNoSqlInjectionKeys({ nested: { $where: "1" } }), true);
      assert.equal(hasNoSqlInjectionKeys({ "user.name": "hacker" }), true);
      assert.equal(hasNoSqlInjectionKeys({ symbol: "INFY", quantity: 10 }), false);
    });

    it("rejects prohibited query operators via noSqlSanitizer with 400", () => {
      const req = {
        query: { $gt: "" },
        params: {},
        body: {},
      } as unknown as Request;
      const res = createMockResponse();
      let nextCalled = false;

      noSqlSanitizer(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "INVALID_REQUEST_PARAMETERS");
    });

    it("escapes regex special characters safely", () => {
      const unsafe = "RELIANCE.*+?^${}()|[]\\";
      const escaped = escapeRegex(unsafe);
      assert.equal(
        escaped,
        "RELIANCE\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
      );
    });
  });

  describe("C. Validation Middleware & Strict Body Rejection", () => {
    it("passes valid order payload through to next()", async () => {
      const middleware = validateRequest({
        headers: idempotencyKeyHeaderObjectSchema,
        body: createOrderBodySchema,
      });

      const req = {
        headers: { "idempotency-key": "valid-idempotency-key-12345" },
        body: {
          instrumentId: "507f1f77bcf86cd799439011",
          side: "BUY",
          quantity: 10,
        },
        params: {},
        query: {},
      } as unknown as Request;
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 200);
    });

    it("strictly rejects client-supplied price fields with CLIENT_PRICE_NOT_ALLOWED", async () => {
      const middleware = validateRequest({
        body: createOrderBodySchema,
      });

      const req = {
        headers: {},
        body: {
          instrumentId: "507f1f77bcf86cd799439011",
          side: "BUY",
          quantity: 10,
          price: 500, // forbidden!
        },
        params: {},
        query: {},
      } as unknown as Request;
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "CLIENT_PRICE_NOT_ALLOWED");
    });

    it("strictly rejects unknown fields in strict schemas", async () => {
      const middleware = validateRequest({
        body: createOrderBodySchema,
      });

      const req = {
        headers: {},
        body: {
          instrumentId: "507f1f77bcf86cd799439011",
          side: "BUY",
          quantity: 10,
          arbitraryField: "malicious",
        },
        params: {},
        query: {},
      } as unknown as Request;
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.ok(res.body.error.details.length > 0);
    });

    it("redacts sensitive fields from validation error details", async () => {
      const middleware = validateRequest({
        body: z.object({
          email: emailSchema,
          otp: z.string().min(6),
        }),
      });

      const req = {
        headers: {},
        body: {
          email: "trader@nivora.io",
          otp: "123", // too short
        },
        params: {},
        query: {},
      } as unknown as Request;
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.equal(res.statusCode, 400);
      const detail = res.body.error.details.find(
        (d: any) => d.field === "otp"
      );
      assert.ok(detail);
      assert.equal(detail.message, "Invalid value for sensitive field.");
      // Ensure the raw value "123" is never leaked
      assert.ok(!JSON.stringify(res.body).includes("123"));
    });
  });
});

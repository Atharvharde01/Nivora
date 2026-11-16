import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import {
  JwtService,
  DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
} from "./jwt.service";
import { AuthError } from "./auth.errors";

describe("Task 23 — JWT Access Tokens & Session Authentication (Unit)", () => {
  const TEST_SECRET =
    "test_jwt_access_secret_key_minimum_32_characters_long";
  const TEST_ISSUER = "test-nivora-api";
  const TEST_AUDIENCE = "test-nivora-client";

  const jwtService = new JwtService({
    accessSecret: TEST_SECRET,
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
  });

  describe("A. JWT Token Generation", () => {
    it("generates a valid HS256-signed JWT with 15-minute lifetime and required claims", () => {
      const userId = "507f1f77bcf86cd799439011";
      const sessionId = "507f191e810c19729de860ea";

      const token = jwtService.generateAccessToken({ userId, sessionId });
      assert.equal(typeof token, "string");
      assert.ok(token.split(".").length === 3);

      const decodedHeader = jwt.decode(token, { complete: true })?.header;
      assert.equal(decodedHeader?.alg, "HS256");
      assert.equal(decodedHeader?.typ, "JWT");

      const claims = jwtService.verifyAccessToken(token);
      assert.equal(claims.sub, userId);
      assert.equal(claims.sid, sessionId);
      assert.equal(claims.iss, TEST_ISSUER);
      assert.equal(claims.aud, TEST_AUDIENCE);
      assert.equal(
        claims.exp - claims.iat,
        DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS
      );
      assert.ok(claims.jti);
      assert.equal(typeof claims.jti, "string");
    });

    it("rejects generation with missing userId or sessionId", () => {
      assert.throws(
        () =>
          jwtService.generateAccessToken({
            userId: "",
            sessionId: "session-123",
          }),
        /userId is required/
      );
      assert.throws(
        () =>
          jwtService.generateAccessToken({
            userId: "user-123",
            sessionId: "",
          }),
        /sessionId is required/
      );
    });
  });

  describe("B. JWT Verification & Claim Enforcement", () => {
    it("verifies signature and parses valid token claims", () => {
      const token = jwtService.generateAccessToken({
        userId: "user-1",
        sessionId: "session-1",
      });

      const claims = jwtService.verifyAccessToken(token);
      assert.equal(claims.sub, "user-1");
      assert.equal(claims.sid, "session-1");
    });

    it("rejects token signed with an invalid/mismatched secret", () => {
      const untrustedToken = jwt.sign(
        { sid: "session-1" },
        "different_secret_key_minimum_32_characters",
        {
          algorithm: "HS256",
          expiresIn: "15m",
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          subject: "user-1",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(untrustedToken),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    it("rejects expired token with TOKEN_EXPIRED error code", () => {
      const expiredToken = jwt.sign(
        { sid: "session-1" },
        TEST_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "-1s", // Expired 1 second ago
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          subject: "user-1",
          jwtid: "random-jti",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(expiredToken),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "TOKEN_EXPIRED");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    it("rejects token with invalid issuer", () => {
      const invalidIssuerToken = jwt.sign(
        { sid: "session-1" },
        TEST_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "15m",
          issuer: "rogue-issuer",
          audience: TEST_AUDIENCE,
          subject: "user-1",
          jwtid: "random-jti",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(invalidIssuerToken),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    it("rejects token with invalid audience", () => {
      const invalidAudienceToken = jwt.sign(
        { sid: "session-1" },
        TEST_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "15m",
          issuer: TEST_ISSUER,
          audience: "rogue-client",
          subject: "user-1",
          jwtid: "random-jti",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(invalidAudienceToken),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    it("rejects tokens with disallowed algorithm (alg: none or asymmetric algos)", () => {
      // Unsigned token (alg: none)
      const unsignedToken = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"sub":"user-1","sid":"session-1","iss":"test-nivora-api","aud":"test-nivora-client"}').toString("base64url")}.`;

      assert.throws(
        () => jwtService.verifyAccessToken(unsignedToken),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          return true;
        }
      );
    });

    it("rejects tokens missing required 'sub', 'sid', or 'jti' claims", () => {
      // Missing sub
      const missingSub = jwt.sign(
        { sid: "session-1" },
        TEST_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "15m",
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          jwtid: "test-jti",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(missingSub),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          assert.match(err.message, /sub/);
          return true;
        }
      );

      // Missing sid
      const missingSid = jwt.sign(
        {},
        TEST_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "15m",
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          subject: "user-1",
          jwtid: "test-jti",
        }
      );

      assert.throws(
        () => jwtService.verifyAccessToken(missingSid),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, "UNAUTHORIZED");
          assert.match(err.message, /sid/);
          return true;
        }
      );
    });
  });
});

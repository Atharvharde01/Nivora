import crypto from "node:crypto";
import jwt, { JwtPayload, SignOptions, VerifyOptions } from "jsonwebtoken";
import { AuthError } from "./auth.errors";

export interface JwtServiceOptions {
  accessSecret: string;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60; // 15 minutes
export const DEFAULT_JWT_ISSUER = "nivora-api";
export const DEFAULT_JWT_AUDIENCE = "nivora-client";

export class JwtService {
  private readonly accessSecret: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly expiresInSeconds: number;

  constructor(options: JwtServiceOptions) {
    if (!options.accessSecret || options.accessSecret.trim().length < 16) {
      throw new Error(
        "JwtService requires an access token secret with a minimum length of 16 characters."
      );
    }
    this.accessSecret = options.accessSecret.trim();
    this.issuer = options.issuer ?? DEFAULT_JWT_ISSUER;
    this.audience = options.audience ?? DEFAULT_JWT_AUDIENCE;
    this.expiresInSeconds =
      options.expiresInSeconds ?? DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
  }

  /**
   * Generates a signed 15-minute access JWT with required claims.
   * Algorithm is strictly enforced to HS256.
   */
  public generateAccessToken(payload: {
    userId: string;
    sessionId: string;
  }): string {
    if (!payload.userId || typeof payload.userId !== "string") {
      throw new Error("userId is required for access token generation.");
    }
    if (!payload.sessionId || typeof payload.sessionId !== "string") {
      throw new Error("sessionId is required for access token generation.");
    }

    const jti = crypto.randomUUID();

    const signOptions: SignOptions = {
      algorithm: "HS256",
      expiresIn: this.expiresInSeconds,
      issuer: this.issuer,
      audience: this.audience,
      subject: payload.userId,
      jwtid: jti,
    };

    return jwt.sign(
      {
        sid: payload.sessionId,
      },
      this.accessSecret,
      signOptions
    );
  }

  /**
   * Validates access token signature, algorithm (strictly HS256), issuer, audience, and expiry.
   * Returns decoded claims.
   */
  public verifyAccessToken(token: string): AccessTokenClaims {
    if (!token || typeof token !== "string") {
      throw new AuthError("UNAUTHORIZED", "Missing access token.", 401);
    }

    const verifyOptions: VerifyOptions = {
      algorithms: ["HS256"], // Whitelist strictly HS256; disallow 'none' and other algos
      issuer: this.issuer,
      audience: this.audience,
    };

    let decoded: JwtPayload | string;
    try {
      decoded = jwt.verify(token, this.accessSecret, verifyOptions);
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AuthError("TOKEN_EXPIRED", "Access token has expired.", 401);
      }
      if (err instanceof jwt.JsonWebTokenError) {
        throw new AuthError("UNAUTHORIZED", `Invalid access token: ${err.message}`, 401);
      }
      throw new AuthError("UNAUTHORIZED", "Failed to verify access token.", 401);
    }

    if (typeof decoded === "string" || !decoded) {
      throw new AuthError("UNAUTHORIZED", "Malformed access token payload.", 401);
    }

    if (!decoded.sub || typeof decoded.sub !== "string") {
      throw new AuthError("UNAUTHORIZED", "Token missing required 'sub' claim.", 401);
    }

    if (!decoded.sid || typeof decoded.sid !== "string") {
      throw new AuthError("UNAUTHORIZED", "Token missing required 'sid' claim.", 401);
    }

    if (!decoded.jti || typeof decoded.jti !== "string") {
      throw new AuthError("UNAUTHORIZED", "Token missing required 'jti' claim.", 401);
    }

    return {
      sub: decoded.sub,
      sid: decoded.sid,
      iss: decoded.iss as string,
      aud: decoded.aud as string,
      iat: decoded.iat as number,
      exp: decoded.exp as number,
      jti: decoded.jti,
    };
  }
}

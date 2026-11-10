import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { JwtService } from "./jwt.service";
import { SessionModel } from "./session.model";
import { UserModel } from "../users/user.model";
import { AuthError } from "./auth.errors";
import { IUser } from "../users/user.types";
import { ISession } from "./auth.types";
import { SESSION_IDLE_TIMEOUT_MS } from "./auth.service";

// Activity update throttling: only update session timestamp once every 15 minutes
const ACTIVITY_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      user?: IUser & { _id: Types.ObjectId };
      session?: ISession & { _id: Types.ObjectId };
    }
  }
}

export function createAuthMiddleware(jwtService: JwtService) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || typeof authHeader !== "string") {
        throw new AuthError(
          "UNAUTHORIZED",
          "Authorization header missing.",
          401
        );
      }

      if (!authHeader.startsWith("Bearer ")) {
        throw new AuthError(
          "UNAUTHORIZED",
          "Invalid authorization scheme. Bearer token required.",
          401
        );
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        throw new AuthError("UNAUTHORIZED", "Access token is empty.", 401);
      }

      // 1. Verify access token signature, algorithm, issuer, audience, and expiry
      const decoded = jwtService.verifyAccessToken(token);

      const now = new Date();

      // 2. Retrieve session by decoded 'sid'
      const session = await SessionModel.findById(decoded.sid).select(
        "+currentRefreshTokenHash +ipAddress +userAgent"
      );

      if (!session) {
        throw new AuthError(
          "UNAUTHORIZED",
          "Session not found or already deleted.",
          401
        );
      }

      if (session.status !== "ACTIVE") {
        throw new AuthError(
          "SESSION_REVOKED",
          `Session is ${session.status.toLowerCase()}.`,
          401
        );
      }

      // 3. Enforce 7-day idle timeout
      if (now.getTime() > session.idleExpiresAt.getTime()) {
        await SessionModel.updateOne(
          { _id: session._id, status: "ACTIVE" },
          {
            $set: {
              status: "EXPIRED",
              revokedReason: "IDLE_TIMEOUT",
              revokedAt: now,
            },
          }
        );
        throw new AuthError(
          "SESSION_EXPIRED",
          "Session expired due to inactivity. Please sign in again.",
          401
        );
      }

      // 4. Enforce 30-day absolute timeout
      if (now.getTime() > session.absoluteExpiresAt.getTime()) {
        await SessionModel.updateOne(
          { _id: session._id, status: "ACTIVE" },
          {
            $set: {
              status: "EXPIRED",
              revokedReason: "ABSOLUTE_TIMEOUT",
              revokedAt: now,
            },
          }
        );
        throw new AuthError(
          "SESSION_EXPIRED",
          "Session lifetime has expired. Please sign in again.",
          401
        );
      }

      // 5. Retrieve User by decoded 'sub'
      const user = await UserModel.findById(decoded.sub);
      if (!user) {
        throw new AuthError("USER_NOT_FOUND", "User does not exist.", 404);
      }

      if (user.status !== "ACTIVE") {
        throw new AuthError(
          "USER_SUSPENDED",
          "User account is suspended.",
          403
        );
      }

      // 6. Throttled activity refresh (only writes to DB if > 15m since lastActiveAt)
      if (
        now.getTime() - session.lastActiveAt.getTime() >
        ACTIVITY_UPDATE_INTERVAL_MS
      ) {
        const candidateIdle = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
        const newIdleExpiresAt =
          candidateIdle.getTime() < session.absoluteExpiresAt.getTime()
            ? candidateIdle
            : session.absoluteExpiresAt;

        await SessionModel.updateOne(
          { _id: session._id, status: "ACTIVE" },
          {
            $set: {
              lastActiveAt: now,
              idleExpiresAt: newIdleExpiresAt,
            },
          }
        );
      }

      // 7. Attach strongly-typed authenticated user and session to request
      req.user = user as unknown as IUser & { _id: Types.ObjectId };
      req.session = session as unknown as ISession & { _id: Types.ObjectId };

      next();
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        res.status(err.statusCode).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          },
        });
        return;
      }

      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication failed.",
        },
      });
    }
  };
}

import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

/**
 * Request correlation middleware:
 * Assigns a unique X-Request-Id (UUID v4) to every incoming request or preserves
 * an existing valid upstream request ID.
 * Sets req.id and the X-Request-Id HTTP response header.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingHeader = req.headers[REQUEST_ID_HEADER];
  let requestId: string;

  if (
    typeof incomingHeader === "string" &&
    VALID_REQUEST_ID_REGEX.test(incomingHeader.trim())
  ) {
    requestId = incomingHeader.trim();
  } else {
    requestId = crypto.randomUUID();
  }

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

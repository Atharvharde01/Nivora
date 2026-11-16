import { Request, Response, NextFunction } from "express";
import { AppError } from "./app-error";
import { AuthError } from "../../modules/auth/auth.errors";
import { PracticeAccountError } from "../../modules/practice-accounts/account.service.types";
import { OrderExecutionError } from "../../modules/orders/order-execution.types";
import { WatchlistError } from "../../modules/watchlist/watchlist.types";
import { logError } from "../security";

export function centralErrorHandler(isProduction: boolean) {
  return (
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    // 1. CORS origin rejection
    if (err instanceof Error && err.message.startsWith("CORS blocked")) {
      res.status(403).json({
        success: false,
        status: 403,
        error: err.message,
      });
      return;
    }

    // 2. Payload too large (413)
    if (
      (typeof err === "object" &&
        err !== null &&
        "type" in err &&
        (err as { type: unknown }).type === "entity.too.large") ||
      (typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: unknown }).status === 413)
    ) {
      res.status(413).json({
        success: false,
        status: 413,
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request payload exceeds size limit.",
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 3. BodyParser malformed JSON (400)
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        success: false,
        status: 400,
        error: "Malformed JSON payload",
      });
      return;
    }

    // 4. AppError
    if (err instanceof AppError) {
      logError(`${req.method} ${req.originalUrl}`, err, req);
      res.status(err.statusCode).json({
        success: false,
        status: err.statusCode,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 5. AuthError
    if (err instanceof AuthError) {
      logError(`${req.method} ${req.originalUrl}`, err, req);
      res.status(err.statusCode).json({
        success: false,
        status: err.statusCode,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 6. PracticeAccountError
    if (err instanceof PracticeAccountError) {
      let statusCode = 400;
      if (
        err.code === "ACCOUNT_NOT_FOUND" ||
        err.code === "ACTIVE_ACCOUNT_NOT_FOUND"
      ) {
        statusCode = 404;
      } else if (err.code === "ACCOUNT_OWNERSHIP_VIOLATION") {
        statusCode = 403;
      } else if (err.code === "ACCOUNT_RESET_CONFLICT") {
        statusCode = 409;
      }
      logError(`${req.method} ${req.originalUrl}`, err, req);
      res.status(statusCode).json({
        success: false,
        status: statusCode,
        error: {
          code: err.code,
          message: err.message,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 7. OrderExecutionError
    if (err instanceof OrderExecutionError) {
      let statusCode = 400;
      if (
        err.code === "IDEMPOTENCY_KEY_CONFLICT" ||
        err.code === "CONCURRENCY_CONFLICT"
      ) {
        statusCode = 409;
      } else if (
        err.code === "USER_NOT_PERMITTED" ||
        err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
      ) {
        statusCode = 403;
      } else if (
        err.code === "USER_NOT_FOUND" ||
        err.code === "ACCOUNT_NOT_FOUND" ||
        err.code === "INSTRUMENT_NOT_FOUND"
      ) {
        statusCode = 404;
      } else if (err.code === "TRANSACTION_UNAVAILABLE") {
        statusCode = 503;
      } else if (err.code === "EXECUTION_FAILED") {
        statusCode = 500;
      }
      logError(`${req.method} ${req.originalUrl}`, err, req);
      res.status(statusCode).json({
        success: false,
        status: statusCode,
        error: {
          code: err.code,
          message: err.message,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 8. WatchlistError
    if (err instanceof WatchlistError) {
      logError(`${req.method} ${req.originalUrl}`, err, req);
      res.status(err.statusCode).json({
        success: false,
        status: err.statusCode,
        error: {
          code: err.code,
          message: err.message,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 8. Mongoose CastError (invalid ObjectId format)
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: unknown }).name === "CastError"
    ) {
      const path = (err as { path?: unknown }).path || "id";
      res.status(400).json({
        success: false,
        status: 400,
        error: {
          code: "INVALID_IDENTIFIER",
          message: `Invalid identifier format for field '${path}'.`,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 9. Mongoose ValidationError
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: unknown }).name === "ValidationError"
    ) {
      const validationErr = err as {
        errors?: Record<string, { message?: string }>;
      };
      const details: Record<string, string> = {};
      if (validationErr.errors) {
        for (const [k, v] of Object.entries(validationErr.errors)) {
          details[k] = v.message || "Invalid value";
        }
      }
      res.status(400).json({
        success: false,
        status: 400,
        error: {
          code: "VALIDATION_ERROR",
          message: (err as Error).message,
          details,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 10. Mongo duplicate key error (code 11000 / 11001)
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code: unknown }).code === 11000 ||
        (err as { code: unknown }).code === 11001)
    ) {
      const errmsg = String(
        (err as { errmsg?: unknown; message?: unknown }).errmsg ||
          (err as { message?: unknown }).message ||
          ""
      );
      let code = "DUPLICATE_RESOURCE";
      let message = "A resource with this unique constraint already exists.";

      if (
        errmsg.includes("orders_user_idempotency_key") ||
        errmsg.includes("idempotencyKey")
      ) {
        code = "IDEMPOTENCY_KEY_CONFLICT";
        message = "An order with this idempotency key already exists.";
      } else if (
        errmsg.includes("watchlist_items_user_instrument_unique") ||
        errmsg.includes("instrumentId")
      ) {
        code = "WATCHLIST_ITEM_ALREADY_EXISTS";
        message = "Instrument is already present in watchlist.";
      } else if (
        errmsg.includes("users_email") ||
        errmsg.includes("email")
      ) {
        code = "EMAIL_ALREADY_EXISTS";
        message = "A user with this email address already exists.";
      }

      res.status(409).json({
        success: false,
        status: 409,
        error: {
          code,
          message,
          ...(req.id ? { requestId: req.id } : {}),
        },
      });
      return;
    }

    // 11. Unhandled internal error
    const rawMessage =
      err instanceof Error ? err.message : "Internal Server Error";
    logError(`${req.method} ${req.originalUrl}`, err, req);

    res.status(500).json({
      success: false,
      status: 500,
      error: isProduction ? "Internal Server Error" : rawMessage,
    });
  };
}

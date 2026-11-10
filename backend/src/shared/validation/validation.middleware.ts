import { Request, Response, NextFunction, RequestHandler } from "express";
import { z, ZodError } from "zod";
import { ValidationErrorDetail } from "./validation.types";

const FORBIDDEN_PRICE_FIELDS = new Set([
  "price",
  "pricePaise",
  "executionPricePaise",
  "bidPricePaise",
  "askPricePaise",
  "totalValuePaise",
]);

const SENSITIVE_FIELDS = new Set([
  "otp",
  "password",
  "token",
  "secret",
  "authorization",
  "refreshToken",
]);

export interface RequestValidationSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
}

/**
 * Escapes regex special characters to prevent ReDoS or unintended pattern matching.
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recursively inspects an object or array for prohibited NoSQL operator keys
 * (any key starting with '$' or containing '.').
 */
export function hasNoSqlInjectionKeys(val: unknown): boolean {
  if (!val || typeof val !== "object") {
    return false;
  }
  if (Array.isArray(val)) {
    return val.some(hasNoSqlInjectionKeys);
  }
  for (const key of Object.keys(val)) {
    if (key.startsWith("$") || key.includes(".")) {
      return true;
    }
    if (hasNoSqlInjectionKeys((val as Record<string, unknown>)[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Global middleware that inspects query, params, and body for raw MongoDB query injection.
 */
export const noSqlSanitizer: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (
    hasNoSqlInjectionKeys(req.query) ||
    hasNoSqlInjectionKeys(req.params) ||
    hasNoSqlInjectionKeys(req.body)
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST_PARAMETERS",
        message: "Malformed or prohibited query operators detected.",
      },
    });
    return;
  }
  next();
};

/**
 * Reusable schema validation middleware supporting body, query, params, and headers.
 */
export function validateRequest(schemas: RequestValidationSchemas): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Proactively check for client price injection on body
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      for (const key of Object.keys(req.body)) {
        if (FORBIDDEN_PRICE_FIELDS.has(key)) {
          res.status(400).json({
            success: false,
            error: {
              code: "CLIENT_PRICE_NOT_ALLOWED",
              message:
                "Client-supplied execution prices are not allowed. Market orders execute strictly at server-authoritative quotes.",
            },
          });
          return;
        }
      }
    }

    const details: ValidationErrorDetail[] = [];
    let specificErrorCode: string | null = null;

    // 2. Validate params
    if (schemas.params) {
      const result = await schemas.params.safeParseAsync(req.params);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path.join(".") || "params";
          details.push({
            field,
            message: issue.message,
          });
          if (field.toLowerCase().includes("instrumentid")) {
            specificErrorCode = "INVALID_INSTRUMENT_ID";
          } else if (field.toLowerCase().includes("accountid")) {
            specificErrorCode = "INVALID_ACCOUNT_ID";
          } else if (field.toLowerCase().includes("orderid")) {
            specificErrorCode = "INVALID_ORDER_ID";
          } else if (field.toLowerCase().includes("tradeid")) {
            specificErrorCode = "INVALID_TRADE_ID";
          }
        }
      } else {
        req.params = result.data as Record<string, string>;
      }
    }

    // 3. Validate query
    if (schemas.query) {
      const result = await schemas.query.safeParseAsync(req.query);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path.join(".") || "query";
          details.push({
            field,
            message: issue.message,
          });
          if (field.toLowerCase().includes("accountid")) {
            specificErrorCode = "INVALID_ACCOUNT_ID";
          } else if (field.toLowerCase().includes("instrumentid")) {
            specificErrorCode = "INVALID_INSTRUMENT_ID";
          }
        }
      } else {
        req.query = result.data as Record<string, any>;
      }
    }

    // 4. Validate headers
    if (schemas.headers) {
      const result = await schemas.headers.safeParseAsync(req.headers);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path.join(".") || "headers";
          details.push({
            field,
            message: issue.message,
          });
          if (field.toLowerCase().includes("idempotency")) {
            specificErrorCode = "INVALID_IDEMPOTENCY_KEY";
          }
        }
      }
    }

    // 5. Validate body
    if (schemas.body) {
      const result = await schemas.body.safeParseAsync(req.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path.join(".") || "body";
          // Sanitize error message to prevent leaking sensitive values
          let message = issue.message;
          if (SENSITIVE_FIELDS.has(field)) {
            message = "Invalid value for sensitive field.";
          }

          details.push({
            field,
            message,
          });

          if (!specificErrorCode) {
            if (field === "confirmation") {
              specificErrorCode = "CONFIRMATION_REQUIRED";
            } else if (field === "expectedActiveAccountId" || field === "practiceAccountId") {
              specificErrorCode = "INVALID_ACCOUNT_ID";
            } else if (field === "instrumentId") {
              specificErrorCode = "INVALID_INSTRUMENT_ID";
            } else if (field === "side") {
              specificErrorCode = "INVALID_ORDER_SIDE";
            } else if (field === "quantity") {
              specificErrorCode = "INVALID_QUANTITY";
            } else if (field === "instrumentIds") {
              specificErrorCode = "INVALID_REORDER_PAYLOAD";
            }
          }
        }
      } else {
        req.body = result.data;
      }
    }

    if (details.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: specificErrorCode ?? "VALIDATION_ERROR",
          message:
            details.length === 1
              ? details[0].message
              : "The request contains invalid fields.",
          details,
        },
      });
      return;
    }

    next();
  };
}

import { z } from "zod";
import { Types } from "mongoose";
import { parseMarketQueryDate } from "../../modules/market-candles/market-candle.utils";
import {
  DISPLAY_NAME_MAX_LENGTH,
  isValidDisplayName,
  sanitizeDisplayName,
} from "../../modules/users/user.schema";

export const OBJECT_ID_HEX_REGEX = /^[0-9a-fA-F]{24}$/;
export const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9_\-:.]{8,128}$/;
export const OTP_DIGITS_REGEX = /^\d{6}$/;

// ==========================================
// 1. CORE PRIMITIVE SCHEMAS
// ==========================================

/**
 * Validates a standard 24-character hexadecimal MongoDB ObjectId string.
 */
export const objectIdSchema = z
  .string()
  .trim()
  .refine(
    (val) => OBJECT_ID_HEX_REGEX.test(val) && Types.ObjectId.isValid(val),
    {
      message: "Identifier must be a valid 24-character hexadecimal ObjectId.",
    }
  );

/**
 * Validates an email address and converts to normalized lowercase.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3, "Email must be at least 3 characters.")
  .max(255, "Email cannot exceed 255 characters.")
  .email("Invalid email address format.")
  .transform((val) => val.toLowerCase());

/**
 * Validates a 6-digit numeric OTP code.
 */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(OTP_DIGITS_REGEX, "OTP must be exactly 6 numeric digits.");

/**
 * Validates an Idempotency-Key header value.
 */
export const idempotencyKeyHeaderSchema = z
  .string()
  .trim()
  .regex(
    IDEMPOTENCY_KEY_REGEX,
    "Idempotency-Key header is required and must be between 8 and 128 alphanumeric characters, hyphens, colons, dots, or underscores."
  );

/**
 * Validates header object containing idempotency-key.
 */
export const idempotencyKeyHeaderObjectSchema = z
  .object({
    "idempotency-key": idempotencyKeyHeaderSchema,
  })
  .passthrough();

/**
 * Validates a positive whole-share quantity.
 */
export const quantitySchema = z
  .number()
  .int("quantity must be a positive whole integer greater than zero.")
  .min(1, "quantity must be a positive whole integer greater than zero.")
  .max(Number.MAX_SAFE_INTEGER, "Quantity exceeds maximum safe integer limits.");

/**
 * Validates supported trading order sides.
 */
export const orderSideSchema = z.enum(["BUY", "SELL"] as const, {
  message: "side must be either 'BUY' or 'SELL'.",
});

/**
 * Validates supported order statuses.
 */
export const orderStatusSchema = z.enum(["RECEIVED", "EXECUTED", "REJECTED"] as const, {
  message: "status must be 'RECEIVED', 'EXECUTED', or 'REJECTED'.",
});

/**
 * Validates supported Indian stock exchanges.
 */
export const exchangeSchema = z.enum(["NSE", "BSE"] as const, {
  message: "exchange must be either 'NSE' or 'BSE'.",
});

/**
 * Validates safe pagination query parameters with defaults: page=1, limit=20 (max 100).
 */
export const paginationQuerySchema = z.object({
  page: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return 1;
    if (typeof val === "string") {
      const num = Number(val);
      return Number.isSafeInteger(num) ? num : NaN;
    }
    return val;
  }, z.number().int("Page must be an integer.").min(1, "Page must be greater than or equal to 1.").default(1)),
  limit: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return 20;
    if (typeof val === "string") {
      const num = Number(val);
      return Number.isSafeInteger(num) ? num : NaN;
    }
    return val;
  }, z.number().int("Limit must be an integer.").min(1, "Limit must be at least 1.").max(100, "Limit cannot exceed 100.").default(20)),
});

/**
 * Validates ISO 8601 date range queries with from <= to.
 */
export const dateRangeQuerySchema = z
  .object({
    from: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "from must be a valid ISO 8601 date string."
      ),
    to: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "to must be a valid ISO 8601 date string."
      ),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from).getTime() <= new Date(data.to).getTime();
      }
      return true;
    },
    {
      message: "from date must be earlier than or equal to to date.",
      path: ["from"],
    }
  );
/**
 * Safe search string schema (max 100 chars, trimmed).
 */
export const searchStringSchema = z
  .string()
  .trim()
  .max(100, "Search query cannot exceed 100 characters.")
  .optional();

// ==========================================
// 2. FEATURE ROUTE SCHEMAS
// ==========================================

// --- Auth Schemas ---
export const requestOtpBodySchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const signupConsentsSchema = z
  .object({
    acceptTerms: z.boolean(),
    acceptPrivacy: z.boolean(),
    acceptSimulationDisclosure: z.boolean(),
    termsVersion: z.string().trim().min(1).max(32).optional(),
    privacyVersion: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const displayNameSchema = z
  .string("Full name must be a valid text string.")
  .refine((val) => isValidDisplayName(val), {
    message: `Full name must be 2 to ${DISPLAY_NAME_MAX_LENGTH} characters, contain letters, and must not include control characters or email addresses.`,
  })
  .transform((val) => sanitizeDisplayName(val));

export const verifyOtpBodySchema = z
  .object({
    email: emailSchema,
    otp: otpCodeSchema,
    displayName: z.string().max(100).optional(),
    consents: signupConsentsSchema.optional(),
  })
  .strict();

export const updateUserProfileBodySchema = z
  .object({
    displayName: displayNameSchema,
  })
  .strict();

export const sessionIdParamsSchema = z.object({
  sessionId: objectIdSchema,
});

// --- Instruments Schemas ---
export const searchInstrumentsQuerySchema = z.object({
  search: searchStringSchema,
  q: searchStringSchema,
  exchange: exchangeSchema.optional(),
  isTradable: z.enum(["true", "false", "1", "0"] as const).optional(),
  page: paginationQuerySchema.shape.page,
  limit: paginationQuerySchema.shape.limit,
});

export const instrumentIdParamsSchema = z.object({
  instrumentId: objectIdSchema,
});

// --- Watchlist Schemas ---
export const addWatchlistItemBodySchema = z
  .object({
    instrumentId: objectIdSchema,
  })
  .strict();

export const reorderWatchlistBodySchema = z
  .object({
    instrumentIds: z
      .array(objectIdSchema)
      .min(1, "instrumentIds array must not be empty.")
      .max(50, "instrumentIds array cannot exceed 50 items."),
  })
  .strict();

// --- Order Schemas ---
export const createOrderBodySchema = z
  .object({
    instrumentId: objectIdSchema,
    side: orderSideSchema,
    quantity: quantitySchema,
    practiceAccountId: objectIdSchema.optional(),
  })
  .strict();

export const listOrdersQuerySchema = z.object({
  practiceAccountId: objectIdSchema.optional(),
  instrumentId: objectIdSchema.optional(),
  side: orderSideSchema.optional(),
  status: orderStatusSchema.optional(),
  page: paginationQuerySchema.shape.page,
  limit: paginationQuerySchema.shape.limit,
});

export const orderIdParamsSchema = z.object({
  orderId: objectIdSchema,
});

// --- Portfolio Schemas ---
export const portfolioQuerySchema = z.object({
  practiceAccountId: objectIdSchema.optional(),
});

// --- Trade Schemas ---
export const listTradesQuerySchema = z
  .object({
    practiceAccountId: objectIdSchema.optional(),
    instrumentId: objectIdSchema.optional(),
    side: orderSideSchema.optional(),
    from: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "from must be a valid ISO 8601 date string."
      ),
    to: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "to must be a valid ISO 8601 date string."
      ),
    page: paginationQuerySchema.shape.page,
    limit: paginationQuerySchema.shape.limit,
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from).getTime() <= new Date(data.to).getTime();
      }
      return true;
    },
    {
      message: "from date must be earlier than or equal to to date.",
      path: ["from"],
    }
  );
export const tradeIdParamsSchema = z.object({
  tradeId: objectIdSchema,
});

// --- Practice Account Schemas ---
export const accountIdParamsSchema = z.object({
  accountId: objectIdSchema,
});

export const listLedgerQuerySchema = z
  .object({
    entryType: z.string().optional(),
    direction: z.enum(["CREDIT", "DEBIT"] as const).optional(),
    from: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "from must be a valid ISO 8601 date string."
      ),
    to: z
      .string()
      .optional()
      .refine(
        (val) => !val || !Number.isNaN(new Date(val).getTime()),
        "to must be a valid ISO 8601 date string."
      ),
    page: paginationQuerySchema.shape.page,
    limit: paginationQuerySchema.shape.limit,
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from).getTime() <= new Date(data.to).getTime();
      }
      return true;
    },
    {
      message: "from date must be earlier than or equal to to date.",
      path: ["from"],
    }
  );
export const resetAccountBodySchema = z
  .object({
    confirmation: z.literal("RESET_PRACTICE_ACCOUNT", {
      message: "confirmation must strictly equal 'RESET_PRACTICE_ACCOUNT'.",
    }),
    expectedActiveAccountId: objectIdSchema,
  })
  .strict();

// --- Market Indices & Candles Schemas ---
export const candleIntervalSchema = z.enum(
  ["1m", "5m", "15m", "1h", "1d"] as const,
  {
    message: "interval must be one of: '1m', '5m', '15m', '1h', '1d'.",
  }
);

export const marketIndexSymbolParamsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Market index symbol is required.")
    .max(30, "Market index symbol cannot exceed 30 characters.")
    .transform((val) => val.toUpperCase().replace(/[\s_-]+/g, ""))
    .refine(
      (val) =>
        val === "NIFTY50" ||
        val === "NIFTY" ||
        val === "SENSEX" ||
        val === "BSESENSEX",
      {
        message:
          "Unsupported market index symbol. Supported symbols: NIFTY50, SENSEX.",
      }
    )
    .transform((val) =>
      val === "NIFTY" ? "NIFTY50" : val === "BSESENSEX" ? "SENSEX" : val
    ),
});

export const marketCandlesQuerySchema = z
  .object({
    interval: candleIntervalSchema.optional().default("1d"),
    from: z
      .string()
      .optional()
      .refine(
        (val) => !val || parseMarketQueryDate(val, "start") !== null,
        "from must be a valid ISO 8601 date or date-time string."
      ),
    to: z
      .string()
      .optional()
      .refine(
        (val) => !val || parseMarketQueryDate(val, "end") !== null,
        "to must be a valid ISO 8601 date or date-time string."
      ),
    limit: z.preprocess(
      (val) => {
        if (val === undefined || val === null || val === "") return 100;
        if (typeof val === "string") {
          const num = Number(val);
          return Number.isSafeInteger(num) ? num : NaN;
        }
        return val;
      },
      z
        .number()
        .int("Limit must be an integer.")
        .min(1, "Limit must be at least 1.")
        .max(500, "Limit cannot exceed 500.")
        .default(100)
    ),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        const parsedFrom = parseMarketQueryDate(data.from, "start");
        const parsedTo = parseMarketQueryDate(data.to, "end");
        if (!parsedFrom || !parsedTo) return false;
        return parsedFrom.getTime() <= parsedTo.getTime();
      }
      return true;
    },
    {
      message: "from date must be earlier than or equal to to date.",
      path: ["from"],
    }
  );

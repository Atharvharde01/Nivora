import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { HoldingsModel } from "./model/HoldingsModel";
import { PositionsModel } from "./model/PositionsModel";
import { OrdersModel } from "./model/OrdersModel";

// ==========================================
// 1. ENVIRONMENT & CONFIGURATION VALIDATION
// ==========================================
const rawPort = process.env.PORT || "3002";
const PORT = parseInt(String(rawPort), 10);

if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
  console.error(`FATAL: Invalid PORT specified: "${rawPort}". Must be an integer between 1 and 65535.`);
  process.exit(1);
}

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL || !MONGO_URL.trim()) {
  console.error("FATAL: MONGO_URL environment variable is missing or empty.");
  process.exit(1);
}
const validMongoUrl: string = MONGO_URL;

const isProduction = process.env.NODE_ENV === "production";

/**
 * Validates and normalizes an origin URL string using the WHATWG URL API.
 * Ensures the origin is an absolute URL with valid protocol and host,
 * and strips any trailing slashes, paths, query parameters, or hash fragments.
 *
 * @param urlString The raw URL string from environment variables.
 * @param varName The name of the environment variable (for logging without leaking value).
 * @param requireHttps If true, enforces protocol === 'https:' (required in production).
 * @returns An object indicating validity and the normalized origin, or an error description.
 */
function validateAndNormalizeOrigin(
  urlString: string | undefined,
  varName: string,
  requireHttps: boolean
): { valid: true; origin: string } | { valid: false; error: string } {
  if (!urlString || !urlString.trim()) {
    return { valid: false, error: `${varName} is missing or empty.` };
  }

  try {
    const parsed = new URL(urlString.trim());

    if (requireHttps && parsed.protocol !== "https:") {
      return {
        valid: false,
        error: `${varName} must use the HTTPS protocol in production (found "${parsed.protocol}").`,
      };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        valid: false,
        error: `${varName} must use HTTP or HTTPS protocol.`,
      };
    }

    if (!parsed.hostname) {
      return {
        valid: false,
        error: `${varName} must include a valid hostname.`,
      };
    }

    // Standardize to origin only (protocol + host/port, no path, search, or hash)
    return { valid: true, origin: parsed.origin };
  } catch {
    return {
      valid: false,
      error: `${varName} is a malformed URL.`,
    };
  }
}

// Production-specific configuration validation
let productionFrontendOrigin = "";
let productionDashboardOrigin = "";

if (isProduction) {
  const validationErrors: string[] = [];

  const feResult = validateAndNormalizeOrigin(
    process.env.FRONTEND_URL,
    "FRONTEND_URL",
    true // requireHttps in production
  );
  if (!feResult.valid) {
    validationErrors.push(feResult.error);
  } else {
    productionFrontendOrigin = feResult.origin;
  }

  const dashResult = validateAndNormalizeOrigin(
    process.env.DASHBOARD_URL,
    "DASHBOARD_URL",
    true // requireHttps in production
  );
  if (!dashResult.valid) {
    validationErrors.push(dashResult.error);
  } else {
    productionDashboardOrigin = dashResult.origin;
  }

  if (validationErrors.length > 0) {
    console.error("FATAL: Production configuration validation failed:");
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}

const app = express();

// ==========================================
// 2. SECURITY MIDDLEWARE & CORS
// ==========================================
// NOTE: Render Reverse Proxy & Trust Proxy Configuration (Deployment Blocker)
// Render traffic traverses Cloudflare edge servers and Render load balancers.
// The exact proxy hop count and header forwarding behavior (X-Forwarded-For,
// cf-connecting-ip, etc.) must be empirically verified on a live Render staging
// environment before enabling Express 'trust proxy'.
// Do NOT set trust proxy to true, 1, or 2 without live staging inspection.
// Accurate per-client IP rate limiting on Render remains dependent on this verification.

// Helmet for standard HTTP security headers
app.use(helmet());

// Environment-aware CORS allowlist
const allowedOrigins: string[] = [];

if (isProduction) {
  // Production permits ONLY explicitly verified HTTPS origins.
  // Localhost origins are STRICTLY FORBIDDEN in production.
  // Wildcards are NEVER used.
  allowedOrigins.push(productionFrontendOrigin, productionDashboardOrigin);
} else {
  // Development permits local frontend and dashboard ports
  allowedOrigins.push("http://localhost:3000", "http://localhost:3001");

  // Also include optional configured development URLs if provided and valid
  if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) {
    const feDev = validateAndNormalizeOrigin(process.env.FRONTEND_URL, "FRONTEND_URL", false);
    if (feDev.valid && !allowedOrigins.includes(feDev.origin)) {
      allowedOrigins.push(feDev.origin);
    }
  }

  if (process.env.DASHBOARD_URL && process.env.DASHBOARD_URL.trim()) {
    const dashDev = validateAndNormalizeOrigin(process.env.DASHBOARD_URL, "DASHBOARD_URL", false);
    if (dashDev.valid && !allowedOrigins.includes(dashDev.origin)) {
      allowedOrigins.push(dashDev.origin);
    }
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, UptimeRobot)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked: Origin ${origin} not permitted`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Global Rate Limiting (Health checks skipped)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "Too many requests, please try again later.",
  },
  skip: (req) => {
    // Crucial requirement: Ensure UptimeRobot and health checks are never rate-limited
    return req.path.startsWith("/health");
  },
});

app.use(apiLimiter);

// JSON Request Limit (10kb prevents large payload DoS)
app.use(bodyParser.json({ limit: "10kb" }));

// Helper to catch unhandled promise rejections in Express 4 routes
type AsyncRouteHandler = (req: Request<any, any, any, any>, res: Response, next: NextFunction) => Promise<any>;
const asyncHandler = (fn: AsyncRouteHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ==========================================
// 3. HEALTH CHECK ENDPOINTS (UPTIMEROBOT)
// ==========================================
// GET /health/live - Process liveness probe
app.get("/health/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
  });
});

// GET /health/ready - Database readiness probe
app.get(
  "/health/ready",
  asyncHandler(async (_req: Request, res: Response) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        status: "ERROR",
        database: "disconnected",
      });
    }
    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({
        status: "ERROR",
        database: "disconnected",
      });
    }
    await db.command({ ping: 1 });
    return res.status(200).json({
      status: "OK",
      database: "connected",
    });
  })
);

// GET /health - UptimeRobot 5-minute health check probe
app.get(
  "/health",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          status: "ERROR",
          database: "disconnected",
        });
      }
      const db = mongoose.connection.db;
      if (!db) {
        return res.status(503).json({
          status: "ERROR",
          database: "disconnected",
        });
      }
      await db.command({ ping: 1 });
      return res.status(200).json({
        status: "OK",
        database: "connected",
      });
    } catch {
      return res.status(503).json({
        status: "ERROR",
        database: "disconnected",
      });
    }
  })
);

// ==========================================
// 4. API ROUTES
// ==========================================

// app.get("/addHoldings", async (req, res) => {
//   let tempHoldings = [
//     {
//       name: "BHARTIARTL",
//       qty: 2,
//       avg: 538.05,
//       price: 541.15,
//       net: "+0.58%",
//       day: "+2.99%",
//     },
//     {
//       name: "HDFCBANK",
//       qty: 2,
//       avg: 1383.4,
//       price: 1522.35,
//       net: "+10.04%",
//       day: "+0.11%",
//     },
//     {
//       name: "HINDUNILVR",
//       qty: 1,
//       avg: 2335.85,
//       price: 2417.4,
//       net: "+3.49%",
//       day: "+0.21%",
//     },
//     {
//       name: "INFY",
//       qty: 1,
//       avg: 1350.5,
//       price: 1555.45,
//       net: "+15.18%",
//       day: "-1.60%",
//       isLoss: true,
//     },
//     {
//       name: "ITC",
//       qty: 5,
//       avg: 202.0,
//       price: 207.9,
//       net: "+2.92%",
//       day: "+0.80%",
//     },
//     {
//       name: "KPITTECH",
//       qty: 5,
//       avg: 250.3,
//       price: 266.45,
//       net: "+6.45%",
//       day: "+3.54%",
//     },
//     {
//       name: "M&M",
//       qty: 2,
//       avg: 809.9,
//       price: 779.8,
//       net: "-3.72%",
//       day: "-0.01%",
//       isLoss: true,
//     },
//     {
//       name: "RELIANCE",
//       qty: 1,
//       avg: 2193.7,
//       price: 2112.4,
//       net: "-3.71%",
//       day: "+1.44%",
//     },
//     {
//       name: "SBIN",
//       qty: 4,
//       avg: 324.35,
//       price: 430.2,
//       net: "+32.63%",
//       day: "-0.34%",
//       isLoss: true,
//     },
//     {
//       name: "SGBMAY29",
//       qty: 2,
//       avg: 4727.0,
//       price: 4719.0,
//       net: "-0.17%",
//       day: "+0.15%",
//     },
//     {
//       name: "TATAPOWER",
//       qty: 5,
//       avg: 104.2,
//       price: 124.15,
//       net: "+19.15%",
//       day: "-0.24%",
//       isLoss: true,
//     },
//     {
//       name: "TCS",
//       qty: 1,
//       avg: 3041.7,
//       price: 3194.8,
//       net: "+5.03%",
//       day: "-0.25%",
//       isLoss: true,
//     },
//     {
//       name: "WIPRO",
//       qty: 4,
//       avg: 489.3,
//       price: 577.75,
//       net: "+18.08%",
//       day: "+0.32%",
//     },
//   ];
// 
//   tempHoldings.forEach((item) => {
//     let newHolding = new HoldingsModel({
//       name: item.name,
//       qty: item.qty,
//       avg: item.avg,
//       price: item.price,
//       net: item.day,
//       day: item.day,
//     });
// 
//     newHolding.save();
//   });
//   res.send("Done!");
// });
// 
// app.get("/addPositions", async (req, res) => {
//   let tempPositions = [
//     {
//       product: "CNC",
//       name: "EVEREADY",
//       qty: 2,
//       avg: 316.27,
//       price: 312.35,
//       net: "-1.24%",
//       day: "-1.24%",
//       isLoss: true,
//     },
//     {
//       product: "CNC",
//       name: "JUBLFOOD",
//       qty: 1,
//       avg: 3124.75,
//       price: 3082.65,
//       net: "-1.35%",
//       day: "-1.35%",
//       isLoss: true,
//     },
//     {
//       product: "MIS",
//       name: "TATASTEEL",
//       qty: 10,
//       avg: 118.45,
//       price: 122.30,
//       net: "+3.25%",
//       day: "+3.25%",
//       isLoss: false,
//     },
//     {
//       product: "CNC",
//       name: "ADANIENT",
//       qty: 3,
//       avg: 2410.00,
//       price: 2285.60,
//       net: "-5.16%",
//       day: "-2.10%",
//       isLoss: true,
//     },
//     {
//       product: "MIS",
//       name: "NIFTY24OCTFUT",
//       qty: 1,
//       avg: 24580.00,
//       price: 24810.50,
//       net: "+0.94%",
//       day: "+0.94%",
//       isLoss: false,
//     },
//     {
//       product: "CNC",
//       name: "BAJFINANCE",
//       qty: 2,
//       avg: 6820.50,
//       price: 7104.75,
//       net: "+4.17%",
//       day: "+1.80%",
//       isLoss: false,
//     },
//     {
//       product: "MIS",
//       name: "ICICIBANK",
//       qty: 5,
//       avg: 980.20,
//       price: 963.45,
//       net: "-1.71%",
//       day: "-1.71%",
//       isLoss: true,
//     },
//     {
//       product: "CNC",
//       name: "SUNPHARMA",
//       qty: 4,
//       avg: 1245.00,
//       price: 1318.90,
//       net: "+5.93%",
//       day: "+0.65%",
//       isLoss: false,
//     },
//     {
//       product: "MIS",
//       name: "ONGC",
//       qty: 15,
//       avg: 188.30,
//       price: 183.75,
//       net: "-2.42%",
//       day: "-2.42%",
//       isLoss: true,
//     },
//     {
//       product: "CNC",
//       name: "LTIM",
//       qty: 1,
//       avg: 5360.00,
//       price: 5540.20,
//       net: "+3.36%",
//       day: "+0.90%",
//       isLoss: false,
//     },
//   ];
// 
//   tempPositions.forEach((item) => {
//     let newPosition = new PositionsModel({
//       product: item.product,
//       name: item.name,
//       qty: item.qty,
//       avg: item.avg,
//       price: item.price,
//       net: item.net,
//       day: item.day,
//       isLoss: item.isLoss,
//     });
// 
//     newPosition.save();
//   });
//   res.send("Done!");
// });
// 
// app.get("/addOrders", async (req, res) => {
//   let tempOrders = [
//     { name: "RELIANCE",    qty: 1,  price: 2112.40, mode: "BUY"  },
//     { name: "INFY",        qty: 2,  price: 1555.45, mode: "BUY"  },
//     { name: "TCS",         qty: 1,  price: 3194.80, mode: "SELL" },
//     { name: "HDFCBANK",    qty: 2,  price: 1522.35, mode: "BUY"  },
//     { name: "WIPRO",       qty: 4,  price: 577.75,  mode: "BUY"  },
//     { name: "SBIN",        qty: 5,  price: 430.20,  mode: "SELL" },
//     { name: "TATASTEEL",   qty: 10, price: 122.30,  mode: "BUY"  },
//     { name: "ADANIENT",    qty: 3,  price: 2285.60, mode: "SELL" },
//     { name: "BAJFINANCE",  qty: 2,  price: 7104.75, mode: "BUY"  },
//     { name: "ICICIBANK",   qty: 5,  price: 963.45,  mode: "SELL" },
//     { name: "SUNPHARMA",   qty: 4,  price: 1318.90, mode: "BUY"  },
//     { name: "ONGC",        qty: 15, price: 183.75,  mode: "SELL" },
//   ];
// 
//   tempOrders.forEach((item) => {
//     let newOrder = new OrdersModel({
//       name:  item.name,
//       qty:   item.qty,
//       price: item.price,
//       mode:  item.mode,
//     });
//     newOrder.save();
//   });
//   res.send("Done!");
// });

app.get(
  "/allHoldings",
  asyncHandler(async (_req: Request, res: Response) => {
    const allHoldings = await HoldingsModel.find({});
    res.json(allHoldings);
  })
);

app.get(
  "/allPositions",
  asyncHandler(async (_req: Request, res: Response) => {
    const allPositions = await PositionsModel.find({});
    res.json(allPositions);
  })
);

app.get(
  "/allOrders",
  asyncHandler(async (_req: Request, res: Response) => {
    const allOrders = await OrdersModel.find({});
    res.json(allOrders);
  })
);

interface NewOrderRequestBody {
  name: string;
  qty: number | string;
  price: number | string;
  mode: string;
}

app.post(
  "/newOrder",
  asyncHandler(async (req: Request<{}, {}, NewOrderRequestBody>, res: Response) => {
    const { name, qty, price, mode } = req.body;

    // Validate name
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        status: 400,
        error: "Validation error: 'name' must be a non-empty string",
      });
    }

    // Validate qty (must be positive number)
    const numericQty = typeof qty === "number" ? qty : parseFloat(String(qty));
    if (isNaN(numericQty) || numericQty <= 0) {
      return res.status(400).json({
        status: 400,
        error: "Validation error: 'qty' must be a positive number",
      });
    }

    // Validate price (must be positive or non-negative number)
    const numericPrice = typeof price === "number" ? price : parseFloat(String(price));
    if (isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        status: 400,
        error: "Validation error: 'price' must be a valid non-negative number",
      });
    }

    // Validate mode (case-insensitive BUY or SELL)
    if (!mode || typeof mode !== "string") {
      return res.status(400).json({
        status: 400,
        error: "Validation error: 'mode' is required",
      });
    }
    const normalizedMode = mode.trim().toUpperCase();
    if (normalizedMode !== "BUY" && normalizedMode !== "SELL") {
      return res.status(400).json({
        status: 400,
        error: "Validation error: 'mode' must be either 'BUY' or 'SELL'",
      });
    }

    const newOrder = new OrdersModel({
      name: name.trim(),
      qty: numericQty,
      price: numericPrice,
      mode: normalizedMode,
    });

    // Await persistence before responding
    await newOrder.save();

    // Preserve exact existing response contract
    res.status(201).send("Order saved!");
  })
);

// ==========================================
// 5. 404 NOT FOUND & ERROR HANDLING
// ==========================================
// 404 handler for undefined routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Express Error Handling Middleware (4 arguments required by Express)
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // CORS origin rejection
  if (err instanceof Error && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({
      status: 403,
      error: err.message,
    });
  }

  // Malformed JSON payload from body-parser
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      status: 400,
      error: "Malformed JSON payload",
    });
  }

  const isProduction = process.env.NODE_ENV === "production";
  const errorMessage = err instanceof Error ? err.message : "Internal Server Error";

  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, errorMessage);

  return res.status(500).json({
    status: 500,
    error: isProduction ? "Internal Server Error" : errorMessage,
  });
});

// ==========================================
// 6. ASYNC STARTUP & GRACEFUL SHUTDOWN
// ==========================================
let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(validMongoUrl);
    console.log("MongoDB connection established successfully.");

    server = app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("FATAL: Failed to connect to MongoDB:", err.message);
    } else {
      console.error("FATAL: Failed to connect to MongoDB:", err);
    }
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`Shutdown already in progress, ignoring duplicate ${signal}`);
    return;
  }
  isShuttingDown = true;
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    server.close(async (err) => {
      if (err) {
        console.error("Error closing HTTP server:", err.message);
      } else {
        console.log("HTTP server closed.");
      }

      try {
        await mongoose.disconnect();
        console.log("MongoDB disconnected cleanly.");
        process.exit(0);
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.error("Error disconnecting MongoDB:", msg);
        process.exit(1);
      }
    });

    // Force close if existing requests hang beyond 10s
    setTimeout(() => {
      console.error("Forced shutdown: requests did not terminate within timeout.");
      process.exit(1);
    }, 10000).unref();
  } else {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("message", (msg) => {
  if (msg === "shutdown" || msg === "SIGTERM" || msg === "SIGINT") {
    gracefulShutdown(String(msg));
  }
});

// Start server
startServer();

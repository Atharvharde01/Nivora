import express, { Express, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

export interface AppConfig {
  isProduction: boolean;
  allowedOrigins: readonly string[];
}

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

const asyncHandler = (fn: AsyncRouteHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const LEGACY_ENDPOINT_RETIRED_RESPONSE = {
  success: false,
  error: {
    code: "LEGACY_ENDPOINT_RETIRED",
    message: "This endpoint is no longer available.",
  },
} as const;

export function createApp(config: AppConfig): Express {
  const app = express();

  // ==========================================
  // 1. SECURITY MIDDLEWARE & CORS
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

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, UptimeRobot)
        if (!origin) {
          return callback(null, true);
        }
        if (config.allowedOrigins.includes(origin)) {
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

  // ==========================================
  // 2. HEALTH CHECK ENDPOINTS (UPTIMEROBOT)
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
  // 3. API ROUTES
  // ==========================================
  app.get("/allHoldings", (_req: Request, res: Response) => {
    res.status(410).json(LEGACY_ENDPOINT_RETIRED_RESPONSE);
  });

  app.get("/allPositions", (_req: Request, res: Response) => {
    res.status(410).json(LEGACY_ENDPOINT_RETIRED_RESPONSE);
  });

  app.get("/allOrders", (_req: Request, res: Response) => {
    res.status(410).json(LEGACY_ENDPOINT_RETIRED_RESPONSE);
  });

  app.post("/newOrder", (_req: Request, res: Response) => {
    res.status(410).json(LEGACY_ENDPOINT_RETIRED_RESPONSE);
  });

  // ==========================================
  // 4. 404 NOT FOUND & ERROR HANDLING
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

    const errorMessage = err instanceof Error ? err.message : "Internal Server Error";

    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, errorMessage);

    return res.status(500).json({
      status: 500,
      error: config.isProduction ? "Internal Server Error" : errorMessage,
    });
  });

  return app;
}


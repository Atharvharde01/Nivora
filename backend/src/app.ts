import express, { Express, Request, Response, NextFunction, Router } from "express";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import yaml from "yaml";
import swaggerUi from "swagger-ui-express";
import { noSqlSanitizer } from "./shared/validation/validation.middleware";
import {
  requestIdMiddleware,
  globalApiRateLimiter,
  logError,
} from "./shared/security";
import { centralErrorHandler } from "./shared/errors";

export interface AppConfig {
  isProduction: boolean;
  allowedOrigins: readonly string[];
  router?: Router;
  trustProxy?: boolean | number | string;
  enableSwagger?: boolean;
}

/**
 * Safely resolves and parses the OpenAPI specification document.
 */
export function loadOpenApiSpec(): {
  rawYaml: string;
  parsed: Record<string, unknown>;
} | null {
  const possiblePaths = [
    path.resolve(__dirname, "../docs/openapi.yaml"),
    path.resolve(__dirname, "../../docs/openapi.yaml"),
    path.resolve(process.cwd(), "docs/openapi.yaml"),
    path.resolve(process.cwd(), "backend/docs/openapi.yaml"),
  ];

  for (const candidatePath of possiblePaths) {
    if (fs.existsSync(candidatePath)) {
      try {
        const rawYaml = fs.readFileSync(candidatePath, "utf8");
        const parsed = yaml.parse(rawYaml) as Record<string, unknown>;
        return { rawYaml, parsed };
      } catch {
        // Continue searching alternative paths
      }
    }
  }

  return null;
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
  if (config.trustProxy !== undefined) {
    app.set("trust proxy", config.trustProxy);
  } else {
    app.set("trust proxy", false);
  }

  // Request correlation: X-Request-Id header propagation & req.id assignment
  app.use(requestIdMiddleware);

  // Helmet for HTTP security headers
  app.use(
    helmet({
      xContentTypeOptions: true,
      xFrameOptions: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, UptimeRobot, tests)
        if (!origin) {
          return callback(null, true);
        }
        if (config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked: Origin ${origin} not permitted`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-CSRF-Token",
        "Origin",
        "X-Request-Id",
      ],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
    })
  );

  // Global Rate Limiting (Health checks skipped)
  app.use(globalApiRateLimiter);

  // Cookie Parser for HttpOnly refresh tokens and CSRF double-submit cookies
  app.use(cookieParser());

  // JSON & URL-encoded Request Limits (10kb prevents large payload DoS)
  app.use(bodyParser.json({ limit: "10kb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "10kb" }));

  // Global NoSQL query injection sanitizer
  app.use(noSqlSanitizer);

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
  // 2.5 API DOCUMENTATION (SWAGGER UI & OPENAPI)
  // ==========================================
  const shouldEnableSwagger =
    config.enableSwagger ??
    (!config.isProduction || process.env.ENABLE_SWAGGER_UI === "true");

  if (shouldEnableSwagger) {
    const spec = loadOpenApiSpec();
    if (spec) {
      app.get("/docs/openapi.yaml", (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/yaml; charset=utf-8");
        res.status(200).send(spec.rawYaml);
      });

      app.get("/docs/openapi.json", (_req: Request, res: Response) => {
        res.status(200).json(spec.parsed);
      });

      const swaggerUiOpts: swaggerUi.SwaggerUiOptions = {
        customSiteTitle: "NIVORA API Documentation",
      };

      app.use(
        "/docs",
        (_req: Request, res: Response, next: NextFunction) => {
          res.removeHeader("Content-Security-Policy");
          next();
        },
        swaggerUi.serve,
        swaggerUi.setup(spec.parsed, swaggerUiOpts)
      );
    }
  }

  // ==========================================
  // 3. API ROUTES
  // ==========================================
  if (config.router) {
    app.use(config.router);
  }

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

  // Centralized Express Error Handling Middleware
  app.use(centralErrorHandler(config.isProduction));

  return app;
}

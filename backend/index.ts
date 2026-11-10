import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./src/app";

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

const app = createApp({
  isProduction,
  allowedOrigins,
});

// ==========================================
// 2. ASYNC STARTUP & GRACEFUL SHUTDOWN
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

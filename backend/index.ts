import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./src/app";
import {
  connectDatabase,
  DatabaseConnectionError,
} from "./src/config/database";
import { loadEnvConfig, EnvConfig } from "./src/config/env";

// ==========================================
// 1. ENVIRONMENT & CONFIGURATION VALIDATION
// ==========================================
let config: EnvConfig;
try {
  config = loadEnvConfig();
} catch (err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : "Environment configuration validation failed.";
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

const app = createApp({
  isProduction: config.isProduction,
  allowedOrigins: config.allowedOrigins,
});

// ==========================================
// 2. ASYNC STARTUP & GRACEFUL SHUTDOWN
// ==========================================
let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    console.log("Connecting to MongoDB...");
    await connectDatabase(config.mongoUrl, config.isProduction);
    console.log("MongoDB connection established successfully.");

    server = app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port} [${config.nodeEnv}]`);
    });
  } catch (err: unknown) {
    const category =
      err instanceof DatabaseConnectionError ? err.category : "UNKNOWN";
    console.error(`FATAL: MongoDB connection failed. Category: ${category}.`);
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
        console.error("Error closing HTTP server during shutdown.");
      } else {
        console.log("HTTP server closed.");
      }

      try {
        await mongoose.disconnect();
        console.log("MongoDB disconnected cleanly.");
        process.exit(0);
      } catch {
        console.error("Error disconnecting MongoDB during shutdown.");
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
      process.exit(0);
    } catch {
      console.error("Error disconnecting MongoDB during shutdown.");
      process.exit(1);
    }
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

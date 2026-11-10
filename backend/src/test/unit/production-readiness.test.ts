import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { loadEnvConfig, EnvConfigValidationError } from "../../config/env";
import { createApp } from "../../app";

describe("Task 34 — Production Deployment Readiness (Unit)", () => {
  it("rejects production configuration when secrets are shorter than 32 characters", () => {
    assert.throws(
      () => {
        loadEnvConfig({
          NODE_ENV: "production",
          MONGO_URL: "mongodb+srv://user:pass@cluster.mongodb.net/db",
          FRONTEND_URL: "https://app.nivora.in",
          DASHBOARD_URL: "https://dashboard.nivora.in",
          OTP_HMAC_SECRET: "short_secret", // < 32 chars
          BREVO_API_KEY: "xkeysib-test-key-valid",
          BREVO_SENDER_EMAIL: "noreply@nivora.in",
          JWT_ACCESS_SECRET: "short_jwt_secret", // < 32 chars
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof EnvConfigValidationError);
        assert.ok(err.errors.some((e) => e.includes("OTP_HMAC_SECRET")));
        assert.ok(err.errors.some((e) => e.includes("JWT_ACCESS_SECRET")));
        return true;
      }
    );
  });

  it("rejects production configuration with localhost URLs", () => {
    assert.throws(
      () => {
        loadEnvConfig({
          NODE_ENV: "production",
          MONGO_URL: "mongodb+srv://user:pass@cluster.mongodb.net/db",
          FRONTEND_URL: "http://localhost:3000", // localhost forbidden in production
          DASHBOARD_URL: "https://dashboard.nivora.in",
          OTP_HMAC_SECRET: "valid_production_otp_hmac_secret_32_chars_ok!",
          BREVO_API_KEY: "xkeysib-test-key-valid",
          BREVO_SENDER_EMAIL: "noreply@nivora.in",
          JWT_ACCESS_SECRET: "valid_production_jwt_access_secret_32_chars_ok!",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof EnvConfigValidationError);
        assert.ok(err.errors.some((e) => e.includes("FRONTEND_URL")));
        return true;
      }
    );
  });

  it("validates valid production configuration and defaults trustProxy to false", () => {
    const config = loadEnvConfig({
      NODE_ENV: "production",
      PORT: "3002",
      MONGO_URL: "mongodb+srv://user:pass@cluster.mongodb.net/db?retryWrites=true&w=majority",
      FRONTEND_URL: "https://app.nivora.in",
      DASHBOARD_URL: "https://dashboard.nivora.in",
      OTP_HMAC_SECRET: "valid_production_otp_hmac_secret_32_chars_ok!",
      BREVO_API_KEY: "xkeysib-test-key-valid",
      BREVO_SENDER_EMAIL: "noreply@nivora.in",
      BREVO_SENDER_NAME: "NIVORA",
      JWT_ACCESS_SECRET: "valid_production_jwt_access_secret_32_chars_ok!",
    });

    assert.equal(config.nodeEnv, "production");
    assert.equal(config.isProduction, true);
    assert.equal(config.port, 3002);
    assert.equal(config.trustProxy, false);
    assert.equal(config.allowedOrigins.length, 2);
    assert.ok(config.allowedOrigins.includes("https://app.nivora.in"));
  });

  it("verifies package.json production scripts for Render direct execution", () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    assert.ok(fs.existsSync(pkgPath));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    assert.equal(pkg.scripts.build, "tsc");
    assert.equal(pkg.scripts.start, "node dist/index.js");
  });

  it("verifies GitHub Actions CI workflow file exists and defines test, build, and audit", () => {
    const ciPath = path.resolve(process.cwd(), "../.github/workflows/ci.yml");
    assert.ok(fs.existsSync(ciPath), "CI workflow file does not exist");
    const ciContent = fs.readFileSync(ciPath, "utf8");

    assert.ok(ciContent.includes("npm run test:unit"));
    assert.ok(ciContent.includes("npm run test:integration"));
    assert.ok(ciContent.includes("npm run build"));
    assert.ok(ciContent.includes("npm audit"));
  });

  it("verifies deployment readiness runbook exists with reverse proxy blocker documentation", () => {
    const runbookPath = path.resolve(process.cwd(), "docs/deployment-readiness.md");
    assert.ok(fs.existsSync(runbookPath), "Deployment readiness runbook does not exist");
    const content = fs.readFileSync(runbookPath, "utf8");

    assert.ok(content.includes("Render Reverse Proxy & Cloudflare IP Resolution"));
    assert.ok(content.includes("TRUST_PROXY"));
    assert.ok(content.includes("__Host-refresh_token"));
    assert.ok(content.includes("Rollback Procedure"));
  });

  it("GET /health/live liveness probe responds with 200 and uptime without requiring DB", async () => {
    const app = createApp({
      isProduction: true,
      allowedOrigins: ["https://app.nivora.in"],
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const res = await fetch(`${baseUrl}/health/live`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, "OK");
      assert.ok(typeof json.uptime === "number");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

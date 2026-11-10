import assert from "node:assert/strict";
import { describe, it } from "node:test";
import http from "node:http";
import { createApp, loadOpenApiSpec } from "../../app";

describe("Task 33 — OpenAPI 3.1 Documentation & Swagger UI (Unit)", () => {
  it("successfully parses backend/docs/openapi.yaml without syntax errors", () => {
    const spec = loadOpenApiSpec();
    assert.ok(spec !== null, "OpenAPI spec could not be loaded");
    assert.ok(spec.rawYaml.length > 500);
    assert.equal(spec.parsed.openapi, "3.1.0");

    const info = spec.parsed.info as Record<string, unknown>;
    assert.equal(info.title, "NIVORA Stock Trading Simulation Platform API");
    assert.equal(info.version, "1.0.0");
  });

  it("covers all 24 required routes across Health, Auth, Instruments, Watchlist, Orders, Portfolio, and Accounts", () => {
    const spec = loadOpenApiSpec();
    assert.ok(spec !== null);
    const paths = spec.parsed.paths as Record<string, unknown>;

    const requiredPaths = [
      // Health Probes (3)
      "/health/live",
      "/health/ready",
      "/health",

      // Authentication (8)
      "/auth/otp/request",
      "/auth/otp/verify",
      "/auth/refresh",
      "/auth/logout",
      "/auth/me",
      "/auth/logout-all",
      "/auth/sessions",
      "/auth/sessions/{sessionId}",

      // Instruments & Quotes (3)
      "/api/v1/instruments",
      "/api/v1/instruments/{instrumentId}",
      "/api/v1/instruments/{instrumentId}/quote",

      // Watchlist (4)
      "/api/v1/watchlist",
      "/api/v1/watchlist/items",
      "/api/v1/watchlist/items/{instrumentId}",
      "/api/v1/watchlist/reorder",

      // Orders (2)
      "/api/v1/orders",
      "/api/v1/orders/{orderId}",

      // Trades & Portfolio (3)
      "/api/v1/trades",
      "/api/v1/trades/{tradeId}",
      "/api/v1/portfolio",

      // Practice Accounts & Cash Ledger (4)
      "/api/v1/accounts/active",
      "/api/v1/accounts/{accountId}",
      "/api/v1/accounts/{accountId}/ledger",
      "/api/v1/accounts/reset",
    ];

    for (const p of requiredPaths) {
      assert.ok(
        paths[p] !== undefined,
        `Path ${p} is missing from openapi.yaml`
      );
    }

    assert.ok(Object.keys(paths).length >= 24);
  });

  it("defines required security schemes and paise-based financial models", () => {
    const spec = loadOpenApiSpec();
    assert.ok(spec !== null);
    const components = spec.parsed.components as Record<string, any>;

    // Security Schemes
    assert.ok(components.securitySchemes.bearerAuth);
    assert.ok(components.securitySchemes.cookieAuth);
    assert.ok(components.securitySchemes.csrfHeader);

    // Schemas
    const schemas = components.schemas;
    assert.ok(schemas.User);
    assert.ok(schemas.Session);
    assert.ok(schemas.Instrument);
    assert.ok(schemas.Quote);
    assert.ok(schemas.Order);
    assert.ok(schemas.Trade);
    assert.ok(schemas.Holding);
    assert.ok(schemas.PortfolioPosition);
    assert.ok(schemas.PortfolioSummary);
    assert.ok(schemas.PracticeAccount);
    assert.ok(schemas.LedgerEntry);

    // Verify Integer Paise documentation
    assert.equal(schemas.Quote.properties.bidPricePaise.type, "integer");
    assert.equal(schemas.Quote.properties.askPricePaise.type, "integer");
    assert.equal(schemas.Order.properties.executionPricePaise.type, "integer");
    assert.equal(schemas.Trade.properties.totalValuePaise.type, "integer");
    assert.equal(schemas.Holding.properties.averageBuyPricePaise.type, "integer");
    assert.equal(schemas.PracticeAccount.properties.cashBalancePaise.type, "integer");
    assert.equal(schemas.LedgerEntry.properties.amountPaise.type, "integer");
  });

  it("serves openapi.yaml, openapi.json, and Swagger UI when enableSwagger is true", async () => {
    const app = createApp({
      isProduction: false,
      allowedOrigins: ["http://localhost:3000"],
      enableSwagger: true,
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. GET /docs/openapi.yaml
      const yamlRes = await fetch(`${baseUrl}/docs/openapi.yaml`);
      assert.equal(yamlRes.status, 200);
      assert.ok(yamlRes.headers.get("content-type")?.includes("yaml"));
      const yamlText = await yamlRes.text();
      assert.ok(yamlText.includes("openapi: 3.1.0"));

      // 2. GET /docs/openapi.json
      const jsonRes = await fetch(`${baseUrl}/docs/openapi.json`);
      assert.equal(jsonRes.status, 200);
      const json = await jsonRes.json();
      assert.equal(json.openapi, "3.1.0");

      // 3. GET /docs/ (Swagger UI HTML)
      const uiRes = await fetch(`${baseUrl}/docs/`);
      assert.equal(uiRes.status, 200);
      const html = await uiRes.text();
      assert.ok(html.includes("swagger-ui") || html.includes("SwaggerUIBundle"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns 404 for /docs and specification endpoints when enableSwagger is false", async () => {
    const app = createApp({
      isProduction: true,
      allowedOrigins: ["http://localhost:3000"],
      enableSwagger: false,
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const res = await fetch(`${baseUrl}/docs/openapi.yaml`);
      assert.equal(res.status, 404);

      const uiRes = await fetch(`${baseUrl}/docs/`);
      assert.equal(uiRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import {
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
  clearDatabase,
} from "./test-db-harness";
import { runDatabaseInitialization, REGISTERED_NIVORA_MODELS } from "../../../scripts/db-init";

describe("Milestone 2 — Database Initialization & Non-Destructive Indexes (Integration)", () => {
  let originalMongoUrl: string | undefined;

  before(async () => {
    originalMongoUrl = process.env.MONGO_URL;
    delete process.env.MONGO_URL;
    await setupIntegrationTestDb();
    await clearDatabase();
  });

  after(async () => {
    if (originalMongoUrl) {
      process.env.MONGO_URL = originalMongoUrl;
    }
    await teardownIntegrationTestDb();
  });

  it("safely initializes all 11 collections and declared indexes on an empty database", async () => {
    // Construct test URI targeting database 'Nivora' on the active test replica set
    const currentUri = mongoose.connection.getClient().options.srvHost || (mongoose.connection as any)._connectionString;
    const testNivoraUri = new URL(currentUri);
    testNivoraUri.pathname = "/Nivora";

    // Disconnect default connection so runDatabaseInitialization connects fresh
    await mongoose.disconnect();

    const result = await runDatabaseInitialization({
      config: {
        nodeEnv: "development",
        isProduction: false,
        port: 5000,
        mongoUrl: testNivoraUri.toString(),
        frontendUrl: "http://localhost:3000",
        dashboardUrl: "http://localhost:3001",
        allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
        otpSecret: "secret32charsminimum_1234567890!",
        brevoApiKey: "mock-key",
        brevoSenderEmail: "noreply@nivora.in",
        brevoSenderName: "NIVORA",
        jwtAccessSecret: "secret32charsminimum_1234567890!",
        jwtIssuer: "nivora-api",
        jwtAudience: "nivora-client",
      },
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(result.databaseName, "Nivora");
    assert.equal(result.transactionsSupported, true);
    assert.equal(result.totalCollectionsCount, 11);
    assert.equal(result.collectionsCreatedCount, 11);
    assert.equal(result.collectionsPreservedCount, 0);

    // Verify all 11 collections exist and have document count 0
    for (const report of result.collectionReports) {
      assert.equal(report.documentCount, 0, `Collection ${report.collectionName} must have 0 documents`);
      assert.ok(report.indexes.length >= 2, `Collection ${report.collectionName} must have at least _id_ + 1 declared index`);
      assert.ok(
        report.indexes.some((i) => i.name === "_id_"),
        `Collection ${report.collectionName} must have default _id_ index`
      );
    }

    // Now re-run initialization to verify idempotency (preserves all existing collections and indexes)
    const idempotentResult = await runDatabaseInitialization({
      config: {
        nodeEnv: "development",
        isProduction: false,
        port: 5000,
        mongoUrl: testNivoraUri.toString(),
        frontendUrl: "http://localhost:3000",
        dashboardUrl: "http://localhost:3001",
        allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
        otpSecret: "secret32charsminimum_1234567890!",
        brevoApiKey: "mock-key",
        brevoSenderEmail: "noreply@nivora.in",
        brevoSenderName: "NIVORA",
        jwtAccessSecret: "secret32charsminimum_1234567890!",
        jwtIssuer: "nivora-api",
        jwtAudience: "nivora-client",
      },
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(idempotentResult.collectionsCreatedCount, 0, "Second run should create 0 new collections");
    assert.equal(idempotentResult.collectionsPreservedCount, 11, "Second run should preserve all 11 collections");

    // Clean up connection
    await mongoose.disconnect();
  });
});

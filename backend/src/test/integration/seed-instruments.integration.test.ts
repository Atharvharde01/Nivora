import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { connectDatabase } from "../../config/database";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { UserModel } from "../../modules/users/user.model";
import {
  clearDatabase,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { runDatabaseInitialization } from "../../../scripts/db-init";
import { runInstrumentSeed } from "../../../scripts/seed-instruments";

describe("Milestone 3 — Idempotent NSE Instrument Seeding (Integration)", () => {
  let originalMongoUrl: string | undefined;
  let testNivoraUri: string;

  before(async () => {
    originalMongoUrl = process.env.MONGO_URL;
    delete process.env.MONGO_URL;
    await setupIntegrationTestDb();
    await clearDatabase();

    const currentUri =
      mongoose.connection.getClient().options.srvHost ||
      (mongoose.connection as unknown as { _connectionString: string })._connectionString;
    const parsedUrl = new URL(currentUri);
    parsedUrl.pathname = "/Nivora";
    testNivoraUri = parsedUrl.toString();

    await mongoose.disconnect();

    // Initialize collections & indexes on the isolated test replica set
    await runDatabaseInitialization({
      config: {
        nodeEnv: "development",
        isProduction: false,
        port: 5000,
        mongoUrl: testNivoraUri,
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

    // Ensure Nivora.instruments starts empty for this suite
    await connectDatabase(testNivoraUri, false);
    await InstrumentModel.deleteMany({});
    await UserModel.deleteMany({});
    await mongoose.disconnect();
  });

  after(async () => {
    if (originalMongoUrl) {
      process.env.MONGO_URL = originalMongoUrl;
    }
    await teardownIntegrationTestDb();
  });

  const buildTestEnvConfig = () => ({
    nodeEnv: "development" as const,
    isProduction: false,
    port: 5000,
    mongoUrl: testNivoraUri,
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
  });

  it("performs zero database writes in dry-run mode and reports 50 new instruments", async () => {
    const dryRunResult = await runInstrumentSeed({
      mode: "dry-run",
      config: buildTestEnvConfig(),
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(dryRunResult.mode, "dry-run");
    assert.equal(dryRunResult.catalogValid, true);
    assert.equal(dryRunResult.totalCatalogCount, 50);
    assert.equal(dryRunResult.starterWatchlistCount, 15);
    assert.equal(dryRunResult.wouldInsertCount, 50);
    assert.equal(dryRunResult.existingCount, 0);
    assert.equal(dryRunResult.insertedCount, 0);
    assert.equal(dryRunResult.finalCollectionDocumentCount, 0);
  });

  it("inserts all 50 instruments in apply mode and preserves modified prices on idempotent re-runs", async () => {
    // Create a user to verify user records are never touched during seeding
    await connectDatabase(testNivoraUri, false);
    const createdUser = await UserModel.create({
      email: "seed.isolation.test@nivora.app",
      status: "ACTIVE",
      onboardingCompleted: true,
    });
    await mongoose.disconnect();

    const seedTime = new Date("2026-11-16T09:15:00.000Z");

    // First apply run: inserts all 50 instruments
    const firstApply = await runInstrumentSeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      priceUpdatedAt: seedTime,
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(firstApply.mode, "apply");
    assert.equal(firstApply.insertedCount, 50);
    assert.equal(firstApply.skippedCount, 0);
    assert.equal(firstApply.finalCollectionDocumentCount, 50);

    // Simulate market engine updating RELIANCE price in the database
    const simulatedTickTime = new Date("2026-11-16T10:30:00.000Z");
    await connectDatabase(testNivoraUri, false);
    await InstrumentModel.updateOne(
      { exchange: "NSE", symbol: "RELIANCE" },
      {
        $set: {
          lastPricePaise: 261500,
          bidPricePaise: 261450,
          askPricePaise: 261550,
          previousClosePaise: 254000,
          priceUpdatedAt: simulatedTickTime,
        },
      }
    );
    await mongoose.disconnect();

    // Second apply run: must skip all 50 existing instruments and NOT overwrite RELIANCE's simulated price
    const secondApply = await runInstrumentSeed({
      mode: "apply",
      config: buildTestEnvConfig(),
      priceUpdatedAt: new Date("2026-11-16T11:00:00.000Z"),
      requireStrictRole: false,
      verbose: false,
    });

    assert.equal(secondApply.insertedCount, 0);
    assert.equal(secondApply.skippedCount, 50);
    assert.equal(secondApply.existingCount, 50);
    assert.equal(secondApply.finalCollectionDocumentCount, 50);

    // Verify RELIANCE retained its simulated market-engine price and user record is untouched
    await connectDatabase(testNivoraUri, false);
    const reliance = await InstrumentModel.findOne({
      exchange: "NSE",
      symbol: "RELIANCE",
    }).lean();
    assert.ok(reliance, "RELIANCE must exist");
    assert.equal(
      reliance.lastPricePaise,
      261500,
      "Seed script must never overwrite existing simulated prices"
    );
    assert.equal(reliance.bidPricePaise, 261450);
    assert.equal(reliance.askPricePaise, 261550);
    assert.equal(
      reliance.priceUpdatedAt.getTime(),
      simulatedTickTime.getTime(),
      "Seed script must never overwrite existing priceUpdatedAt timestamp"
    );

    const starterCountInDb = await InstrumentModel.countDocuments({
      isStarterWatchlist: true,
    });
    assert.equal(starterCountInDb, 15);

    const persistedUser = await UserModel.findById(createdUser._id).lean();
    assert.ok(persistedUser, "User record must remain completely untouched");
    assert.equal(persistedUser.email, "seed.isolation.test@nivora.app");

    // Clean up test data before teardown
    await InstrumentModel.deleteMany({});
    await UserModel.deleteMany({});
    await mongoose.disconnect();
  });
});

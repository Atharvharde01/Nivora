import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REGISTERED_NIVORA_MODELS,
  runDatabaseInitialization,
} from "../../../scripts/db-init";

describe("Milestone 2 — Database Initialization & Model Inventory (Unit)", () => {
  it("registers exactly 11 NIVORA Mongoose models with expected collection names", () => {
    assert.equal(
      REGISTERED_NIVORA_MODELS.length,
      11,
      "Expected exactly 11 registered NIVORA models"
    );

    const expectedMap: Record<string, string> = {
      User: "users",
      OtpChallenge: "otp_challenges",
      Session: "sessions",
      RefreshToken: "refresh_tokens",
      PracticeAccount: "practice_accounts",
      Instrument: "instruments",
      WatchlistItem: "watchlist_items",
      Order: "orders",
      Trade: "trades",
      Holding: "holdings",
      LedgerEntry: "ledger_entries",
    };

    for (const reg of REGISTERED_NIVORA_MODELS) {
      const expectedCol = expectedMap[reg.modelName];
      assert.ok(expectedCol, `Unexpected model registered: ${reg.modelName}`);
      assert.equal(
        reg.collectionName,
        expectedCol,
        `Model ${reg.modelName} collection name mismatch`
      );
      assert.equal(
        reg.model.collection.name,
        expectedCol,
        `Model ${reg.modelName} underlying Mongoose collection mismatch`
      );
    }
  });

  it("verifies declared indexes on all 11 models match financial and safety specifications", () => {
    const modelIndexCountMap: Record<string, number> = {};
    for (const reg of REGISTERED_NIVORA_MODELS) {
      const indexes = reg.model.schema.indexes();
      modelIndexCountMap[reg.modelName] = indexes.length;
      assert.ok(
        indexes.length >= 1,
        `Model ${reg.modelName} must define at least 1 schema index`
      );
    }

    // Verify key unique constraints
    // 1. User: unique email
    const userModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "User")!.model;
    const userIndexes = userModel.schema.indexes();
    assert.ok(
      userIndexes.some(([k, opt]) => k.email === 1 && opt?.unique === true),
      "User model must define unique index on email"
    );

    // 2. PracticeAccount: one active per user (partial unique)
    const accountModel = REGISTERED_NIVORA_MODELS.find(
      (m) => m.modelName === "PracticeAccount"
    )!.model;
    const accountIndexes = accountModel.schema.indexes();
    assert.ok(
      accountIndexes.some(
        ([k, opt]) =>
          k.userId === 1 &&
          opt?.unique === true &&
          opt?.partialFilterExpression?.status === "ACTIVE"
      ),
      "PracticeAccount model must define partial unique index for one active account per user"
    );

    // 3. Instrument: unique exchange + symbol
    const instrModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "Instrument")!.model;
    const instrIndexes = instrModel.schema.indexes();
    assert.ok(
      instrIndexes.some(([k, opt]) => k.exchange === 1 && k.symbol === 1 && opt?.unique === true),
      "Instrument model must define unique compound index on exchange + symbol"
    );

    // 4. Order: unique idempotencyKey per practiceAccountId
    const orderModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "Order")!.model;
    const orderIndexes = orderModel.schema.indexes();
    assert.ok(
      orderIndexes.some(
        ([k, opt]) => k.practiceAccountId === 1 && k.idempotencyKey === 1 && opt?.unique === true
      ),
      "Order model must define unique idempotency key index per practice account"
    );

    // 5. Trade: unique orderId
    const tradeModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "Trade")!.model;
    const tradeIndexes = tradeModel.schema.indexes();
    assert.ok(
      tradeIndexes.some(([k, opt]) => k.orderId === 1 && opt?.unique === true),
      "Trade model must define unique 1-to-1 index on orderId"
    );

    // 6. Holding: unique practiceAccountId + instrumentId
    const holdingModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "Holding")!.model;
    const holdingIndexes = holdingModel.schema.indexes();
    assert.ok(
      holdingIndexes.some(
        ([k, opt]) => k.practiceAccountId === 1 && k.instrumentId === 1 && opt?.unique === true
      ),
      "Holding model must define unique compound index on practiceAccountId + instrumentId"
    );

    // 7. LedgerEntry: unique practiceAccountId + idempotencyKey
    const ledgerModel = REGISTERED_NIVORA_MODELS.find((m) => m.modelName === "LedgerEntry")!.model;
    const ledgerIndexes = ledgerModel.schema.indexes();
    assert.ok(
      ledgerIndexes.some(
        ([k, opt]) => k.practiceAccountId === 1 && k.idempotencyKey === 1 && opt?.unique === true
      ),
      "LedgerEntry model must define unique idempotency key index per practice account"
    );
  });

  it("safety check: rejects execution if target database is not Nivora or NODE_ENV is production", async () => {
    // 1. Test NODE_ENV !== development
    await assert.rejects(
      async () => {
        await runDatabaseInitialization({
          config: {
            nodeEnv: "production",
            isProduction: true,
            port: 5000,
            mongoUrl: "mongodb+srv://user:pass@cluster.mongodb.net/Nivora?retryWrites=true&w=majority",
            frontendUrl: "https://app.nivora.in",
            dashboardUrl: "https://dashboard.nivora.in",
            allowedOrigins: ["https://app.nivora.in", "https://dashboard.nivora.in"],
            otpSecret: "secret32charsminimum_1234567890!",
            brevoApiKey: "mock-key",
            brevoSenderEmail: "noreply@nivora.in",
            brevoSenderName: "NIVORA",
            jwtAccessSecret: "secret32charsminimum_1234567890!",
            jwtIssuer: "nivora-api",
            jwtAudience: "nivora-client",
          },
          verbose: false,
        });
      },
      {
        message: /NODE_ENV must be 'development'/,
      }
    );

    // 2. Test database in MONGO_URL !== Nivora
    await assert.rejects(
      async () => {
        await runDatabaseInitialization({
          config: {
            nodeEnv: "development",
            isProduction: false,
            port: 5000,
            mongoUrl: "mongodb+srv://user:pass@cluster.mongodb.net/zerodha?retryWrites=true&w=majority",
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
          verbose: false,
        });
      },
      {
        message: /MONGO_URL database path must be exactly '\/Nivora'/,
      }
    );
  });
});

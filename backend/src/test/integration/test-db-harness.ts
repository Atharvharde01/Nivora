import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose, { ClientSession, Schema, Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { HoldingModel } from "../../modules/holdings/holding.model";
import { IHolding } from "../../modules/holdings/holding.types";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { IInstrument } from "../../modules/instruments/instrument.types";
import { LedgerEntryModel } from "../../modules/ledger/ledger.model";
import { ILedgerEntry } from "../../modules/ledger/ledger.types";
import { OrderModel } from "../../modules/orders/order.model";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import { DEFAULT_INITIAL_BALANCE_PAISE } from "../../modules/practice-accounts/account.schema";
import { IPracticeAccount } from "../../modules/practice-accounts/account.types";
import { TradeModel } from "../../modules/trades/trade.model";
import { UserModel } from "../../modules/users/user.model";
import { IUser } from "../../modules/users/user.types";
import { WatchlistItemModel } from "../../modules/watchlist/watchlist.model";
import { OtpChallengeModel } from "../../modules/auth/otp-challenge.model";
import { SessionModel } from "../../modules/auth/session.model";
import { RefreshTokenModel } from "../../modules/auth/refresh-token.model";

const DEFAULT_WINDOWS_MONGOD_PATH =
  "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";

let activeReplSet: MongoMemoryReplSet | null = null;
let activeTestUri: string | null = null;

const TransactionVerificationSchema = new Schema(
  {
    testKey: { type: String, required: true },
    committed: { type: Boolean, required: true },
  },
  { collection: "__transaction_verification__" }
);

const TransactionVerificationModel = mongoose.model(
  "TransactionVerification",
  TransactionVerificationSchema
);

/**
 * Strict database safety guard.
 * Rejects production environment and verifies safe test connection targets.
 */
export function assertSafeTestEnvironment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL SAFETY VIOLATION: Integration tests cannot run when NODE_ENV is 'production'!"
    );
  }

  const configuredMongoUrl = process.env.MONGO_URL;
  if (
    configuredMongoUrl &&
    !configuredMongoUrl.includes("test") &&
    !configuredMongoUrl.includes("localhost") &&
    !configuredMongoUrl.includes("127.0.0.1")
  ) {
    throw new Error(
      "FATAL SAFETY VIOLATION: Existing MONGO_URL points to a non-local or non-test database! Tests must run against an isolated test replica set."
    );
  }
}

/**
 * Verifies that the connected MongoDB server is a replica set and actively supports
 * starting, committing, and aborting multi-document transactions.
 */
export async function verifyTransactionCapability(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Cannot verify transaction capability: database connection is not open.");
  }

  // 1. Verify replica-set status from server hello / isMaster command
  const helloResult = (await db.admin().command({ hello: 1 })) as Record<
    string,
    unknown
  >;
  const setName = helloResult.setName;
  const isReplicaSet =
    Boolean(setName) || helloResult.isreplicaset === true || helloResult.msg === "isdbgrid";

  if (!isReplicaSet) {
    throw new Error(
      "MongoDB transaction verification failed: connected instance is a standalone server and does not support transactions."
    );
  }

  // 2. Verify a real transaction can start and commit
  const commitSession: ClientSession = await mongoose.startSession();
  try {
    commitSession.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    await TransactionVerificationModel.create(
      [
        {
          testKey: "commit-probe",
          committed: true,
        },
      ],
      { session: commitSession }
    );

    await commitSession.commitTransaction();
  } catch (err: unknown) {
    if (commitSession.inTransaction()) {
      await commitSession.abortTransaction();
    }
    throw new Error(
      `MongoDB transaction verification failed on commit: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await commitSession.endSession();
  }

  const committedDoc = await TransactionVerificationModel.findOne({
    testKey: "commit-probe",
  }).lean();
  assert.ok(
    committedDoc,
    "Committed transaction document was not found in database."
  );

  // 3. Verify a real transaction can start and abort with zero persistent writes
  const abortSession: ClientSession = await mongoose.startSession();
  try {
    abortSession.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    await TransactionVerificationModel.create(
      [
        {
          testKey: "abort-probe",
          committed: false,
        },
      ],
      { session: abortSession }
    );

    await abortSession.abortTransaction();
  } catch (err: unknown) {
    throw new Error(
      `MongoDB transaction verification failed on abort: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await abortSession.endSession();
  }

  const abortedDoc = await TransactionVerificationModel.findOne({
    testKey: "abort-probe",
  }).lean();
  assert.equal(
    abortedDoc,
    null,
    "Aborted transaction document unexpectedly persisted in database."
  );

  // Clean up probe verification documents
  await TransactionVerificationModel.deleteMany({});
}

/**
 * Initializes an isolated MongoDB replica set and connects Mongoose with test database settings.
 */
export async function setupIntegrationTestDb(): Promise<string> {
  assertSafeTestEnvironment();

  if (mongoose.connection.readyState === 1 && activeTestUri) {
    return activeTestUri;
  }

  const testDbName = `nivora_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (process.env.TEST_MONGO_URI) {
    activeTestUri = process.env.TEST_MONGO_URI;
  } else if (!activeReplSet) {
    const hasWindowsMongod = fs.existsSync(DEFAULT_WINDOWS_MONGOD_PATH);
    activeReplSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
      binary: hasWindowsMongod
        ? {
            version: "8.2.1",
            systemBinary: DEFAULT_WINDOWS_MONGOD_PATH,
          }
        : undefined,
    });
    activeTestUri = activeReplSet.getUri();
  }

  if (!activeTestUri) {
    throw new Error("Failed to determine safe test replica-set URI.");
  }

  await mongoose.connect(activeTestUri, {
    dbName: testDbName,
    autoIndex: true,
    autoCreate: true,
    serverSelectionTimeoutMS: 10_000,
  });

  // Pre-create all collections so ACID transactions never race with implicit namespace creation
  await Promise.all([
    UserModel.createCollection(),
    PracticeAccountModel.createCollection(),
    InstrumentModel.createCollection(),
    HoldingModel.createCollection(),
    OrderModel.createCollection(),
    TradeModel.createCollection(),
    LedgerEntryModel.createCollection(),
    WatchlistItemModel.createCollection(),
    TransactionVerificationModel.createCollection(),
    OtpChallengeModel.createCollection(),
    SessionModel.createCollection(),
    RefreshTokenModel.createCollection(),
  ]);

  await verifyTransactionCapability();
  return activeTestUri;
}

/**
 * Clears all test collections in the current test database.
 */
export async function clearDatabase(): Promise<void> {
  assertSafeTestEnvironment();
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  await Promise.all([
    UserModel.deleteMany({}),
    PracticeAccountModel.deleteMany({}),
    InstrumentModel.deleteMany({}),
    HoldingModel.deleteMany({}),
    OrderModel.deleteMany({}),
    TradeModel.deleteMany({}),
    LedgerEntryModel.deleteMany({}),
    WatchlistItemModel.deleteMany({}),
    TransactionVerificationModel.deleteMany({}),
    OtpChallengeModel.deleteMany({}),
    SessionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ]);
}

/**
 * Cleanly closes the Mongoose connection and stops the temporary in-memory replica set.
 */
export async function teardownIntegrationTestDb(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await clearDatabase();
      await mongoose.connection.close(false);
    }
  } finally {
    if (activeReplSet) {
      const set = activeReplSet;
      activeReplSet = null;
      activeTestUri = null;
      await set.stop({ doCleanup: true, force: true });
    }
  }
}

/**
 * Test fixture helper: creates an active user in the database.
 */
export async function createTestUser(overrides: Partial<IUser> = {}): Promise<IUser & { _id: Types.ObjectId }> {
  const emailSuffix = Math.random().toString(36).substring(2, 8);
  const doc = new UserModel({
    email: `trader.${emailSuffix}@nivora.test`,
    displayName: "Integration Test Trader",
    status: "ACTIVE",
    ...overrides,
  });
  const saved = await doc.save();
  return saved.toObject() as unknown as IUser & { _id: Types.ObjectId };
}

/**
 * Test fixture helper: creates a tradable instrument in the database.
 */
export async function createTestInstrument(
  overrides: Partial<IInstrument> = {}
): Promise<IInstrument & { _id: Types.ObjectId }> {
  const symbolSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const doc = new InstrumentModel({
    symbol: `TEST${symbolSuffix}`,
    name: `Test Instrument ${symbolSuffix}`,
    exchange: "NSE",
    isTradable: true,
    lastPricePaise: 250_000,
    bidPricePaise: 249_950,
    askPricePaise: 250_050,
    previousClosePaise: 248_000,
    isStarterWatchlist: false,
    priceUpdatedAt: new Date(),
    ...overrides,
  });
  const saved = await doc.save();
  return saved.toObject() as unknown as IInstrument & { _id: Types.ObjectId };
}

/**
 * Test fixture helper: creates an active practice account in the database
 * with its corresponding initial funding ledger entry.
 */
export async function createTestAccount(
  userId: Types.ObjectId,
  overrides: Partial<IPracticeAccount> = {}
): Promise<IPracticeAccount & { _id: Types.ObjectId }> {
  const initialBalance =
    overrides.initialBalancePaise ?? DEFAULT_INITIAL_BALANCE_PAISE;
  const cashBalance = overrides.cashBalancePaise ?? initialBalance;

  const doc = new PracticeAccountModel({
    userId,
    accountNumber: 1,
    status: "ACTIVE",
    initialBalancePaise: initialBalance,
    cashBalancePaise: cashBalance,
    version: 1,
    ...overrides,
  });
  const savedAccount = await doc.save();

  const ledgerDoc = new LedgerEntryModel({
    userId,
    practiceAccountId: savedAccount._id,
    entryType: "INITIAL_FUNDING",
    direction: "CREDIT",
    amountPaise: initialBalance,
    balanceBeforePaise: 0,
    balanceAfterPaise: initialBalance,
    referenceType: "PRACTICE_ACCOUNT",
    referenceId: savedAccount._id,
    idempotencyKey: `INITIAL_FUNDING:${savedAccount._id.toString()}`,
    description: `Initial funding for test account #${savedAccount.accountNumber}`,
  });
  await ledgerDoc.save();

  return savedAccount.toObject() as unknown as IPracticeAccount & {
    _id: Types.ObjectId;
  };
}

/**
 * Test fixture helper: creates an existing holding in the database.
 */
export async function createTestHolding(
  userId: Types.ObjectId,
  practiceAccountId: Types.ObjectId,
  instrumentId: Types.ObjectId,
  overrides: Partial<IHolding> = {}
): Promise<IHolding & { _id: Types.ObjectId }> {
  const doc = new HoldingModel({
    userId,
    practiceAccountId,
    instrumentId,
    symbol: "TEST",
    exchange: "NSE",
    quantity: 10,
    averageBuyPricePaise: 250_050,
    totalInvestedPaise: 2_500_500,
    realizedPnlPaise: 0,
    version: 1,
    ...overrides,
  });
  const saved = await doc.save();
  return saved.toObject() as unknown as IHolding & { _id: Types.ObjectId };
}

import dotenv from "dotenv";
import mongoose, { Model } from "mongoose";
import { connectDatabase, DatabaseConnectionError } from "../src/config/database";
import { loadEnvConfig, EnvConfig } from "../src/config/env";

import { UserModel, USER_COLLECTION_NAME, USER_MODEL_NAME } from "../src/modules/users/user.model";
import { OtpChallengeModel, OTP_CHALLENGE_COLLECTION_NAME, OTP_CHALLENGE_MODEL_NAME } from "../src/modules/auth/otp-challenge.model";
import { SessionModel, SESSION_COLLECTION_NAME, SESSION_MODEL_NAME } from "../src/modules/auth/session.model";
import { RefreshTokenModel, REFRESH_TOKEN_COLLECTION_NAME, REFRESH_TOKEN_MODEL_NAME } from "../src/modules/auth/refresh-token.model";
import { PracticeAccountModel, PRACTICE_ACCOUNT_COLLECTION_NAME, PRACTICE_ACCOUNT_MODEL_NAME } from "../src/modules/practice-accounts/account.model";
import { InstrumentModel, INSTRUMENT_COLLECTION_NAME, INSTRUMENT_MODEL_NAME } from "../src/modules/instruments/instrument.model";
import { WatchlistItemModel, WATCHLIST_ITEM_COLLECTION_NAME, WATCHLIST_ITEM_MODEL_NAME } from "../src/modules/watchlist/watchlist.model";
import { OrderModel, ORDER_COLLECTION_NAME, ORDER_MODEL_NAME } from "../src/modules/orders/order.model";
import { TradeModel, TRADE_COLLECTION_NAME, TRADE_MODEL_NAME } from "../src/modules/trades/trade.model";
import { HoldingModel, HOLDING_COLLECTION_NAME, HOLDING_MODEL_NAME } from "../src/modules/holdings/holding.model";
import { LedgerEntryModel, LEDGER_ENTRY_COLLECTION_NAME, LEDGER_ENTRY_MODEL_NAME } from "../src/modules/ledger/ledger.model";

export interface ModelRegistration {
  readonly modelName: string;
  readonly collectionName: string;
  readonly model: Model<any>;
}

export const REGISTERED_NIVORA_MODELS: readonly ModelRegistration[] = Object.freeze([
  { modelName: USER_MODEL_NAME, collectionName: USER_COLLECTION_NAME, model: UserModel },
  { modelName: OTP_CHALLENGE_MODEL_NAME, collectionName: OTP_CHALLENGE_COLLECTION_NAME, model: OtpChallengeModel },
  { modelName: SESSION_MODEL_NAME, collectionName: SESSION_COLLECTION_NAME, model: SessionModel },
  { modelName: REFRESH_TOKEN_MODEL_NAME, collectionName: REFRESH_TOKEN_COLLECTION_NAME, model: RefreshTokenModel },
  { modelName: PRACTICE_ACCOUNT_MODEL_NAME, collectionName: PRACTICE_ACCOUNT_COLLECTION_NAME, model: PracticeAccountModel },
  { modelName: INSTRUMENT_MODEL_NAME, collectionName: INSTRUMENT_COLLECTION_NAME, model: InstrumentModel },
  { modelName: WATCHLIST_ITEM_MODEL_NAME, collectionName: WATCHLIST_ITEM_COLLECTION_NAME, model: WatchlistItemModel },
  { modelName: ORDER_MODEL_NAME, collectionName: ORDER_COLLECTION_NAME, model: OrderModel },
  { modelName: TRADE_MODEL_NAME, collectionName: TRADE_COLLECTION_NAME, model: TradeModel },
  { modelName: HOLDING_MODEL_NAME, collectionName: HOLDING_COLLECTION_NAME, model: HoldingModel },
  { modelName: LEDGER_ENTRY_MODEL_NAME, collectionName: LEDGER_ENTRY_COLLECTION_NAME, model: LedgerEntryModel },
]);

export interface IndexAuditInfo {
  readonly name: string;
  readonly key: Record<string, unknown>;
  readonly unique?: boolean;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly expireAfterSeconds?: number;
}

export interface CollectionAuditReport {
  readonly modelName: string;
  readonly collectionName: string;
  readonly wasCreated: boolean;
  readonly documentCount: number;
  readonly indexes: readonly IndexAuditInfo[];
}

export interface DbInitResult {
  readonly databaseName: string;
  readonly nodeEnv: string;
  readonly serverVersion: string;
  readonly topology: string;
  readonly replicaSetName: string | null;
  readonly isWritablePrimary: boolean;
  readonly transactionsSupported: boolean;
  readonly authenticatedUser: string;
  readonly authenticatedRoles: readonly string[];
  readonly collectionsCreatedCount: number;
  readonly collectionsPreservedCount: number;
  readonly totalCollectionsCount: number;
  readonly collectionReports: readonly CollectionAuditReport[];
}

export async function runDatabaseInitialization(options: {
  config?: EnvConfig;
  requireStrictRole?: boolean;
  verbose?: boolean;
} = {}): Promise<DbInitResult> {
  const requireStrictRole = options.requireStrictRole ?? true;
  const verbose = options.verbose ?? true;

  const log = (msg: string) => {
    if (verbose) console.log(msg);
  };

  log("================================================================================");
  log("NIVORA — DATABASE INITIALIZATION (MILESTONE 2: COLLECTIONS & INDEXES)");
  log("================================================================================");

  // 1. SAFE CONFIGURATION & TARGET VERIFICATION
  let config: EnvConfig;
  if (options.config) {
    config = options.config;
  } else {
    try {
      config = loadEnvConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Config validation failed.";
      throw new Error(`PREFLIGHT_CONFIG_FAILED: ${message}`);
    }
  }

  if (config.nodeEnv !== "development") {
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: NODE_ENV must be 'development'. Current value: '${config.nodeEnv}'. Production initialization requires explicit migration runbooks.`
    );
  }

  const url = new URL(config.mongoUrl);
  const targetDbFromUri = url.pathname.replace(/^\//, "");
  if (targetDbFromUri !== "Nivora") {
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: MONGO_URL database path must be exactly '/Nivora'. Got: '/${targetDbFromUri}'.`
    );
  }

  log("Connecting to MongoDB Atlas...");
  // Use hardened options with autoIndex: false and autoCreate: false during connection
  let conn: typeof mongoose;
  try {
    conn = await connectDatabase(config.mongoUrl, true);
  } catch (err: unknown) {
    const category = err instanceof DatabaseConnectionError ? err.category : "UNKNOWN";
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DATABASE_CONNECTION_FAILED [${category}]: ${msg}`);
  }

  const db = conn.connection.db;
  if (!db) {
    throw new Error("FATAL: MongoDB database handle is undefined after connect.");
  }

  // 2. DATABASE NAME & ISOLATION CHECKS
  const activeDbName = db.databaseName;
  if (activeDbName !== "Nivora") {
    await mongoose.disconnect();
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: Active database is '${activeDbName}', expected strictly 'Nivora'.`
    );
  }

  if (activeDbName.toLowerCase() === "zerodha" || activeDbName.toLowerCase() === "test") {
    await mongoose.disconnect();
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: Active database is '${activeDbName}'. Legacy or temporary test databases must not be used.`
    );
  }

  log(`Connected to active database: '${activeDbName}'`);

  // 3. SERVER TOPOLOGY & TRANSACTION CHECKS
  const admin = db.admin();
  let serverVersion = "unknown";
  try {
    const buildInfo = await admin.command({ buildInfo: 1 });
    serverVersion = buildInfo.version;
  } catch {
    serverVersion = "restricted";
  }

  const hello = await db.command({ hello: 1 });
  const topology = hello.setName ? "replicaSet" : hello.msg === "isdbgrid" ? "sharded" : "standalone";
  const replicaSetName = hello.setName ?? null;
  const isWritablePrimary = Boolean(hello.isWritablePrimary);
  const transactionsSupported =
    Boolean(hello.setName) && (hello.maxWireVersion ?? 0) >= 7 && hello.logicalSessionTimeoutMinutes != null;

  log(`MongoDB Version: ${serverVersion} | Topology: ${topology} (setName: ${replicaSetName})`);
  log(`Primary Writable: ${isWritablePrimary} | ACID Transactions: ${transactionsSupported ? "SUPPORTED" : "NOT SUPPORTED"}`);

  if (!isWritablePrimary) {
    await mongoose.disconnect();
    throw new Error("PREFLIGHT_TARGET_SAFETY_FAILED: Connected node is not a writable primary.");
  }

  if (!transactionsSupported) {
    await mongoose.disconnect();
    throw new Error(
      "PREFLIGHT_TARGET_SAFETY_FAILED: MongoDB deployment does not support multi-document ACID transactions."
    );
  }

  // 4. DATABASE USER PERMISSION PREFLIGHT
  let authenticatedUser = "unknown";
  let authenticatedRoles: string[] = [];
  try {
    const connStatus = await db.command({ connectionStatus: 1, showPrivileges: true });
    const users = connStatus.authInfo?.authenticatedUsers ?? [];
    const roles = connStatus.authInfo?.authenticatedUserRoles ?? [];
    authenticatedUser = users.map((u: any) => u.user).join(", ") || "unknown";
    authenticatedRoles = roles.map((r: any) => `${r.role}@${r.db}`);
  } catch (err: unknown) {
    log("Warning: connectionStatus command restricted.");
  }

  log(`Authenticated User: ${authenticatedUser} | Roles: [${authenticatedRoles.join(", ")}]`);

  if (requireStrictRole) {
    // Check if role is strictly readWrite on Nivora
    const hasStrictNivoraRole = authenticatedRoles.some(
      (r) => r === "readWrite@Nivora" || r === "readWrite@admin"
    );
    const hasAdminOrBroadRole = authenticatedRoles.some(
      (r) => r.includes("admin") || r.includes("AnyDatabase") || r.includes("root")
    );

    if (hasAdminOrBroadRole || !hasStrictNivoraRole) {
      // If user has readWriteAnyDatabase or atlasAdmin, warn or enforce based on requirements
      if (hasAdminOrBroadRole && !authenticatedRoles.includes("readWrite@Nivora")) {
        await mongoose.disconnect();
        throw new Error(
          `PREFLIGHT_PERMISSION_CHECK_FAILED: The database user role is [${authenticatedRoles.join(
            ", "
          )}]. The required application role is strictly 'readWrite@Nivora'. Please update the user permissions in MongoDB Atlas before proceeding.`
        );
      }
    }
  }

  // 5. INSPECT EXISTING COLLECTIONS
  const existingCollectionsList = await db.listCollections({}, { nameOnly: false }).toArray();
  const existingCollectionNames = new Set(existingCollectionsList.map((c) => c.name));
  log(`Existing collections found: [${Array.from(existingCollectionNames).join(", ") || "none"}]`);

  // 6. IDEMPOTENT COLLECTION INITIALIZATION
  log("\n--- Initializing Application Collections (Idempotent) ---");
  const collectionReports: CollectionAuditReport[] = [];
  let collectionsCreatedCount = 0;
  let collectionsPreservedCount = 0;

  for (const reg of REGISTERED_NIVORA_MODELS) {
    const colName = reg.collectionName;
    let wasCreated = false;

    if (existingCollectionNames.has(colName)) {
      log(`  ✓ Collection '${colName}' already exists. Preserving.`);
      collectionsPreservedCount++;
    } else {
      try {
        await db.createCollection(colName);
        log(`  + Created collection '${colName}'.`);
        wasCreated = true;
        collectionsCreatedCount++;
      } catch (err: unknown) {
        // Handle NamespaceExists safely if created concurrently
        const codeName = (err as any)?.codeName;
        if (codeName === "NamespaceExists" || (err as any)?.code === 48) {
          log(`  ✓ Collection '${colName}' already exists (NamespaceExists). Preserved.`);
          collectionsPreservedCount++;
        } else {
          await mongoose.disconnect();
          throw err;
        }
      }
    }

    // 7. NON-DESTRUCTIVE INDEX INITIALIZATION
    // Call Model.createIndexes() - strictly non-destructive (never syncIndexes)
    log(`    Creating schema indexes for model '${reg.modelName}' on '${colName}'...`);
    try {
      await reg.model.createIndexes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await mongoose.disconnect();
      throw new Error(`INDEX_CREATION_FAILED for ${reg.modelName} on ${colName}: ${msg}`);
    }

    // Read back final indexes from the live collection
    const liveCol = db.collection(colName);
    const count = await liveCol.countDocuments({});
    const liveIndexes = await liveCol.indexes();

    const formattedIndexes: IndexAuditInfo[] = liveIndexes.map((idx: any) => ({
      name: idx.name,
      key: idx.key,
      unique: Boolean(idx.unique),
      partialFilterExpression: idx.partialFilterExpression,
      expireAfterSeconds: idx.expireAfterSeconds,
    }));

    collectionReports.push({
      modelName: reg.modelName,
      collectionName: colName,
      wasCreated,
      documentCount: count,
      indexes: formattedIndexes,
    });
  }

  log("\n--- Collection & Index Initialization Complete ---");
  log(`Total Models/Collections: ${REGISTERED_NIVORA_MODELS.length}`);
  log(`Collections Created: ${collectionsCreatedCount}`);
  log(`Collections Preserved: ${collectionsPreservedCount}`);

  await mongoose.disconnect();
  log("MongoDB connection closed cleanly.\n");

  return {
    databaseName: activeDbName,
    nodeEnv: config.nodeEnv,
    serverVersion,
    topology,
    replicaSetName,
    isWritablePrimary,
    transactionsSupported,
    authenticatedUser,
    authenticatedRoles,
    collectionsCreatedCount,
    collectionsPreservedCount,
    totalCollectionsCount: REGISTERED_NIVORA_MODELS.length,
    collectionReports,
  };
}

// Self-executing runner when executed directly via tsx / node
if (
  process.argv[1] &&
  !process.argv[1].includes(".test.") &&
  (process.argv[1].endsWith("db-init.ts") || process.argv[1].endsWith("db-init.js"))
) {
  dotenv.config();
  runDatabaseInitialization()
    .then((result) => {
      console.log("FINAL INITIALIZATION SUMMARY:");
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("\nFATAL: Database initialization failed:");
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

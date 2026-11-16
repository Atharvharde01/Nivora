import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDatabase, DatabaseConnectionError } from "../src/config/database";
import { loadEnvConfig, EnvConfig } from "../src/config/env";
import { InstrumentModel } from "../src/modules/instruments/instrument.model";
import {
  isPositiveSafeIntegerPaise,
  isValidInstrumentName,
  isValidInstrumentSymbol,
} from "../src/modules/instruments/instrument.schema";
import {
  buildNseInstrumentSeedCatalog,
  INSTRUMENT_SECTOR_METADATA,
  InstrumentSeedRecord,
  SYNTHETIC_NSE_INSTRUMENTS_SEED,
} from "./data/instruments.seed";

export type SeedExecutionMode = "dry-run" | "apply";

export interface CatalogValidationReport {
  readonly valid: boolean;
  readonly totalCount: number;
  readonly starterWatchlistCount: number;
  readonly uniqueExchangeSymbolCount: number;
  readonly sectorBreakdown: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
}

export interface InstrumentSeedSummaryItem {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly sector: string;
  readonly lastPricePaise: number;
  readonly lastPriceRupees: string;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly previousClosePaise: number;
  readonly isStarterWatchlist: boolean;
  readonly status: "WOULD_INSERT" | "EXISTING_SKIP" | "INSERTED" | "SKIPPED";
}

export interface SeedInstrumentsResult {
  readonly mode: SeedExecutionMode;
  readonly databaseName: string;
  readonly nodeEnv: string;
  readonly catalogValid: boolean;
  readonly totalCatalogCount: number;
  readonly starterWatchlistCount: number;
  readonly wouldInsertCount: number;
  readonly existingCount: number;
  readonly insertedCount: number;
  readonly skippedCount: number;
  readonly finalCollectionDocumentCount: number;
  readonly insertedSymbols: readonly string[];
  readonly skippedSymbols: readonly string[];
  readonly items: readonly InstrumentSeedSummaryItem[];
}

/**
 * Formats integer paise into a human-readable Rupee string (e.g., 254000 -> "₹2,540.00").
 */
export function formatPaiseToRupees(paise: number): string {
  const rupees = (paise / 100).toFixed(2);
  const [whole, fraction] = rupees.split(".");
  const lastThree = whole.slice(-3);
  const otherNumbers = whole.slice(0, -3);
  const formattedWhole =
    otherNumbers !== ""
      ? otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree
      : lastThree;
  return `₹${formattedWhole}.${fraction}`;
}

/**
 * Validates the complete instrument seed catalog in memory against all schema,
 * uniqueness, and financial invariants before any database operation.
 */
export function validateInstrumentCatalog(
  catalog: readonly InstrumentSeedRecord[] = SYNTHETIC_NSE_INSTRUMENTS_SEED
): CatalogValidationReport {
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const sectorCounts: Record<string, number> = {};
  let starterCount = 0;

  if (!Array.isArray(catalog) || catalog.length === 0) {
    errors.push("Instrument seed catalog must be a non-empty array.");
  }

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i];
    const prefix = `Catalog[${i}] (${item?.symbol ?? "UNKNOWN"})`;

    if (!item || typeof item !== "object") {
      errors.push(`${prefix}: Entry must be an object.`);
      continue;
    }

    if (!isValidInstrumentSymbol(item.symbol)) {
      errors.push(`${prefix}: Invalid symbol '${String(item.symbol)}'.`);
    }

    if (!isValidInstrumentName(item.name)) {
      errors.push(`${prefix}: Invalid company name '${String(item.name)}'.`);
    }

    if (item.exchange !== "NSE") {
      errors.push(
        `${prefix}: Expected exchange 'NSE' for initial catalog, got '${String(item.exchange)}'.`
      );
    }

    const compositeKey = `${item.exchange}:${item.symbol}`;
    if (seenKeys.has(compositeKey)) {
      errors.push(`${prefix}: Duplicate exchange/symbol pair '${compositeKey}'.`);
    } else {
      seenKeys.add(compositeKey);
    }

    if (typeof item.isTradable !== "boolean") {
      errors.push(`${prefix}: isTradable must be a boolean.`);
    }

    if (!isPositiveSafeIntegerPaise(item.lastPricePaise)) {
      errors.push(
        `${prefix}: lastPricePaise (${String(item.lastPricePaise)}) must be a positive safe integer.`
      );
    }

    if (!isPositiveSafeIntegerPaise(item.bidPricePaise)) {
      errors.push(
        `${prefix}: bidPricePaise (${String(item.bidPricePaise)}) must be a positive safe integer.`
      );
    }

    if (!isPositiveSafeIntegerPaise(item.askPricePaise)) {
      errors.push(
        `${prefix}: askPricePaise (${String(item.askPricePaise)}) must be a positive safe integer.`
      );
    }

    if (
      isPositiveSafeIntegerPaise(item.bidPricePaise) &&
      isPositiveSafeIntegerPaise(item.askPricePaise) &&
      item.bidPricePaise > item.askPricePaise
    ) {
      errors.push(
        `${prefix}: bidPricePaise (${item.bidPricePaise}) must not exceed askPricePaise (${item.askPricePaise}).`
      );
    }

    if (!isPositiveSafeIntegerPaise(item.previousClosePaise)) {
      errors.push(
        `${prefix}: previousClosePaise (${String(item.previousClosePaise)}) must be a positive safe integer.`
      );
    }

    if (typeof item.isStarterWatchlist !== "boolean") {
      errors.push(`${prefix}: isStarterWatchlist must be a boolean.`);
    } else if (item.isStarterWatchlist) {
      starterCount++;
    }

    if (
      !(item.priceUpdatedAt instanceof Date) ||
      Number.isNaN(item.priceUpdatedAt.getTime())
    ) {
      errors.push(`${prefix}: priceUpdatedAt must be a valid Date instance.`);
    }

    // Validate against the actual Mongoose InstrumentModel schema (enforces strict: "throw")
    try {
      const doc = new InstrumentModel(item);
      const validationError = doc.validateSync();
      if (validationError) {
        errors.push(`${prefix}: Mongoose validation failed: ${validationError.message}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${prefix}: Mongoose strict construction failed: ${msg}`);
    }

    const sector = INSTRUMENT_SECTOR_METADATA[item.symbol] ?? "Uncategorized";
    sectorCounts[sector] = (sectorCounts[sector] ?? 0) + 1;
  }

  return Object.freeze({
    valid: errors.length === 0,
    totalCount: catalog.length,
    starterWatchlistCount: starterCount,
    uniqueExchangeSymbolCount: seenKeys.size,
    sectorBreakdown: Object.freeze({ ...sectorCounts }),
    errors: Object.freeze(errors),
  });
}

/**
 * Parses CLI arguments to determine whether to run in `--dry-run` (default) or `--apply` mode.
 */
export function parseSeedCliArgs(argv: readonly string[]): SeedExecutionMode {
  const hasDryRun = argv.includes("--dry-run");
  const hasApply = argv.includes("--apply");

  if (hasDryRun && hasApply) {
    throw new Error(
      "INVALID_CLI_ARGS: Cannot specify both '--dry-run' and '--apply' simultaneously."
    );
  }

  if (hasApply) {
    return "apply";
  }

  return "dry-run";
}

/**
 * Executes the synthetic NSE instrument catalog seed or dry-run verification.
 *
 * Safety Invariants:
 * - Default mode is `dry-run` (performs zero database writes).
 * - Requires `NODE_ENV === "development"` and target database `Nivora`.
 * - Rejects `production`, `zerodha`, or `test` databases.
 * - In `apply` mode, uses `$setOnInsert` with `{ upsert: true }` on `{ exchange, symbol }`.
 * - Never overwrites existing instruments or their simulated prices.
 * - Never deletes documents, collections, or indexes.
 */
export async function runInstrumentSeed(options: {
  mode?: SeedExecutionMode;
  config?: EnvConfig;
  catalog?: readonly InstrumentSeedRecord[];
  priceUpdatedAt?: Date;
  requireStrictRole?: boolean;
  verbose?: boolean;
} = {}): Promise<SeedInstrumentsResult> {
  const mode: SeedExecutionMode = options.mode ?? "dry-run";
  const requireStrictRole = options.requireStrictRole ?? true;
  const verbose = options.verbose ?? true;
  const effectivePriceUpdatedAt = options.priceUpdatedAt ?? new Date();

  const log = (msg: string) => {
    if (verbose) console.log(msg);
  };

  log("================================================================================");
  log(
    `NIVORA — SYNTHETIC NSE INSTRUMENT SEED (${
      mode === "dry-run" ? "DRY-RUN MODE — NO WRITES" : "APPLY MODE — IDEMPOTENT UPSERT"
    })`
  );
  log("================================================================================");

  // 1. VALIDATE CATALOG IN MEMORY FIRST
  const catalogToUse =
    options.catalog ?? buildNseInstrumentSeedCatalog(effectivePriceUpdatedAt);
  const validationReport = validateInstrumentCatalog(catalogToUse);

  if (!validationReport.valid) {
    throw new Error(
      `CATALOG_VALIDATION_FAILED:\n  - ${validationReport.errors.join("\n  - ")}`
    );
  }

  log(
    `Catalog validation passed: ${validationReport.totalCount} NSE instruments (${validationReport.starterWatchlistCount} starter watchlist).`
  );

  // 2. LOAD & VALIDATE ENVIRONMENT CONFIGURATION
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
      `PREFLIGHT_TARGET_SAFETY_FAILED: NODE_ENV must be 'development'. Current value: '${config.nodeEnv}'.`
    );
  }

  const url = new URL(config.mongoUrl);
  const targetDbFromUri = url.pathname.replace(/^\//, "");
  if (targetDbFromUri !== "Nivora") {
    throw new Error(
      `PREFLIGHT_TARGET_SAFETY_FAILED: MONGO_URL database path must be exactly '/Nivora'. Got: '/${targetDbFromUri}'.`
    );
  }

  // 3. CONNECT WITH AUTOINDEX=FALSE & AUTOCREATE=FALSE
  log("Connecting to MongoDB...");
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
    await mongoose.disconnect();
    throw new Error("FATAL: MongoDB database handle is undefined after connect.");
  }

  try {
    const activeDbName = db.databaseName;
    if (activeDbName !== "Nivora") {
      throw new Error(
        `PREFLIGHT_TARGET_SAFETY_FAILED: Active database is '${activeDbName}', expected strictly 'Nivora'.`
      );
    }

    if (
      activeDbName.toLowerCase() === "zerodha" ||
      activeDbName.toLowerCase() === "test"
    ) {
      throw new Error(
        `PREFLIGHT_TARGET_SAFETY_FAILED: Active database '${activeDbName}' is forbidden.`
      );
    }

    // 4. VERIFY REPLICA SET & PERMISSIONS
    const hello = await db.command({ hello: 1 });
    const isWritablePrimary = Boolean(hello.isWritablePrimary);
    const transactionsSupported =
      Boolean(hello.setName) &&
      (hello.maxWireVersion ?? 0) >= 7 &&
      hello.logicalSessionTimeoutMinutes != null;

    if (!isWritablePrimary || !transactionsSupported) {
      throw new Error(
        "PREFLIGHT_TARGET_SAFETY_FAILED: Connected MongoDB cluster must be a writable replica-set primary supporting transactions."
      );
    }

    if (requireStrictRole) {
      const connStatus = await db.command({
        connectionStatus: 1,
        showPrivileges: true,
      });
      const roles = (connStatus.authInfo?.authenticatedUserRoles ?? []).map(
        (r: { role: string; db: string }) => `${r.role}@${r.db}`
      );
      const hasStrictNivoraRole = roles.includes("readWrite@Nivora");
      const hasBroadAdminRole = roles.some(
        (r: string) =>
          r.includes("admin") || r.includes("AnyDatabase") || r.includes("root")
      );

      if (!hasStrictNivoraRole || hasBroadAdminRole) {
        throw new Error(
          `PREFLIGHT_PERMISSION_CHECK_FAILED: Authenticated role is [${roles.join(
            ", "
          )}], expected strictly 'readWrite@Nivora'.`
        );
      }
    }

    // 5. INSPECT EXISTING INSTRUMENTS (READ-ONLY)
    const existingDocs = await InstrumentModel.find(
      {},
      { exchange: 1, symbol: 1, _id: 0 }
    )
      .lean()
      .exec();

    const existingKeySet = new Set(
      existingDocs.map((d) => `${d.exchange}:${d.symbol}`)
    );

    const summaryItems: InstrumentSeedSummaryItem[] = [];
    const insertedSymbols: string[] = [];
    const skippedSymbols: string[] = [];
    let wouldInsertCount = 0;
    let existingCount = 0;
    let insertedCount = 0;
    let skippedCount = 0;

    if (mode === "dry-run") {
      log(
        `\n[DRY-RUN] Inspecting catalog against '${activeDbName}.instruments' (currently ${existingDocs.length} documents)...`
      );

      for (const item of catalogToUse) {
        const key = `${item.exchange}:${item.symbol}`;
        const exists = existingKeySet.has(key);
        const status = exists ? "EXISTING_SKIP" : "WOULD_INSERT";

        if (exists) {
          existingCount++;
          skippedCount++;
          skippedSymbols.push(item.symbol);
        } else {
          wouldInsertCount++;
        }

        summaryItems.push({
          symbol: item.symbol,
          name: item.name,
          exchange: item.exchange,
          sector: INSTRUMENT_SECTOR_METADATA[item.symbol] ?? "Uncategorized",
          lastPricePaise: item.lastPricePaise,
          lastPriceRupees: formatPaiseToRupees(item.lastPricePaise),
          bidPricePaise: item.bidPricePaise,
          askPricePaise: item.askPricePaise,
          previousClosePaise: item.previousClosePaise,
          isStarterWatchlist: item.isStarterWatchlist,
          status,
        });
      }

      const finalCount = await InstrumentModel.countDocuments({}).exec();
      log(`[DRY-RUN] Complete. Would insert: ${wouldInsertCount}, Existing (would skip): ${existingCount}.`);
      log(`[DRY-RUN] Final '${activeDbName}.instruments' count remains: ${finalCount} (0 writes performed).`);

      return {
        mode,
        databaseName: activeDbName,
        nodeEnv: config.nodeEnv,
        catalogValid: true,
        totalCatalogCount: catalogToUse.length,
        starterWatchlistCount: validationReport.starterWatchlistCount,
        wouldInsertCount,
        existingCount,
        insertedCount: 0,
        skippedCount,
        finalCollectionDocumentCount: finalCount,
        insertedSymbols: Object.freeze(insertedSymbols),
        skippedSymbols: Object.freeze(skippedSymbols),
        items: Object.freeze(summaryItems),
      };
    }

    // 6. APPLY MODE: IDEMPOTENT INSERT-ONLY UPSERT ($setOnInsert)
    log(
      `\n[APPLY] Seeding ${catalogToUse.length} instruments into '${activeDbName}.instruments' using $setOnInsert...`
    );

    for (const item of catalogToUse) {
      const key = `${item.exchange}:${item.symbol}`;
      const alreadyExistedBeforeLoop = existingKeySet.has(key);
      if (alreadyExistedBeforeLoop) {
        existingCount++;
      } else {
        wouldInsertCount++;
      }

      const updateResult = await InstrumentModel.updateOne(
        { exchange: item.exchange, symbol: item.symbol },
        {
          $setOnInsert: {
            symbol: item.symbol,
            name: item.name,
            exchange: item.exchange,
            isTradable: item.isTradable,
            lastPricePaise: item.lastPricePaise,
            bidPricePaise: item.bidPricePaise,
            askPricePaise: item.askPricePaise,
            previousClosePaise: item.previousClosePaise,
            isStarterWatchlist: item.isStarterWatchlist,
            priceUpdatedAt: item.priceUpdatedAt,
          },
        },
        { upsert: true }
      ).exec();

      const wasInserted = (updateResult.upsertedCount ?? 0) > 0;
      if (wasInserted) {
        insertedCount++;
        insertedSymbols.push(item.symbol);
      } else {
        skippedCount++;
        skippedSymbols.push(item.symbol);
      }

      summaryItems.push({
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchange,
        sector: INSTRUMENT_SECTOR_METADATA[item.symbol] ?? "Uncategorized",
        lastPricePaise: item.lastPricePaise,
        lastPriceRupees: formatPaiseToRupees(item.lastPricePaise),
        bidPricePaise: item.bidPricePaise,
        askPricePaise: item.askPricePaise,
        previousClosePaise: item.previousClosePaise,
        isStarterWatchlist: item.isStarterWatchlist,
        status: wasInserted ? "INSERTED" : "SKIPPED",
      });
    }

    const finalCount = await InstrumentModel.countDocuments({}).exec();
    log(
      `[APPLY] Complete. Inserted: ${insertedCount}, Skipped existing: ${skippedCount}, Total in DB: ${finalCount}.`
    );

    return {
      mode,
      databaseName: activeDbName,
      nodeEnv: config.nodeEnv,
      catalogValid: true,
      totalCatalogCount: catalogToUse.length,
      starterWatchlistCount: validationReport.starterWatchlistCount,
      wouldInsertCount,
      existingCount,
      insertedCount,
      skippedCount,
      finalCollectionDocumentCount: finalCount,
      insertedSymbols: Object.freeze(insertedSymbols),
      skippedSymbols: Object.freeze(skippedSymbols),
      items: Object.freeze(summaryItems),
    };
  } finally {
    await mongoose.disconnect();
    log("MongoDB connection closed cleanly.\n");
  }
}

// Self-executing CLI runner when executed directly via tsx / node
if (
  process.argv[1] &&
  !process.argv[1].includes(".test.") &&
  (process.argv[1].endsWith("seed-instruments.ts") ||
    process.argv[1].endsWith("seed-instruments.js"))
) {
  dotenv.config();
  let mode: SeedExecutionMode;
  try {
    mode = parseSeedCliArgs(process.argv.slice(2));
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  runInstrumentSeed({ mode })
    .then((result) => {
      console.log("SEED EXECUTION SUMMARY:");
      console.log(
        JSON.stringify(
          {
            mode: result.mode,
            databaseName: result.databaseName,
            nodeEnv: result.nodeEnv,
            catalogValid: result.catalogValid,
            totalCatalogCount: result.totalCatalogCount,
            starterWatchlistCount: result.starterWatchlistCount,
            wouldInsertCount: result.wouldInsertCount,
            existingCount: result.existingCount,
            insertedCount: result.insertedCount,
            skippedCount: result.skippedCount,
            finalCollectionDocumentCount: result.finalCollectionDocumentCount,
            insertedSymbols: result.insertedSymbols,
            skippedSymbols: result.skippedSymbols,
          },
          null,
          2
        )
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("\nFATAL: Instrument seed operation failed:");
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

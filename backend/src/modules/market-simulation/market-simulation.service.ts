import { ClientSession } from "mongoose";
import { isPositiveSafeIntegerPaise } from "../../shared/finance/financial.utils";
import { InstrumentModel } from "../instruments/instrument.model";
import { executeMongoTransaction } from "../practice-accounts/account.service";
import { TransactionRunner } from "../practice-accounts/account.service.types";
import {
  ComputeMarketTickOptions,
  MarketSimulationEngine,
} from "./market-simulation.engine";
import {
  MarketSimulationError,
  MarketSimulationTickResult,
  SimulatableInstrumentRecord,
  SimulatedInstrumentQuoteUpdate,
} from "./market-simulation.types";

export interface MarketSimulationRepositoryPort {
  findAllInstruments(options?: {
    session?: ClientSession;
  }): Promise<readonly SimulatableInstrumentRecord[]>;

  applyBulkQuoteUpdates(
    updates: readonly SimulatedInstrumentQuoteUpdate[],
    options?: { session?: ClientSession }
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
}

/**
 * Default Mongoose-backed repository for reading instruments and persisting
 * atomic bulk quote updates in `instruments`.
 */
export class MongooseMarketSimulationRepository
  implements MarketSimulationRepositoryPort
{
  public async findAllInstruments(options?: {
    session?: ClientSession;
  }): Promise<readonly SimulatableInstrumentRecord[]> {
    const query = InstrumentModel.find({}).sort({ symbol: 1, _id: 1 });
    if (options?.session) {
      query.session(options.session);
    }
    const docs = await query.lean<SimulatableInstrumentRecord[]>().exec();
    return docs;
  }

  public async applyBulkQuoteUpdates(
    updates: readonly SimulatedInstrumentQuoteUpdate[],
    options?: { session?: ClientSession }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (updates.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const bulkOps = updates.map((u) => ({
      updateOne: {
        // Strictly target tradable instrument by _id; never touch non-tradable records
        filter: { _id: u.instrumentId, isTradable: true },
        update: {
          $set: {
            lastPricePaise: u.nextLastPricePaise,
            bidPricePaise: u.nextBidPricePaise,
            askPricePaise: u.nextAskPricePaise,
            priceUpdatedAt: u.priceUpdatedAt,
            updatedAt: u.priceUpdatedAt,
          },
        },
      },
    }));

    const result = await InstrumentModel.bulkWrite(bulkOps, {
      session: options?.session,
      ordered: true,
    });

    return {
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
    };
  }
}

export interface MarketSimulationServiceOptions {
  readonly engine?: MarketSimulationEngine;
  readonly repository?: MarketSimulationRepositoryPort;
  readonly runInTransaction?: TransactionRunner;
}

/**
 * Validates every computed quote transition before any database write occurs.
 */
function assertValidQuoteUpdatesBatch(
  updates: readonly SimulatedInstrumentQuoteUpdate[]
): void {
  for (const u of updates) {
    if (
      !isPositiveSafeIntegerPaise(u.nextLastPricePaise) ||
      !isPositiveSafeIntegerPaise(u.nextBidPricePaise) ||
      !isPositiveSafeIntegerPaise(u.nextAskPricePaise)
    ) {
      throw new MarketSimulationError(
        "PRICE_INVARIANT_VIOLATION",
        `Invalid paise price in tick update for ${u.symbol}.`
      );
    }
    if (u.nextBidPricePaise > u.nextAskPricePaise) {
      throw new MarketSimulationError(
        "PRICE_INVARIANT_VIOLATION",
        `bidPricePaise (${u.nextBidPricePaise}) > askPricePaise (${u.nextAskPricePaise}) for ${u.symbol}.`
      );
    }
    if (
      !(u.priceUpdatedAt instanceof Date) ||
      Number.isNaN(u.priceUpdatedAt.getTime())
    ) {
      throw new MarketSimulationError(
        "PRICE_INVARIANT_VIOLATION",
        `Invalid priceUpdatedAt timestamp for ${u.symbol}.`
      );
    }
  }
}

/**
 * Transactional service that orchestrates synthetic equity quote ticks and
 * persists them atomically into MongoDB (`instruments`).
 *
 * Guarantees:
 * - Single in-flight tick execution (overlapping ticks are skipped safely).
 * - Atomic multi-document update inside a MongoDB transaction (`withTransaction`)
 *   so readers never observe a partially updated market tick.
 * - Preserves `previousClosePaise`, `symbol`, `exchange`, `name`, `isTradable`,
 *   and `isStarterWatchlist`.
 * - Leaves previous committed market state intact if any error occurs mid-tick.
 */
export class MarketSimulationService {
  private readonly engine: MarketSimulationEngine;
  private readonly repository: MarketSimulationRepositoryPort;
  private readonly runInTransaction: TransactionRunner;
  private activeTickPromise: Promise<MarketSimulationTickResult> | null = null;

  constructor(options: MarketSimulationServiceOptions = {}) {
    this.engine = options.engine ?? new MarketSimulationEngine();
    this.repository =
      options.repository ?? new MongooseMarketSimulationRepository();
    this.runInTransaction =
      options.runInTransaction ?? executeMongoTransaction;
  }

  public getEngine(): MarketSimulationEngine {
    return this.engine;
  }

  public isTickInProgress(): boolean {
    return this.activeTickPromise !== null;
  }

  /**
   * Waits for any currently executing tick to settle (used during graceful shutdown).
   */
  public async waitForActiveTick(): Promise<void> {
    if (this.activeTickPromise) {
      try {
        await this.activeTickPromise;
      } catch {
        // Ignore tick error when draining on shutdown
      }
    }
  }

  /**
   * Executes a single market simulation tick atomically.
   * If a tick is already in progress, returns immediately with `executed: false`
   * and `skippedReason: "TICK_IN_PROGRESS"`.
   */
  public async executeTick(
    options: ComputeMarketTickOptions = {}
  ): Promise<MarketSimulationTickResult> {
    if (this.activeTickPromise !== null) {
      return Object.freeze({
        executed: false,
        skippedReason: "TICK_IN_PROGRESS",
        tickNumber: this.engine.getTickCount(),
        sentiment: this.engine.getCurrentSentiment(),
        marketEffectBps: 0,
        timestamp: options.now ?? new Date(),
        updatedCount: 0,
        skippedNonTradableCount: 0,
        durationMs: 0,
        updates: Object.freeze([]),
      });
    }

    const runPromise = this.performTransactionalTick(options);
    this.activeTickPromise = runPromise;

    try {
      return await runPromise;
    } finally {
      this.activeTickPromise = null;
    }
  }

  private async performTransactionalTick(
    options: ComputeMarketTickOptions
  ): Promise<MarketSimulationTickResult> {
    const startTimeMs = Date.now();

    return await this.runInTransaction(async (session?: ClientSession) => {
      const instruments = await this.repository.findAllInstruments({ session });

      const computation = this.engine.computeTick(instruments, options);

      if (computation.updates.length === 0) {
        return Object.freeze({
          executed: false,
          skippedReason: "NO_TRADABLE_INSTRUMENTS",
          tickNumber: computation.tickNumber,
          sentiment: computation.sentiment,
          marketEffectBps: computation.marketEffectBps,
          timestamp: computation.timestamp,
          updatedCount: 0,
          skippedNonTradableCount: computation.skippedNonTradableCount,
          durationMs: Date.now() - startTimeMs,
          updates: computation.updates,
        });
      }

      // Validate all computed quotes prior to executing database writes
      assertValidQuoteUpdatesBatch(computation.updates);

      const writeStats = await this.repository.applyBulkQuoteUpdates(
        computation.updates,
        { session }
      );

      if (writeStats.matchedCount !== computation.updates.length) {
        throw new MarketSimulationError(
          "PERSISTENCE_MISMATCH",
          `Atomic market tick expected to match ${computation.updates.length} tradable instruments, but matched ${writeStats.matchedCount}. Rolling back tick.`
        );
      }

      return Object.freeze({
        executed: true,
        tickNumber: computation.tickNumber,
        sentiment: computation.sentiment,
        marketEffectBps: computation.marketEffectBps,
        timestamp: computation.timestamp,
        updatedCount: writeStats.matchedCount,
        skippedNonTradableCount: computation.skippedNonTradableCount,
        durationMs: Date.now() - startTimeMs,
        updates: computation.updates,
      });
    });
  }
}

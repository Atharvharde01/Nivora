import { ClientSession, Types } from "mongoose";
import { isPositiveSafeIntegerPaise } from "../../shared/finance/financial.utils";
import { InstrumentModel } from "../instruments/instrument.model";
import { MarketCandleModel } from "../market-candles/market-candle.model";
import { MarketIndexCandleModel } from "../market-candles/market-index-candle.model";
import { isPositiveSafeFixedPointIndexValue } from "../market-candles/market-index-candle.schema";
import {
  CandleInterval,
  SIMULATED_CANDLE_SOURCE,
} from "../market-candles/market-candle.types";
import { getCandleTimeBucket } from "../market-candles/market-candle.utils";
import { MarketIndexModel } from "../market-indices/market-index.model";
import {
  IMarketIndexConstituent,
  MarketIndexSymbol,
} from "../market-indices/market-index.types";
import { calculateSyntheticIndexValue } from "../market-indices/market-index.utils";
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
  SimulatedMarketIndexUpdate,
} from "./market-simulation.types";

const LIVE_PERSISTED_CANDLE_INTERVALS: readonly CandleInterval[] = [
  "1m",
  "1d",
] as const;

export interface SimulatableMarketIndexRecord {
  readonly _id: Types.ObjectId;
  readonly symbol: MarketIndexSymbol;
  readonly currentValue: number;
  readonly baseValue: number;
  readonly previousCloseValue: number;
  readonly constituents: readonly IMarketIndexConstituent[];
  readonly valueUpdatedAt: Date;
}

export interface MarketSimulationRepositoryPort {
  findAllInstruments(options?: {
    session?: ClientSession;
  }): Promise<readonly SimulatableInstrumentRecord[]>;

  applyBulkQuoteUpdates(
    updates: readonly SimulatedInstrumentQuoteUpdate[],
    options?: { session?: ClientSession }
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  upsertBulkEquityCandles?(
    updates: readonly SimulatedInstrumentQuoteUpdate[],
    timestamp: Date,
    options?: { session?: ClientSession }
  ): Promise<void>;

  findAllMarketIndices?(options?: {
    session?: ClientSession;
  }): Promise<readonly SimulatableMarketIndexRecord[]>;

  applyBulkIndexUpdates?(
    updates: readonly SimulatedMarketIndexUpdate[],
    options?: { session?: ClientSession }
  ): Promise<{ matchedCount: number; modifiedCount: number }>;

  upsertBulkIndexCandles?(
    updates: readonly SimulatedMarketIndexUpdate[],
    timestamp: Date,
    options?: { session?: ClientSession }
  ): Promise<void>;
}

/**
 * Default Mongoose-backed repository for reading instruments/indices and persisting
 * atomic bulk quote updates, synthetic index updates, and live OHLC candle buckets.
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

  public async upsertBulkEquityCandles(
    updates: readonly SimulatedInstrumentQuoteUpdate[],
    timestamp: Date,
    options?: { session?: ClientSession }
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const bulkOps = [];

    for (const interval of LIVE_PERSISTED_CANDLE_INTERVALS) {
      const bucket = getCandleTimeBucket(timestamp, interval);
      for (const u of updates) {
        bulkOps.push({
          updateOne: {
            filter: {
              instrumentId: u.instrumentId,
              interval: bucket.interval,
              openTime: bucket.openTime,
            },
            update: {
              $setOnInsert: {
                instrumentId: u.instrumentId,
                interval: bucket.interval,
                openTime: bucket.openTime,
                closeTime: bucket.closeTime,
                openPaise: u.nextLastPricePaise,
                source: SIMULATED_CANDLE_SOURCE,
                createdAt: timestamp,
              },
              $max: {
                highPaise: u.nextLastPricePaise,
              },
              $min: {
                lowPaise: u.nextLastPricePaise,
              },
              $set: {
                closePaise: u.nextLastPricePaise,
                updatedAt: timestamp,
              },
            },
            upsert: true,
          },
        });
      }
    }

    await MarketCandleModel.bulkWrite(bulkOps, {
      session: options?.session,
      ordered: true,
    });
  }

  public async findAllMarketIndices(options?: {
    session?: ClientSession;
  }): Promise<readonly SimulatableMarketIndexRecord[]> {
    const query = MarketIndexModel.find({}).sort({ symbol: 1, _id: 1 });
    if (options?.session) {
      query.session(options.session);
    }
    const docs = await query.lean<SimulatableMarketIndexRecord[]>().exec();
    return docs;
  }

  public async applyBulkIndexUpdates(
    updates: readonly SimulatedMarketIndexUpdate[],
    options?: { session?: ClientSession }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (updates.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const bulkOps = updates.map((u) => ({
      updateOne: {
        filter: { _id: u.indexId, symbol: u.symbol },
        update: {
          $set: {
            currentValue: u.nextValue,
            valueUpdatedAt: u.valueUpdatedAt,
            updatedAt: u.valueUpdatedAt,
          },
        },
      },
    }));

    const result = await MarketIndexModel.bulkWrite(bulkOps, {
      session: options?.session,
      ordered: true,
    });

    return {
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
    };
  }

  public async upsertBulkIndexCandles(
    updates: readonly SimulatedMarketIndexUpdate[],
    timestamp: Date,
    options?: { session?: ClientSession }
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const bulkOps = [];

    for (const interval of LIVE_PERSISTED_CANDLE_INTERVALS) {
      const bucket = getCandleTimeBucket(timestamp, interval);
      for (const u of updates) {
        bulkOps.push({
          updateOne: {
            filter: {
              indexId: u.indexId,
              interval: bucket.interval,
              openTime: bucket.openTime,
            },
            update: {
              $setOnInsert: {
                indexId: u.indexId,
                interval: bucket.interval,
                openTime: bucket.openTime,
                closeTime: bucket.closeTime,
                openValue: u.nextValue,
                source: SIMULATED_CANDLE_SOURCE,
                createdAt: timestamp,
              },
              $max: {
                highValue: u.nextValue,
              },
              $min: {
                lowValue: u.nextValue,
              },
              $set: {
                closeValue: u.nextValue,
                updatedAt: timestamp,
              },
            },
            upsert: true,
          },
        });
      }
    }

    await MarketIndexCandleModel.bulkWrite(bulkOps, {
      session: options?.session,
      ordered: true,
    });
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

function assertValidIndexUpdatesBatch(
  updates: readonly SimulatedMarketIndexUpdate[]
): void {
  for (const u of updates) {
    if (!isPositiveSafeFixedPointIndexValue(u.nextValue)) {
      throw new MarketSimulationError(
        "PRICE_INVARIANT_VIOLATION",
        `Invalid fixed-point index value (${String(u.nextValue)}) for ${u.symbol}.`
      );
    }
    if (
      !(u.valueUpdatedAt instanceof Date) ||
      Number.isNaN(u.valueUpdatedAt.getTime())
    ) {
      throw new MarketSimulationError(
        "PRICE_INVARIANT_VIOLATION",
        `Invalid valueUpdatedAt timestamp for ${u.symbol}.`
      );
    }
  }
}

/**
 * Transactional service that orchestrates synthetic equity quote ticks, live OHLC
 * candle bucket aggregation (`market_candles`), synthetic market index updates
 * (`market_indices`), and index OHLC candle buckets (`market_index_candles`),
 * persisting them atomically into MongoDB.
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
        updatedIndexCount: 0,
        skippedNonTradableCount: 0,
        durationMs: 0,
        updates: Object.freeze([]),
        indexUpdates: Object.freeze([]),
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
          updatedIndexCount: 0,
          skippedNonTradableCount: computation.skippedNonTradableCount,
          durationMs: Date.now() - startTimeMs,
          updates: computation.updates,
          indexUpdates: Object.freeze([]),
        });
      }

      // 1. Validate all computed equity quotes prior to executing database writes
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

      // 2. Upsert "1m" and "1d" equity OHLC candles for all updated tradable instruments
      if (this.repository.upsertBulkEquityCandles) {
        await this.repository.upsertBulkEquityCandles(
          computation.updates,
          computation.timestamp,
          { session }
        );
      }

      // 3. Recompute and persist synthetic market indices and their "1m" / "1d" OHLC candles
      const indexUpdates: SimulatedMarketIndexUpdate[] = [];

      if (
        this.repository.findAllMarketIndices &&
        this.repository.applyBulkIndexUpdates
      ) {
        const indices = await this.repository.findAllMarketIndices({ session });

        if (indices.length > 0) {
          // Build post-tick equity price map from all instruments + updated quotes
          const postTickPriceMap = new Map<string, number>();
          for (const inst of instruments) {
            postTickPriceMap.set(String(inst._id), inst.lastPricePaise);
            postTickPriceMap.set(
              inst.symbol.toUpperCase(),
              inst.lastPricePaise
            );
          }
          for (const u of computation.updates) {
            postTickPriceMap.set(String(u.instrumentId), u.nextLastPricePaise);
            postTickPriceMap.set(u.symbol.toUpperCase(), u.nextLastPricePaise);
          }

          for (const idxDoc of indices) {
            const nextValue = calculateSyntheticIndexValue(
              idxDoc.baseValue,
              idxDoc.constituents,
              postTickPriceMap
            );

            indexUpdates.push(
              Object.freeze({
                indexId: idxDoc._id,
                symbol: idxDoc.symbol,
                previousValue: idxDoc.currentValue,
                nextValue,
                baseValue: idxDoc.baseValue,
                previousCloseValue: idxDoc.previousCloseValue,
                valueUpdatedAt: computation.timestamp,
              })
            );
          }

          assertValidIndexUpdatesBatch(indexUpdates);

          const indexWriteStats = await this.repository.applyBulkIndexUpdates(
            indexUpdates,
            { session }
          );

          if (indexWriteStats.matchedCount !== indexUpdates.length) {
            throw new MarketSimulationError(
              "PERSISTENCE_MISMATCH",
              `Atomic market tick expected to match ${indexUpdates.length} market indices, but matched ${indexWriteStats.matchedCount}. Rolling back tick.`
            );
          }

          if (this.repository.upsertBulkIndexCandles) {
            await this.repository.upsertBulkIndexCandles(
              indexUpdates,
              computation.timestamp,
              { session }
            );
          }
        }
      }

      return Object.freeze({
        executed: true,
        tickNumber: computation.tickNumber,
        sentiment: computation.sentiment,
        marketEffectBps: computation.marketEffectBps,
        timestamp: computation.timestamp,
        updatedCount: writeStats.matchedCount,
        updatedIndexCount: indexUpdates.length,
        skippedNonTradableCount: computation.skippedNonTradableCount,
        durationMs: Date.now() - startTimeMs,
        updates: computation.updates,
        indexUpdates: Object.freeze(indexUpdates),
      });
    });
  }
}

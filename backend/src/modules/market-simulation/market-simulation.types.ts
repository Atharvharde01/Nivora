import { Types } from "mongoose";
import { InstrumentExchange } from "../instruments/instrument.types";

/**
 * Shared market sentiment regimes that introduce a correlated directional component
 * across equities during a simulation tick while preserving individual stock shocks.
 */
export const MARKET_SENTIMENT_REGIMES = [
  "BULLISH",
  "BEARISH",
  "SIDEWAYS",
] as const;

export type MarketSentimentRegime = (typeof MARKET_SENTIMENT_REGIMES)[number];

/**
 * Per-instrument volatility profile tiers.
 * - LOW: Large established blue-chip businesses with tighter per-tick variance.
 * - MEDIUM: Standard large-cap equities.
 * - HIGH: Higher-beta / cyclical equities with wider per-tick variance.
 */
export const VOLATILITY_PROFILE_TIERS = ["LOW", "MEDIUM", "HIGH"] as const;

export type VolatilityProfileTier = (typeof VOLATILITY_PROFILE_TIERS)[number];

/**
 * Injectable random number generator returning a number in `[0, 1)`.
 */
export type RandomSource = () => number;

/**
 * Injectable clock provider returning the current `Date`.
 */
export type ClockProvider = () => Date;

/**
 * Parameters defining a volatility profile tier.
 */
export interface VolatilityProfileConfig {
  readonly tier: VolatilityProfileTier;
  /** Maximum idiosyncratic stock shock per tick in basis points (1 bps = 0.01%). */
  readonly maxStockShockBps: number;
  /** Sensitivity multiplier to shared market sentiment (e.g., 0.8 for LOW, 1.0 for MEDIUM, 1.25 for HIGH). */
  readonly marketBeta: number;
  /** Baseline drift per tick in basis points. */
  readonly baseDriftBps: number;
  /** Full bid-ask spread in basis points around `lastPricePaise`. */
  readonly spreadBps: number;
}

/**
 * Configuration for the Market Simulation Engine.
 */
export interface MarketSimulationEngineConfig {
  /** Maximum allowed single-tick price movement in basis points (e.g., 75 bps = 0.75%). */
  readonly maxMoveBps: number;
  /** Maximum allowed cumulative deviation from `previousClosePaise` in basis points (e.g., 1000 bps = 10%). */
  readonly maxDeviationFromPrevCloseBps: number;
  /** Minimum price floor in paise (must be >= 1). */
  readonly minPricePaise: number;
  /** Standard NSE tick rounding increment in paise (5 paise = ₹0.05) for prices >= 100 paise. */
  readonly tickSizePaise: number;
  /** Probability [0, 1] of transitioning to a new market sentiment regime on a given tick. */
  readonly sentimentTransitionProbability: number;
}

/**
 * Minimal persisted instrument record required by the simulation engine.
 */
export interface SimulatableInstrumentRecord {
  readonly _id: Types.ObjectId;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: InstrumentExchange;
  readonly isTradable: boolean;
  readonly lastPricePaise: number;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly previousClosePaise: number;
  readonly isStarterWatchlist: boolean;
  readonly priceUpdatedAt: Date;
}

/**
 * Computed quote transition for a single instrument in a simulation tick.
 */
export interface SimulatedInstrumentQuoteUpdate {
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly volatilityTier: VolatilityProfileTier;
  readonly previousLastPricePaise: number;
  readonly nextLastPricePaise: number;
  readonly nextBidPricePaise: number;
  readonly nextAskPricePaise: number;
  readonly previousClosePaise: number;
  readonly appliedMoveBps: number;
  readonly priceUpdatedAt: Date;
}

/**
 * Result of computing a full market tick across a batch of instruments.
 */
export interface MarketSimulationTickComputation {
  readonly tickNumber: number;
  readonly sentiment: MarketSentimentRegime;
  readonly marketEffectBps: number;
  readonly timestamp: Date;
  readonly totalInputInstruments: number;
  readonly skippedNonTradableCount: number;
  readonly updates: readonly SimulatedInstrumentQuoteUpdate[];
}

/**
 * Result of executing and persisting a market tick via `MarketSimulationService`.
 */
export interface MarketSimulationTickResult {
  readonly executed: boolean;
  readonly skippedReason?: "TICK_IN_PROGRESS" | "NO_TRADABLE_INSTRUMENTS";
  readonly tickNumber: number;
  readonly sentiment: MarketSentimentRegime;
  readonly marketEffectBps: number;
  readonly timestamp: Date;
  readonly updatedCount: number;
  readonly skippedNonTradableCount: number;
  readonly durationMs: number;
  readonly updates: readonly SimulatedInstrumentQuoteUpdate[];
}

/**
 * Runtime status snapshot of the Market Simulation Scheduler.
 */
export interface MarketSimulationSchedulerStatus {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly tickInProgress: boolean;
  readonly intervalMs: number;
  readonly maxMoveBps: number;
  readonly completedTicks: number;
  readonly failedTicks: number;
  readonly currentSentiment: MarketSentimentRegime;
  readonly lastTickAt: Date | null;
  readonly lastTickUpdatedCount: number;
}

export type MarketSimulationErrorCode =
  | "INVALID_SIMULATION_CONFIG"
  | "INVALID_INSTRUMENT_STATE"
  | "INVALID_RANDOM_VALUE"
  | "PRICE_INVARIANT_VIOLATION"
  | "PERSISTENCE_MISMATCH"
  | "TRANSACTION_FAILED";

export class MarketSimulationError extends Error {
  public readonly code: MarketSimulationErrorCode;

  constructor(code: MarketSimulationErrorCode, message: string) {
    super(message);
    this.name = "MarketSimulationError";
    this.code = code;
    Object.setPrototypeOf(this, MarketSimulationError.prototype);
  }
}

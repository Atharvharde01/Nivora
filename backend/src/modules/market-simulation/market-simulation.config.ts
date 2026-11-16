import {
  MarketSentimentRegime,
  MarketSimulationEngineConfig,
  VolatilityProfileConfig,
  VolatilityProfileTier,
} from "./market-simulation.types";

/**
 * Basis points denominator: 10,000 bps = 100% (1 bps = 0.01%).
 */
export const BASIS_POINTS_DENOMINATOR = 10_000;

/**
 * Default scheduler interval in milliseconds for local development: 5,000 ms (5 seconds).
 */
export const DEFAULT_MARKET_SIMULATION_INTERVAL_MS = 5_000;
export const MIN_MARKET_SIMULATION_INTERVAL_MS = 500;
export const MAX_MARKET_SIMULATION_INTERVAL_MS = 300_000;

/**
 * Default maximum single-tick movement guardrail in basis points: 75 bps (0.75%).
 */
export const DEFAULT_MARKET_SIMULATION_MAX_MOVE_BPS = 75;
export const MIN_MARKET_SIMULATION_MAX_MOVE_BPS = 5;
export const MAX_MARKET_SIMULATION_MAX_MOVE_BPS = 500;

/**
 * Default maximum cumulative deviation from `previousClosePaise` in basis points:
 * 1,000 bps (±10.00% synthetic daily simulation guardrail).
 */
export const DEFAULT_MAX_DEVIATION_FROM_PREV_CLOSE_BPS = 1_000;

/**
 * Minimum allowed instrument price in paise (₹0.05 = 5 paise default floor, never < 1 paise).
 */
export const DEFAULT_MIN_INSTRUMENT_PRICE_PAISE = 5;

/**
 * Standard NSE tick increment in paise (₹0.05 = 5 paise) applied when price >= 100 paise.
 */
export const DEFAULT_TICK_SIZE_PAISE = 5;

/**
 * Default probability of transitioning to a new shared market sentiment regime per tick.
 */
export const DEFAULT_SENTIMENT_TRANSITION_PROBABILITY = 0.15;

export const DEFAULT_MARKET_SIMULATION_ENGINE_CONFIG: Readonly<MarketSimulationEngineConfig> =
  Object.freeze({
    maxMoveBps: DEFAULT_MARKET_SIMULATION_MAX_MOVE_BPS,
    maxDeviationFromPrevCloseBps: DEFAULT_MAX_DEVIATION_FROM_PREV_CLOSE_BPS,
    minPricePaise: DEFAULT_MIN_INSTRUMENT_PRICE_PAISE,
    tickSizePaise: DEFAULT_TICK_SIZE_PAISE,
    sentimentTransitionProbability: DEFAULT_SENTIMENT_TRANSITION_PROBABILITY,
  });

/**
 * Shared market sentiment directional parameters in basis points:
 * - BULLISH: positive common market drift (+8 to +22 bps before beta scaling).
 * - BEARISH: negative common market drift (-22 to -8 bps before beta scaling).
 * - SIDEWAYS: near-zero common market drift (-6 to +6 bps before beta scaling).
 */
export interface SentimentRegimeParameters {
  readonly regime: MarketSentimentRegime;
  readonly minMarketEffectBps: number;
  readonly maxMarketEffectBps: number;
}

export const SENTIMENT_REGIME_PARAMETERS: Readonly<
  Record<MarketSentimentRegime, Readonly<SentimentRegimeParameters>>
> = Object.freeze({
  BULLISH: Object.freeze({
    regime: "BULLISH",
    minMarketEffectBps: 8,
    maxMarketEffectBps: 22,
  }),
  BEARISH: Object.freeze({
    regime: "BEARISH",
    minMarketEffectBps: -22,
    maxMarketEffectBps: -8,
  }),
  SIDEWAYS: Object.freeze({
    regime: "SIDEWAYS",
    minMarketEffectBps: -6,
    maxMarketEffectBps: 6,
  }),
});

/**
 * Volatility profile definitions for LOW, MEDIUM, and HIGH volatility tiers.
 */
export const VOLATILITY_PROFILES: Readonly<
  Record<VolatilityProfileTier, Readonly<VolatilityProfileConfig>>
> = Object.freeze({
  LOW: Object.freeze({
    tier: "LOW",
    maxStockShockBps: 20,
    marketBeta: 0.75,
    baseDriftBps: 0,
    spreadBps: 6,
  }),
  MEDIUM: Object.freeze({
    tier: "MEDIUM",
    maxStockShockBps: 35,
    marketBeta: 1.0,
    baseDriftBps: 0,
    spreadBps: 8,
  }),
  HIGH: Object.freeze({
    tier: "HIGH",
    maxStockShockBps: 55,
    marketBeta: 1.25,
    baseDriftBps: 0,
    spreadBps: 10,
  }),
});

/**
 * Concise symbol sets for LOW and HIGH volatility tiers.
 * Any symbol not in LOW or HIGH defaults automatically to MEDIUM, avoiding
 * maintenance of a duplicate 50-stock catalog.
 */
const LOW_VOLATILITY_SYMBOLS: ReadonlySet<string> = new Set([
  "HDFCBANK",
  "TCS",
  "ITC",
  "HINDUNILVR",
  "NESTLEIND",
  "BRITANNIA",
  "POWERGRID",
  "NTPC",
  "SUNPHARMA",
  "CIPLA",
  "ASIANPAINT",
]);

const HIGH_VOLATILITY_SYMBOLS: ReadonlySet<string> = new Set([
  "ADANIENT",
  "ADANIPORTS",
  "TATASTEEL",
  "JSWSTEEL",
  "HINDALCO",
  "TATAMOTORS",
  "BAJFINANCE",
  "INDUSINDBK",
  "ONGC",
  "COALINDIA",
]);

/**
 * Resolves the volatility profile for a given instrument symbol.
 * Defaults to `MEDIUM` for general equities.
 */
export function getVolatilityProfileForSymbol(
  symbol: string
): Readonly<VolatilityProfileConfig> {
  const normalized = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (LOW_VOLATILITY_SYMBOLS.has(normalized)) {
    return VOLATILITY_PROFILES.LOW;
  }
  if (HIGH_VOLATILITY_SYMBOLS.has(normalized)) {
    return VOLATILITY_PROFILES.HIGH;
  }
  return VOLATILITY_PROFILES.MEDIUM;
}

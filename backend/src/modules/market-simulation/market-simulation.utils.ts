import {
  isPositiveSafeIntegerPaise,
  safeAddPaise,
} from "../../shared/finance/financial.utils";
import {
  BASIS_POINTS_DENOMINATOR,
  DEFAULT_MAX_DEVIATION_FROM_PREV_CLOSE_BPS,
  DEFAULT_MARKET_SIMULATION_MAX_MOVE_BPS,
  DEFAULT_MIN_INSTRUMENT_PRICE_PAISE,
  DEFAULT_TICK_SIZE_PAISE,
  SENTIMENT_REGIME_PARAMETERS,
} from "./market-simulation.config";
import {
  MARKET_SENTIMENT_REGIMES,
  MarketSentimentRegime,
  MarketSimulationError,
  RandomSource,
  VolatilityProfileConfig,
} from "./market-simulation.types";

const BPS_DENOM_BIGINT = BigInt(BASIS_POINTS_DENOMINATOR);
const MAX_SAFE_INT_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Deterministic half-up integer division for positive `BigInt` values:
 * `round(numerator / denominator) = floor((2 * numerator + denominator) / (2 * denominator))`.
 */
function divideBigIntHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

/**
 * Validates and normalizes a random unit value from `RandomSource` in `[0, 1)`.
 */
export function assertValidRandomUnitValue(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new MarketSimulationError(
      "INVALID_RANDOM_VALUE",
      `Random source must return a finite number in [0, 1), received: ${String(value)}.`
    );
  }
  return value === 1 ? 1 - Number.EPSILON : value;
}

/**
 * Selects the next shared market sentiment regime given the current regime,
 * transition probability, and injectable random source.
 */
export function selectNextSentimentRegime(
  currentRegime: MarketSentimentRegime,
  transitionProbability: number,
  randomSource: RandomSource = Math.random
): MarketSentimentRegime {
  if (!(MARKET_SENTIMENT_REGIMES as readonly string[]).includes(currentRegime)) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      `Invalid current sentiment regime: ${String(currentRegime)}.`
    );
  }
  if (
    typeof transitionProbability !== "number" ||
    !Number.isFinite(transitionProbability) ||
    transitionProbability < 0 ||
    transitionProbability > 1
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "sentimentTransitionProbability must be a number between 0 and 1."
    );
  }

  const transitionRoll = assertValidRandomUnitValue(randomSource());
  if (transitionRoll >= transitionProbability) {
    return currentRegime;
  }

  const selectionRoll = assertValidRandomUnitValue(randomSource());
  const idx = Math.min(
    MARKET_SENTIMENT_REGIMES.length - 1,
    Math.floor(selectionRoll * MARKET_SENTIMENT_REGIMES.length)
  );
  return MARKET_SENTIMENT_REGIMES[idx];
}

/**
 * Computes the shared market effect in basis points for the current tick
 * based on the active `MarketSentimentRegime`.
 */
export function calculateMarketEffectBps(
  sentiment: MarketSentimentRegime,
  randomSource: RandomSource = Math.random
): number {
  const params = SENTIMENT_REGIME_PARAMETERS[sentiment];
  if (!params) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      `Unsupported market sentiment regime: ${String(sentiment)}.`
    );
  }

  const u = assertValidRandomUnitValue(randomSource());
  const range = params.maxMarketEffectBps - params.minMarketEffectBps;
  const rawBps = params.minMarketEffectBps + u * range;
  const rounded = Math.round(rawBps);
  return rounded === 0 ? 0 : rounded;
}

/**
 * Computes an instrument-specific idiosyncratic shock in basis points within
 * `[-maxStockShockBps, +maxStockShockBps]`.
 */
export function calculateStockShockBps(
  maxStockShockBps: number,
  randomSource: RandomSource = Math.random
): number {
  if (
    typeof maxStockShockBps !== "number" ||
    !Number.isSafeInteger(maxStockShockBps) ||
    maxStockShockBps < 0 ||
    maxStockShockBps > 5_000
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "maxStockShockBps must be a non-negative safe integer up to 5000."
    );
  }

  const u = assertValidRandomUnitValue(randomSource());
  const centered = 2 * u - 1; // [-1, +1)
  const shock = Math.round(centered * maxStockShockBps);
  return shock === 0 ? 0 : shock;
}

/**
 * Rounds a positive paise price to the configured tick increment (e.g., 5 paise = ₹0.05)
 * when `pricePaise >= 100`, and enforces `minPricePaise >= 1`.
 */
export function roundToTickPaise(
  pricePaise: number,
  tickSizePaise: number = DEFAULT_TICK_SIZE_PAISE,
  minPricePaise: number = DEFAULT_MIN_INSTRUMENT_PRICE_PAISE
): number {
  if (
    typeof pricePaise !== "number" ||
    !Number.isFinite(pricePaise) ||
    pricePaise > Number.MAX_SAFE_INTEGER
  ) {
    throw new MarketSimulationError(
      "PRICE_INVARIANT_VIOLATION",
      `pricePaise (${String(pricePaise)}) must be a finite safe number.`
    );
  }
  if (
    typeof tickSizePaise !== "number" ||
    !Number.isSafeInteger(tickSizePaise) ||
    tickSizePaise < 1
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "tickSizePaise must be a positive safe integer."
    );
  }
  if (
    typeof minPricePaise !== "number" ||
    !Number.isSafeInteger(minPricePaise) ||
    minPricePaise < 1
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "minPricePaise must be a positive safe integer >= 1."
    );
  }

  const effectiveFloor = Math.max(1, minPricePaise);
  const clampedFloor = Math.max(effectiveFloor, Math.round(pricePaise));

  if (clampedFloor < 100 || tickSizePaise === 1) {
    return clampedFloor;
  }

  const halfTick = Math.floor(tickSizePaise / 2);
  const rounded =
    Math.floor((clampedFloor + halfTick) / tickSizePaise) * tickSizePaise;
  return Math.max(effectiveFloor, Math.min(Number.MAX_SAFE_INTEGER, rounded));
}

export interface CalculateNextPriceInput {
  readonly currentLastPricePaise: number;
  readonly previousClosePaise: number;
  readonly volatilityProfile: VolatilityProfileConfig;
  readonly marketEffectBps: number;
  readonly stockShockBps: number;
  readonly maxMoveBps?: number;
  readonly maxDeviationFromPrevCloseBps?: number;
  readonly minPricePaise?: number;
  readonly tickSizePaise?: number;
}

export interface CalculateNextPriceResult {
  readonly nextLastPricePaise: number;
  readonly appliedMoveBps: number;
  readonly rawUnclampedBps: number;
}

/**
 * Computes the next simulated `lastPricePaise` using the bounded stochastic model:
 * `nextPrice = currentPrice * (1 + clampedDeltaBps / 10000)`
 * where `rawDeltaBps = round(baseDriftBps + marketBeta * marketEffectBps + stockShockBps)`.
 *
 * Enforces:
 * 1. Per-tick movement cap (`[-maxMoveBps, +maxMoveBps]`).
 * 2. Cumulative deviation guardrail relative to `previousClosePaise` (`±maxDeviationFromPrevCloseBps`).
 * 3. Positive safe integer paise and tick-size rounding.
 */
export function calculateNextInstrumentPrice(
  input: CalculateNextPriceInput
): CalculateNextPriceResult {
  const {
    currentLastPricePaise,
    previousClosePaise,
    volatilityProfile,
    marketEffectBps,
    stockShockBps,
    maxMoveBps = DEFAULT_MARKET_SIMULATION_MAX_MOVE_BPS,
    maxDeviationFromPrevCloseBps = DEFAULT_MAX_DEVIATION_FROM_PREV_CLOSE_BPS,
    minPricePaise = DEFAULT_MIN_INSTRUMENT_PRICE_PAISE,
    tickSizePaise = DEFAULT_TICK_SIZE_PAISE,
  } = input;

  if (!isPositiveSafeIntegerPaise(currentLastPricePaise)) {
    throw new MarketSimulationError(
      "INVALID_INSTRUMENT_STATE",
      `currentLastPricePaise (${String(currentLastPricePaise)}) must be a positive safe integer.`
    );
  }
  if (!isPositiveSafeIntegerPaise(previousClosePaise)) {
    throw new MarketSimulationError(
      "INVALID_INSTRUMENT_STATE",
      `previousClosePaise (${String(previousClosePaise)}) must be a positive safe integer.`
    );
  }
  if (
    typeof maxMoveBps !== "number" ||
    !Number.isSafeInteger(maxMoveBps) ||
    maxMoveBps < 1 ||
    maxMoveBps > 5_000
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "maxMoveBps must be a safe integer between 1 and 5000."
    );
  }
  if (
    typeof maxDeviationFromPrevCloseBps !== "number" ||
    !Number.isSafeInteger(maxDeviationFromPrevCloseBps) ||
    maxDeviationFromPrevCloseBps < maxMoveBps ||
    maxDeviationFromPrevCloseBps >= BASIS_POINTS_DENOMINATOR
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      `maxDeviationFromPrevCloseBps must be between maxMoveBps (${maxMoveBps}) and 9999.`
    );
  }

  const rawUnclampedBps = Math.round(
    volatilityProfile.baseDriftBps +
      volatilityProfile.marketBeta * marketEffectBps +
      stockShockBps
  );

  const clampedMoveBps = Math.max(
    -maxMoveBps,
    Math.min(maxMoveBps, rawUnclampedBps)
  );

  const factorBpsBigInt = BigInt(BASIS_POINTS_DENOMINATOR + clampedMoveBps);
  const rawNextBigInt = divideBigIntHalfUp(
    BigInt(currentLastPricePaise) * factorBpsBigInt,
    BPS_DENOM_BIGINT
  );

  if (rawNextBigInt > MAX_SAFE_INT_BIGINT) {
    throw new MarketSimulationError(
      "PRICE_INVARIANT_VIOLATION",
      "Calculated next price exceeds Number.MAX_SAFE_INTEGER."
    );
  }

  let candidatePaise = roundToTickPaise(
    Number(rawNextBigInt),
    tickSizePaise,
    minPricePaise
  );

  // If a meaningful directional shock (>= 4 bps) occurred on a lower-priced stock
  // whose percentage move was smaller than half a 5-paise tick, nudge by 1 tick
  if (
    candidatePaise === currentLastPricePaise &&
    Math.abs(clampedMoveBps) >= 4
  ) {
    const step = currentLastPricePaise >= 100 ? tickSizePaise : 1;
    const nudged =
      clampedMoveBps > 0
        ? currentLastPricePaise + step
        : Math.max(minPricePaise, currentLastPricePaise - step);
    // Ensure the 1-tick nudge itself does not exceed maxMoveBps unless price is tiny
    const nudgeBps = Math.round(
      (Math.abs(nudged - currentLastPricePaise) * BASIS_POINTS_DENOMINATOR) /
        currentLastPricePaise
    );
    if (nudgeBps <= maxMoveBps) {
      candidatePaise = nudged;
    }
  }

  // Enforce cumulative deviation guardrail relative to previousClosePaise
  const minAllowedFromCloseBigInt = divideBigIntHalfUp(
    BigInt(previousClosePaise) *
      BigInt(BASIS_POINTS_DENOMINATOR - maxDeviationFromPrevCloseBps),
    BPS_DENOM_BIGINT
  );
  const maxAllowedFromCloseBigInt = divideBigIntHalfUp(
    BigInt(previousClosePaise) *
      BigInt(BASIS_POINTS_DENOMINATOR + maxDeviationFromPrevCloseBps),
    BPS_DENOM_BIGINT
  );

  const minBandPaise = roundToTickPaise(
    Number(minAllowedFromCloseBigInt),
    tickSizePaise,
    minPricePaise
  );
  const maxBandPaise = roundToTickPaise(
    Number(
      maxAllowedFromCloseBigInt > MAX_SAFE_INT_BIGINT
        ? MAX_SAFE_INT_BIGINT
        : maxAllowedFromCloseBigInt
    ),
    tickSizePaise,
    minPricePaise
  );

  const boundedNextPaise = Math.max(
    minBandPaise,
    Math.min(maxBandPaise, candidatePaise)
  );

  const finalPaise = Math.max(1, minPricePaise, boundedNextPaise);
  if (!isPositiveSafeIntegerPaise(finalPaise)) {
    throw new MarketSimulationError(
      "PRICE_INVARIANT_VIOLATION",
      `Computed nextLastPricePaise (${finalPaise}) violated positive safe integer invariant.`
    );
  }

  return Object.freeze({
    nextLastPricePaise: finalPaise,
    appliedMoveBps: clampedMoveBps === 0 ? 0 : clampedMoveBps,
    rawUnclampedBps: rawUnclampedBps === 0 ? 0 : rawUnclampedBps,
  });
}

export interface BidAskQuotePaise {
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
}

/**
 * Calculates controlled integer-paise `bidPricePaise` and `askPricePaise` around
 * `lastPricePaise`.
 *
 * Invariants guaranteed:
 * - `bidPricePaise >= 1`
 * - `askPricePaise >= 1`
 * - `bidPricePaise <= lastPricePaise <= askPricePaise`
 * - `bidPricePaise <= askPricePaise`
 * - All values are positive safe integers in paise.
 */
export function calculateBidAskQuotesPaise(
  lastPricePaise: number,
  spreadBps: number,
  tickSizePaise: number = DEFAULT_TICK_SIZE_PAISE
): BidAskQuotePaise {
  if (!isPositiveSafeIntegerPaise(lastPricePaise)) {
    throw new MarketSimulationError(
      "PRICE_INVARIANT_VIOLATION",
      `lastPricePaise (${String(lastPricePaise)}) must be a positive safe integer.`
    );
  }
  if (
    typeof spreadBps !== "number" ||
    !Number.isSafeInteger(spreadBps) ||
    spreadBps < 1 ||
    spreadBps > 1_000
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "spreadBps must be a safe integer between 1 and 1000."
    );
  }
  if (
    typeof tickSizePaise !== "number" ||
    !Number.isSafeInteger(tickSizePaise) ||
    tickSizePaise < 1
  ) {
    throw new MarketSimulationError(
      "INVALID_SIMULATION_CONFIG",
      "tickSizePaise must be a positive safe integer."
    );
  }

  const halfSpreadBps = Math.max(1, Math.round(spreadBps / 2));
  const rawHalfSpreadBigInt = divideBigIntHalfUp(
    BigInt(lastPricePaise) * BigInt(halfSpreadBps),
    BPS_DENOM_BIGINT
  );
  const rawHalfSpreadPaise = Number(rawHalfSpreadBigInt);

  let halfSpreadPaise: number;
  if (lastPricePaise >= 100 && tickSizePaise > 1) {
    const halfTick = Math.floor(tickSizePaise / 2);
    const roundedToTick =
      Math.floor((rawHalfSpreadPaise + halfTick) / tickSizePaise) * tickSizePaise;
    halfSpreadPaise = Math.max(tickSizePaise, roundedToTick);
  } else if (lastPricePaise > 1) {
    halfSpreadPaise = Math.max(1, rawHalfSpreadPaise);
  } else {
    halfSpreadPaise = 0;
  }

  // Ensure bidPricePaise stays strictly >= 1
  const safeHalfBid = Math.min(halfSpreadPaise, lastPricePaise - 1);
  const bidPricePaise = Math.max(1, lastPricePaise - safeHalfBid);
  const askPricePaise = safeAddPaise(
    lastPricePaise,
    halfSpreadPaise,
    "askPricePaise"
  );

  if (
    !isPositiveSafeIntegerPaise(bidPricePaise) ||
    !isPositiveSafeIntegerPaise(askPricePaise) ||
    bidPricePaise > askPricePaise
  ) {
    throw new MarketSimulationError(
      "PRICE_INVARIANT_VIOLATION",
      `Invalid computed spread: bid=${bidPricePaise}, ask=${askPricePaise}.`
    );
  }

  return Object.freeze({
    bidPricePaise,
    askPricePaise,
  });
}

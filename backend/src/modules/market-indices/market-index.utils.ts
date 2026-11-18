import { Types } from "mongoose";
import { InstrumentExchange } from "../instruments/instrument.types";
import { SYNTHETIC_MARKET_INDEX_DEFINITIONS } from "./market-index.config";
import {
  IMarketIndex,
  IMarketIndexConstituent,
  MARKET_INDEX_METHODOLOGY,
  MarketIndexError,
  MarketIndexSymbol,
  SIMULATED_MARKET_INDEX_SOURCE,
  TOTAL_INDEX_WEIGHT_BPS,
} from "./market-index.types";

const BIGINT_PRECISION_SCALE = 1_000_000_000_000n; // 10^12
const BIGINT_TOTAL_WEIGHT_BPS = BigInt(TOTAL_INDEX_WEIGHT_BPS); // 10,000n
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Normalizes user/API input into a canonical `MarketIndexSymbol` ("NIFTY50" | "SENSEX").
 */
export function normalizeMarketIndexSymbol(raw: unknown): MarketIndexSymbol {
  if (typeof raw !== "string") {
    throw new MarketIndexError(
      "INVALID_INDEX_SYMBOL",
      "Market index symbol must be a string."
    );
  }

  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");

  if (compact === "NIFTY50" || compact === "NIFTY") {
    return "NIFTY50";
  }

  if (compact === "SENSEX" || compact === "BSESENSEX") {
    return "SENSEX";
  }

  throw new MarketIndexError(
    "INVALID_INDEX_SYMBOL",
    `Unsupported market index symbol: '${raw}'. Supported symbols: NIFTY50, SENSEX.`
  );
}

/**
 * Deterministically distributes 10,000 basis points across `constituentCount`
 * constituents as equally as possible:
 * - First `remainder` constituents receive `floor(10000 / N) + 1` bps.
 * - Remaining constituents receive `floor(10000 / N)` bps.
 * Total sum is guaranteed to equal exactly 10,000 bps.
 */
export function computeEqualConstituentWeightsBps(
  constituentCount: number
): number[] {
  if (
    typeof constituentCount !== "number" ||
    !Number.isSafeInteger(constituentCount) ||
    constituentCount < 1 ||
    constituentCount > TOTAL_INDEX_WEIGHT_BPS
  ) {
    throw new MarketIndexError(
      "INVALID_INDEX_CONSTITUENTS",
      `constituentCount must be a safe integer between 1 and ${TOTAL_INDEX_WEIGHT_BPS} (received ${String(
        constituentCount
      )}).`
    );
  }

  const baseWeight = Math.floor(TOTAL_INDEX_WEIGHT_BPS / constituentCount);
  const remainder = TOTAL_INDEX_WEIGHT_BPS - baseWeight * constituentCount;

  const weights: number[] = [];
  for (let i = 0; i < constituentCount; i++) {
    weights.push(i < remainder ? baseWeight + 1 : baseWeight);
  }

  return weights;
}

export type ConstituentCalculationInput = Pick<
  IMarketIndexConstituent,
  "instrumentId" | "symbol" | "weightBps" | "basePricePaise"
>;

function lookupConstituentPricePaise(
  constituent: ConstituentCalculationInput,
  priceLookup: ReadonlyMap<string, number> | Readonly<Record<string, number>>
): number {
  const idKey = String(constituent.instrumentId);
  const symbolKey = constituent.symbol.toUpperCase();

  let foundPrice: number | undefined;
  if (priceLookup instanceof Map) {
    foundPrice = priceLookup.get(idKey) ?? priceLookup.get(symbolKey);
  } else {
    const record = priceLookup as Readonly<Record<string, number>>;
    foundPrice = record[idKey] ?? record[symbolKey];
  }

  if (foundPrice === undefined) {
    throw new MarketIndexError(
      "MISSING_CONSTITUENT_PRICE",
      `Missing constituent price for symbol '${constituent.symbol}' (instrumentId: ${idKey}).`
    );
  }

  if (
    typeof foundPrice !== "number" ||
    !Number.isSafeInteger(foundPrice) ||
    foundPrice < 1
  ) {
    throw new MarketIndexError(
      "INVALID_CONSTITUENT_PRICE",
      `Constituent price for '${constituent.symbol}' must be a positive safe integer in paise (received ${String(
        foundPrice
      )}).`
    );
  }

  return foundPrice;
}

/**
 * Calculates a synthetic market index value in fixed-point units (hundredths of an index point)
 * from its constituent equity prices using `BigInt` scaled arithmetic:
 *
 *   IndexValue = round( baseValue * sum( weightBps_i * (currentPricePaise_i / basePricePaise_i) ) / 10_000 )
 *
 * Guarantees:
 * - Zero floating-point drift.
 * - Exact identity (`IndexValue === baseValue`) when all constituents are at their `basePricePaise`.
 * - Rejects missing constituents, zero/negative base or current prices, or invalid weights.
 */
export function calculateSyntheticIndexValue(
  baseValue: number,
  constituents: ReadonlyArray<ConstituentCalculationInput>,
  priceLookup: ReadonlyMap<string, number> | Readonly<Record<string, number>>
): number {
  if (
    typeof baseValue !== "number" ||
    !Number.isSafeInteger(baseValue) ||
    baseValue < 1
  ) {
    throw new MarketIndexError(
      "INVALID_INDEX_VALUE",
      `Index baseValue must be a positive safe integer in fixed-point units (received ${String(
        baseValue
      )}).`
    );
  }

  if (!Array.isArray(constituents) || constituents.length === 0) {
    throw new MarketIndexError(
      "INVALID_INDEX_CONSTITUENTS",
      "constituents array must not be empty."
    );
  }

  let totalWeightBps = 0;
  let totalScaledWeightedRatio = 0n;
  const seenIds = new Set<string>();
  const seenSymbols = new Set<string>();

  for (const constituent of constituents) {
    if (!constituent || !constituent.instrumentId || !constituent.symbol) {
      throw new MarketIndexError(
        "INVALID_INDEX_CONSTITUENTS",
        "Each constituent must include instrumentId and symbol."
      );
    }

    const idKey = String(constituent.instrumentId);
    const symKey = constituent.symbol.toUpperCase();
    if (seenIds.has(idKey) || seenSymbols.has(symKey)) {
      throw new MarketIndexError(
        "INVALID_INDEX_CONSTITUENTS",
        `Duplicate constituent detected in index calculation: ${symKey} (${idKey}).`
      );
    }
    seenIds.add(idKey);
    seenSymbols.add(symKey);

    if (
      typeof constituent.weightBps !== "number" ||
      !Number.isSafeInteger(constituent.weightBps) ||
      constituent.weightBps < 1 ||
      constituent.weightBps > TOTAL_INDEX_WEIGHT_BPS
    ) {
      throw new MarketIndexError(
        "INVALID_INDEX_CONSTITUENTS",
        `Invalid weightBps (${String(constituent.weightBps)}) for constituent '${symKey}'.`
      );
    }

    if (
      typeof constituent.basePricePaise !== "number" ||
      !Number.isSafeInteger(constituent.basePricePaise) ||
      constituent.basePricePaise < 1
    ) {
      throw new MarketIndexError(
        "INVALID_CONSTITUENT_PRICE",
        `Invalid basePricePaise (${String(
          constituent.basePricePaise
        )}) for constituent '${symKey}'.`
      );
    }

    const currentPricePaise = lookupConstituentPricePaise(
      constituent,
      priceLookup
    );

    totalWeightBps += constituent.weightBps;

    const weightBig = BigInt(constituent.weightBps);
    const currentBig = BigInt(currentPricePaise);
    const basePriceBig = BigInt(constituent.basePricePaise);

    // Round individual constituent weighted ratio to nearest integer at 10^12 scale
    const termNumerator =
      weightBig * currentBig * BIGINT_PRECISION_SCALE + basePriceBig / 2n;
    const termScaled = termNumerator / basePriceBig;
    totalScaledWeightedRatio += termScaled;
  }

  if (totalWeightBps !== TOTAL_INDEX_WEIGHT_BPS) {
    throw new MarketIndexError(
      "INVALID_INDEX_CONSTITUENTS",
      `Constituent weightBps sum must equal ${TOTAL_INDEX_WEIGHT_BPS} bps (received ${totalWeightBps} bps).`
    );
  }

  const denominator = BIGINT_TOTAL_WEIGHT_BPS * BIGINT_PRECISION_SCALE;
  const numerator =
    BigInt(baseValue) * totalScaledWeightedRatio + denominator / 2n;
  const rawResult = numerator / denominator;
  const clampedResult = rawResult < 1n ? 1n : rawResult;

  if (clampedResult > MAX_SAFE_INTEGER_BIGINT) {
    throw new MarketIndexError(
      "INDEX_OVERFLOW",
      "Calculated synthetic index value exceeds Number.MAX_SAFE_INTEGER."
    );
  }

  return Number(clampedResult);
}

/**
 * Computes fixed-point change and basis-point change between `currentValue` and `previousCloseValue`.
 */
export function calculateIndexChangeMetrics(
  currentValue: number,
  previousCloseValue: number
): { changeValue: number; changeBps: number } {
  if (
    typeof currentValue !== "number" ||
    !Number.isSafeInteger(currentValue) ||
    currentValue < 1 ||
    typeof previousCloseValue !== "number" ||
    !Number.isSafeInteger(previousCloseValue) ||
    previousCloseValue < 1
  ) {
    throw new MarketIndexError(
      "INVALID_INDEX_VALUE",
      "currentValue and previousCloseValue must be positive safe integers."
    );
  }

  const changeValue = currentValue - previousCloseValue;
  const diffBig = BigInt(changeValue);
  const prevBig = BigInt(previousCloseValue);
  const scaledNumerator = diffBig * BIGINT_TOTAL_WEIGHT_BPS;

  const roundedBpsBig =
    scaledNumerator >= 0n
      ? (scaledNumerator + prevBig / 2n) / prevBig
      : (scaledNumerator - prevBig / 2n) / prevBig;

  return {
    changeValue,
    changeBps: Number(roundedBpsBig),
  };
}

export interface InstrumentForIndexSeed {
  readonly _id: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly lastPricePaise: number;
  readonly previousClosePaise: number;
}

export type MarketIndexSeedRecord = Omit<
  IMarketIndex,
  "createdAt" | "updatedAt"
>;

/**
 * Builds a complete `MarketIndexSeedRecord` for a given `MarketIndexSymbol` ("NIFTY50" | "SENSEX")
 * from the seeded NSE equity instruments.
 *
 * By default:
 * - Each constituent's `basePricePaise` is set from `basePriceBySymbol` if provided,
 *   or defaults to the instrument's `previousClosePaise`.
 * - `previousCloseValue` is computed at each constituent's `previousClosePaise`.
 * - `currentValue` is computed at each constituent's `lastPricePaise`.
 */
export function buildMarketIndexSeedRecord(
  indexSymbol: MarketIndexSymbol,
  instruments: ReadonlyArray<InstrumentForIndexSeed>,
  options?: {
    readonly valueUpdatedAt?: Date;
    readonly basePriceBySymbol?: ReadonlyMap<string, number>;
    readonly previousCloseValueOverride?: number;
  }
): MarketIndexSeedRecord {
  const definition = SYNTHETIC_MARKET_INDEX_DEFINITIONS[indexSymbol];
  const bySymbol = new Map<string, InstrumentForIndexSeed>();

  for (const inst of instruments) {
    bySymbol.set(inst.symbol.toUpperCase(), inst);
  }

  const sortedSymbols = [...definition.constituentSymbols].sort((a, b) =>
    a.localeCompare(b)
  );
  const weightsBps = computeEqualConstituentWeightsBps(sortedSymbols.length);

  const constituents: IMarketIndexConstituent[] = [];
  const currentPriceLookup = new Map<string, number>();
  const prevCloseLookup = new Map<string, number>();

  for (let i = 0; i < sortedSymbols.length; i++) {
    const sym = sortedSymbols[i];
    const instrument = bySymbol.get(sym);
    if (!instrument) {
      throw new MarketIndexError(
        "MISSING_CONSTITUENT_PRICE",
        `Cannot build index '${indexSymbol}': required constituent symbol '${sym}' was not found in instruments.`
      );
    }

    const basePricePaise =
      options?.basePriceBySymbol?.get(sym) ?? instrument.previousClosePaise;

    constituents.push({
      instrumentId: instrument._id,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      weightBps: weightsBps[i],
      basePricePaise,
    });

    currentPriceLookup.set(String(instrument._id), instrument.lastPricePaise);
    currentPriceLookup.set(instrument.symbol, instrument.lastPricePaise);

    prevCloseLookup.set(String(instrument._id), instrument.previousClosePaise);
    prevCloseLookup.set(instrument.symbol, instrument.previousClosePaise);
  }

  const currentValue = calculateSyntheticIndexValue(
    definition.baseValue,
    constituents,
    currentPriceLookup
  );

  const previousCloseValue =
    options?.previousCloseValueOverride ??
    calculateSyntheticIndexValue(
      definition.baseValue,
      constituents,
      prevCloseLookup
    );

  return {
    symbol: definition.symbol,
    name: definition.name,
    description: definition.description,
    currentValue,
    baseValue: definition.baseValue,
    previousCloseValue,
    constituents,
    methodology: MARKET_INDEX_METHODOLOGY,
    source: SIMULATED_MARKET_INDEX_SOURCE,
    valueUpdatedAt: options?.valueUpdatedAt
      ? new Date(options.valueUpdatedAt.getTime())
      : new Date(),
  };
}

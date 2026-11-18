import { HydratedDocument, Model, Types } from "mongoose";
import { InstrumentExchange } from "../instruments/instrument.types";

/**
 * Canonical synthetic market index symbols supported by NIVORA.
 */
export const MARKET_INDEX_SYMBOLS = ["NIFTY50", "SENSEX"] as const;

export type MarketIndexSymbol = (typeof MARKET_INDEX_SYMBOLS)[number];

/**
 * Fixed-point scale factor for synthetic index values:
 * 100 fixed-point integer units = 1.00 index point.
 * Example: 24,000.75 index points = 2,400,075 fixed-point units.
 */
export const FIXED_POINT_INDEX_MULTIPLIER = 100 as const;

/**
 * Total constituent weights in basis points (100.00% = 10,000 bps).
 */
export const TOTAL_INDEX_WEIGHT_BPS = 10_000 as const;

export const MARKET_INDEX_METHODOLOGY =
  "EQUAL_WEIGHTED_CONSTITUENT_BASKET" as const;

export type MarketIndexMethodology = typeof MARKET_INDEX_METHODOLOGY;

export const SIMULATED_MARKET_INDEX_SOURCE = "SIMULATED" as const;

export type MarketIndexSource = typeof SIMULATED_MARKET_INDEX_SOURCE;

/**
 * Constituent equity reference and weight inside a synthetic market index.
 */
export interface IMarketIndexConstituent {
  instrumentId: Types.ObjectId;
  symbol: string;
  exchange: InstrumentExchange;
  weightBps: number;
  basePricePaise: number;
}

/**
 * Persisted Synthetic Market Index document (`market_indices`).
 *
 * Architectural Separation:
 * Synthetic market indices are read-only indicators derived from their constituent
 * equities and are strictly separate from tradable instruments (`instruments`).
 */
export interface IMarketIndex {
  symbol: MarketIndexSymbol;
  name: string;
  description: string;
  currentValue: number;
  baseValue: number;
  previousCloseValue: number;
  constituents: IMarketIndexConstituent[];
  methodology: MarketIndexMethodology;
  source: MarketIndexSource;
  valueUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type MarketIndexDocument = HydratedDocument<IMarketIndex>;

export type MarketIndexModelType = Model<IMarketIndex>;

export type MarketIndexErrorCode =
  | "INVALID_INDEX_SYMBOL"
  | "INVALID_INDEX_VALUE"
  | "INVALID_INDEX_CONSTITUENTS"
  | "MISSING_CONSTITUENT_PRICE"
  | "INVALID_CONSTITUENT_PRICE"
  | "INDEX_OVERFLOW";

export class MarketIndexError extends Error {
  public readonly code: MarketIndexErrorCode;

  constructor(code: MarketIndexErrorCode, message: string) {
    super(message);
    this.name = "MarketIndexError";
    this.code = code;
    Object.setPrototypeOf(this, MarketIndexError.prototype);
  }
}

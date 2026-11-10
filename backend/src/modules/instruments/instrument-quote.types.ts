import { ClientSession, Types } from "mongoose";
import { ITradeQuoteSnapshot, TradeSide } from "../trades/trade.types";
import { InstrumentExchange } from "./instrument.types";

export const QUOTE_SOURCES = ["SIMULATED"] as const;

export type QuoteSource = (typeof QUOTE_SOURCES)[number];

export const SIMULATED_QUOTE_SOURCE: QuoteSource = "SIMULATED";

export const INSTRUMENT_QUOTE_ERROR_CODES = [
  "INVALID_INSTRUMENT_ID",
  "INSTRUMENT_NOT_FOUND",
  "INSTRUMENT_UNAVAILABLE",
  "INVALID_QUOTE_DATA",
  "STALE_QUOTE",
  "INVALID_FRESHNESS_POLICY",
] as const;

export type InstrumentQuoteErrorCode =
  (typeof INSTRUMENT_QUOTE_ERROR_CODES)[number];

export class InstrumentQuoteError extends Error {
  public readonly code: InstrumentQuoteErrorCode;

  constructor(code: InstrumentQuoteErrorCode, message: string) {
    super(message);
    this.name = "InstrumentQuoteError";
    this.code = code;
    Object.setPrototypeOf(this, InstrumentQuoteError.prototype);
  }
}

/**
 * Strongly typed server-authoritative simulated quote snapshot.
 * Explicitly identifies `quoteSource` as `"SIMULATED"`.
 */
export interface InstrumentQuoteSnapshot {
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly isTradable: boolean;
  readonly lastPricePaise: number;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly previousClosePaise: number;
  readonly priceUpdatedAt: Date;
  readonly quoteSource: QuoteSource;
  readonly quoteAgeMs: number;
  readonly isStale: boolean;
}

/**
 * Validated executable quote resolved for a specific trade side (`BUY` -> ask, `SELL` -> bid).
 */
export interface ExecutableInstrumentQuote {
  readonly snapshot: InstrumentQuoteSnapshot;
  readonly side: TradeSide;
  readonly executionPricePaise: number;
  readonly tradeQuoteSnapshot: ITradeQuoteSnapshot;
}

export interface QuoteFreshnessPolicy {
  /**
   * Maximum permitted age of `priceUpdatedAt` relative to the evaluation timestamp,
   * in non-negative integer milliseconds.
   */
  readonly maxQuoteAgeMs: number;
  /**
   * Maximum tolerated clock skew if `priceUpdatedAt` is slightly ahead of the
   * evaluation timestamp, in non-negative integer milliseconds (defaults to 0).
   */
  readonly maxFutureSkewMs?: number;
}

export interface ValidateQuoteOptions {
  readonly now?: Date;
  readonly maxQuoteAgeMs?: number;
  readonly maxFutureSkewMs?: number;
  readonly requireTradable?: boolean;
  readonly requireFresh?: boolean;
}

export interface GetInstrumentQuoteOptions extends ValidateQuoteOptions {
  readonly session?: ClientSession;
}

export interface PersistedInstrumentQuoteRecord {
  readonly _id: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly isTradable: boolean;
  readonly lastPricePaise: number;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly previousClosePaise?: number;
  readonly priceUpdatedAt: Date;
}

export interface InstrumentQuoteLookupPort {
  findById(
    instrumentId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedInstrumentQuoteRecord | null>;
}

export interface InstrumentQuoteServiceOptions {
  readonly repository?: InstrumentQuoteLookupPort;
  readonly nowProvider?: () => Date;
  readonly defaultMaxQuoteAgeMs?: number;
  readonly defaultMaxFutureSkewMs?: number;
}

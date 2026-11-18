import { FilterQuery, Types } from "mongoose";
import { InstrumentModel } from "../instruments/instrument.model";
import { MarketCandleModel } from "../market-candles/market-candle.model";
import { MarketIndexCandleModel } from "../market-candles/market-index-candle.model";
import {
  CandleInterval,
  IMarketCandle,
  IMarketIndexCandle,
  MarketCandleError,
  SIMULATED_CANDLE_SOURCE,
} from "../market-candles/market-candle.types";
import {
  aggregateEquityCandlesToInterval,
  aggregateIndexCandlesToInterval,
  assertValidCandleInterval,
  getCandleTimeBucket,
} from "../market-candles/market-candle.utils";
import { MarketIndexModel } from "./market-index.model";
import {
  IMarketIndex,
  IMarketIndexConstituent,
  MarketIndexError,
  MarketIndexMethodology,
  MarketIndexSource,
  MarketIndexSymbol,
} from "./market-index.types";
import {
  calculateIndexChangeMetrics,
  normalizeMarketIndexSymbol,
} from "./market-index.utils";

export const DEFAULT_CANDLE_QUERY_LIMIT = 100 as const;
export const MAX_CANDLE_QUERY_LIMIT = 500 as const;
export const DEFAULT_CANDLE_INTERVAL: CandleInterval = "1d";

const ROLLUP_SOURCE_MULTIPLIER: Readonly<Record<CandleInterval, number>> =
  Object.freeze({
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
    "1d": 1,
  });

export type MarketDataErrorCode =
  | "INVALID_INDEX_SYMBOL"
  | "MARKET_INDEX_NOT_FOUND"
  | "INVALID_INSTRUMENT_ID"
  | "INSTRUMENT_NOT_FOUND"
  | "INVALID_CANDLE_INTERVAL"
  | "INVALID_DATE_RANGE"
  | "INVALID_PAGINATION_LIMIT";

export class MarketDataServiceError extends Error {
  public readonly code: MarketDataErrorCode;
  public readonly statusCode: number;

  constructor(code: MarketDataErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = "MarketDataServiceError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, MarketDataServiceError.prototype);
  }
}

export interface MarketIndexSummaryView {
  readonly _id: Types.ObjectId;
  readonly symbol: MarketIndexSymbol;
  readonly name: string;
  readonly description: string;
  readonly currentValue: number;
  readonly baseValue: number;
  readonly previousCloseValue: number;
  readonly changeValue: number;
  readonly changeBps: number;
  readonly constituentCount: number;
  readonly methodology: MarketIndexMethodology;
  readonly source: MarketIndexSource;
  readonly valueUpdatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MarketIndexDetailView extends MarketIndexSummaryView {
  readonly constituents: readonly IMarketIndexConstituent[];
}

export interface EquityCandleView {
  readonly instrumentId: Types.ObjectId;
  readonly interval: CandleInterval;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly openPaise: number;
  readonly highPaise: number;
  readonly lowPaise: number;
  readonly closePaise: number;
  readonly source: typeof SIMULATED_CANDLE_SOURCE;
}

export interface MarketIndexCandleView {
  readonly indexId: Types.ObjectId;
  readonly interval: CandleInterval;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly openValue: number;
  readonly highValue: number;
  readonly lowValue: number;
  readonly closeValue: number;
  readonly source: typeof SIMULATED_CANDLE_SOURCE;
}

export interface CandleQueryOptions {
  readonly interval?: CandleInterval;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
}

function normalizeCandleQueryOptions(options?: CandleQueryOptions): {
  interval: CandleInterval;
  from?: Date;
  to?: Date;
  limit: number;
} {
  let interval: CandleInterval = DEFAULT_CANDLE_INTERVAL;
  if (options?.interval !== undefined) {
    try {
      interval = assertValidCandleInterval(options.interval);
    } catch (err: unknown) {
      throw new MarketDataServiceError(
        "INVALID_CANDLE_INTERVAL",
        400,
        err instanceof Error ? err.message : "Invalid candle interval."
      );
    }
  }

  let limit: number = DEFAULT_CANDLE_QUERY_LIMIT;
  if (options?.limit !== undefined) {
    if (
      typeof options.limit !== "number" ||
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_CANDLE_QUERY_LIMIT
    ) {
      throw new MarketDataServiceError(
        "INVALID_PAGINATION_LIMIT",
        400,
        `limit must be an integer between 1 and ${MAX_CANDLE_QUERY_LIMIT}.`
      );
    }
    limit = options.limit;
  }

  const from = options?.from;
  const to = options?.to;

  if (from !== undefined && (!(from instanceof Date) || Number.isNaN(from.getTime()))) {
    throw new MarketDataServiceError(
      "INVALID_DATE_RANGE",
      400,
      "from must be a valid ISO-8601 date/timestamp."
    );
  }

  if (to !== undefined && (!(to instanceof Date) || Number.isNaN(to.getTime()))) {
    throw new MarketDataServiceError(
      "INVALID_DATE_RANGE",
      400,
      "to must be a valid ISO-8601 date/timestamp."
    );
  }

  if (from && to && from.getTime() > to.getTime()) {
    throw new MarketDataServiceError(
      "INVALID_DATE_RANGE",
      400,
      "from timestamp must be less than or equal to to timestamp."
    );
  }

  return { interval, from, to, limit };
}

function toMarketIndexSummaryView(
  doc: IMarketIndex & { _id: Types.ObjectId }
): MarketIndexSummaryView {
  const { changeValue, changeBps } = calculateIndexChangeMetrics(
    doc.currentValue,
    doc.previousCloseValue
  );

  return {
    _id: doc._id,
    symbol: doc.symbol,
    name: doc.name,
    description: doc.description,
    currentValue: doc.currentValue,
    baseValue: doc.baseValue,
    previousCloseValue: doc.previousCloseValue,
    changeValue,
    changeBps,
    constituentCount: Array.isArray(doc.constituents)
      ? doc.constituents.length
      : 0,
    methodology: doc.methodology,
    source: doc.source,
    valueUpdatedAt: doc.valueUpdatedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Read-only query service for NIVORA synthetic market indices and historical/live OHLC candles.
 */
export class MarketDataService {
  /**
   * Lists all synthetic market indices (`NIFTY50`, `SENSEX`) sorted by symbol.
   */
  public async listMarketIndices(): Promise<MarketIndexSummaryView[]> {
    const docs = await MarketIndexModel.find({})
      .sort({ symbol: 1 })
      .lean<Array<IMarketIndex & { _id: Types.ObjectId }>>()
      .exec();

    return docs.map(toMarketIndexSummaryView);
  }

  /**
   * Retrieves a single synthetic market index with full constituent breakdown.
   */
  public async getMarketIndexBySymbol(
    rawSymbol: string
  ): Promise<MarketIndexDetailView> {
    let symbol: MarketIndexSymbol;
    try {
      symbol = normalizeMarketIndexSymbol(rawSymbol);
    } catch (err: unknown) {
      throw new MarketDataServiceError(
        "INVALID_INDEX_SYMBOL",
        400,
        err instanceof MarketIndexError
          ? err.message
          : `Unsupported market index symbol: ${String(rawSymbol)}.`
      );
    }

    const doc = await MarketIndexModel.findOne({ symbol })
      .lean<IMarketIndex & { _id: Types.ObjectId }>()
      .exec();

    if (!doc) {
      throw new MarketDataServiceError(
        "MARKET_INDEX_NOT_FOUND",
        404,
        `Market index '${symbol}' was not found.`
      );
    }

    const summary = toMarketIndexSummaryView(doc);
    return {
      ...summary,
      constituents: doc.constituents,
    };
  }

  /**
   * Retrieves historical OHLC candles for a synthetic market index in chronological
   * ascending order (`openTime` ascending).
   *
   * Supports `"1m"`, `"5m"`, `"15m"`, `"1h"`, and `"1d"`.
   * For `"5m"`, `"15m"`, and `"1h"`, automatically rolls up from persisted `"1m"` candles
   * if direct interval documents are not persisted.
   */
  public async getMarketIndexCandles(
    rawSymbol: string,
    queryOptions?: CandleQueryOptions
  ): Promise<{
    index: MarketIndexSummaryView;
    interval: CandleInterval;
    candles: MarketIndexCandleView[];
  }> {
    const indexDetail = await this.getMarketIndexBySymbol(rawSymbol);
    const { interval, from, to, limit } =
      normalizeCandleQueryOptions(queryOptions);

    if (interval === "1m" || interval === "1d") {
      const filter: FilterQuery<IMarketIndexCandle> = {
        indexId: indexDetail._id,
        interval,
      };
      if (from || to) {
        filter.openTime = {};
        if (from) {
          // For daily queries, snap `from` to its Asia/Kolkata 00:00 IST bucket openTime
          // (`18:30Z` previous UTC day) so timestamps within an IST trading day aren't missed.
          filter.openTime.$gte =
            interval === "1d"
              ? getCandleTimeBucket(from, "1d").openTime
              : from;
        }
        if (to) {
          filter.openTime.$lte = to;
        }
      }

      const docs = await MarketIndexCandleModel.find(filter)
        .sort({ openTime: -1 })
        .limit(limit)
        .lean<IMarketIndexCandle[]>()
        .exec();

      const chronological = docs.reverse().map((c) => ({
        indexId: c.indexId,
        interval: c.interval,
        openTime: c.openTime,
        closeTime: c.closeTime,
        openValue: c.openValue,
        highValue: c.highValue,
        lowValue: c.lowValue,
        closeValue: c.closeValue,
        source: SIMULATED_CANDLE_SOURCE,
      }));

      const { constituents: _constituents, ...summary } = indexDetail;
      return {
        index: summary,
        interval,
        candles: chronological,
      };
    }

    // Derived intraday interval ("5m", "15m", "1h"): aggregate from "1m" candles
    const multiplier = ROLLUP_SOURCE_MULTIPLIER[interval];
    const sourceFilter: FilterQuery<IMarketIndexCandle> = {
      indexId: indexDetail._id,
      interval: "1m",
    };

    if (from || to) {
      sourceFilter.openTime = {};
      if (from) {
        // Align start to the target interval bucket openTime so the first bucket is complete
        const alignedFromBucket = getCandleTimeBucket(from, interval);
        sourceFilter.openTime.$gte = alignedFromBucket.openTime;
      }
      if (to) {
        const alignedToBucket = getCandleTimeBucket(to, interval);
        sourceFilter.openTime.$lt = alignedToBucket.closeTime;
      }
    }

    const maxSourceDocs = (limit + 2) * multiplier;
    const oneMinuteDocs = await MarketIndexCandleModel.find(sourceFilter)
      .sort({ openTime: -1 })
      .limit(maxSourceDocs)
      .lean<IMarketIndexCandle[]>()
      .exec();

    let aggregated = aggregateIndexCandlesToInterval(oneMinuteDocs, interval);
    if (from) {
      const alignedFromMs = getCandleTimeBucket(from, interval).openTime.getTime();
      aggregated = aggregated.filter(
        (c) => c.openTime.getTime() >= alignedFromMs
      );
    }
    if (to) {
      aggregated = aggregated.filter(
        (c) => c.openTime.getTime() <= to.getTime()
      );
    }

    const sliced = aggregated.slice(-limit);
    const { constituents: _constituents, ...summary } = indexDetail;

    return {
      index: summary,
      interval,
      candles: sliced,
    };
  }

  /**
   * Retrieves historical OHLC candles for a tradable equity instrument in chronological
   * ascending order (`openTime` ascending).
   *
   * Supports `"1m"`, `"5m"`, `"15m"`, `"1h"`, and `"1d"`.
   */
  public async getInstrumentCandles(
    rawInstrumentId: string | Types.ObjectId,
    queryOptions?: CandleQueryOptions
  ): Promise<{
    instrument: {
      _id: Types.ObjectId;
      symbol: string;
      name: string;
      exchange: string;
    };
    interval: CandleInterval;
    candles: EquityCandleView[];
  }> {
    let instrumentObjectId: Types.ObjectId;
    if (rawInstrumentId instanceof Types.ObjectId) {
      instrumentObjectId = rawInstrumentId;
    } else if (
      typeof rawInstrumentId === "string" &&
      Types.ObjectId.isValid(rawInstrumentId.trim()) &&
      new Types.ObjectId(rawInstrumentId.trim()).toString() ===
        rawInstrumentId.trim()
    ) {
      instrumentObjectId = new Types.ObjectId(rawInstrumentId.trim());
    } else {
      throw new MarketDataServiceError(
        "INVALID_INSTRUMENT_ID",
        400,
        "instrumentId must be a valid 24-character hex MongoDB ObjectId."
      );
    }

    const { interval, from, to, limit } =
      normalizeCandleQueryOptions(queryOptions);

    const instrument = await InstrumentModel.findById(instrumentObjectId)
      .select({ _id: 1, symbol: 1, name: 1, exchange: 1 })
      .lean<{
        _id: Types.ObjectId;
        symbol: string;
        name: string;
        exchange: string;
      }>()
      .exec();

    if (!instrument) {
      throw new MarketDataServiceError(
        "INSTRUMENT_NOT_FOUND",
        404,
        `Instrument ${instrumentObjectId.toString()} was not found.`
      );
    }

    if (interval === "1m" || interval === "1d") {
      const filter: FilterQuery<IMarketCandle> = {
        instrumentId: instrumentObjectId,
        interval,
      };
      if (from || to) {
        filter.openTime = {};
        if (from) {
          // For daily queries, snap `from` to its Asia/Kolkata 00:00 IST bucket openTime
          // (`18:30Z` previous UTC day) so timestamps within an IST trading day aren't missed.
          filter.openTime.$gte =
            interval === "1d"
              ? getCandleTimeBucket(from, "1d").openTime
              : from;
        }
        if (to) {
          filter.openTime.$lte = to;
        }
      }

      const docs = await MarketCandleModel.find(filter)
        .sort({ openTime: -1 })
        .limit(limit)
        .lean<IMarketCandle[]>()
        .exec();

      const chronological = docs.reverse().map((c) => ({
        instrumentId: c.instrumentId,
        interval: c.interval,
        openTime: c.openTime,
        closeTime: c.closeTime,
        openPaise: c.openPaise,
        highPaise: c.highPaise,
        lowPaise: c.lowPaise,
        closePaise: c.closePaise,
        source: SIMULATED_CANDLE_SOURCE,
      }));

      return {
        instrument,
        interval,
        candles: chronological,
      };
    }

    // Derived intraday interval ("5m", "15m", "1h"): aggregate from "1m" candles
    const multiplier = ROLLUP_SOURCE_MULTIPLIER[interval];
    const sourceFilter: FilterQuery<IMarketCandle> = {
      instrumentId: instrumentObjectId,
      interval: "1m",
    };

    if (from || to) {
      sourceFilter.openTime = {};
      if (from) {
        const alignedFromBucket = getCandleTimeBucket(from, interval);
        sourceFilter.openTime.$gte = alignedFromBucket.openTime;
      }
      if (to) {
        const alignedToBucket = getCandleTimeBucket(to, interval);
        sourceFilter.openTime.$lt = alignedToBucket.closeTime;
      }
    }

    const maxSourceDocs = (limit + 2) * multiplier;
    const oneMinuteDocs = await MarketCandleModel.find(sourceFilter)
      .sort({ openTime: -1 })
      .limit(maxSourceDocs)
      .lean<IMarketCandle[]>()
      .exec();

    let aggregated: EquityCandleView[];
    try {
      aggregated = aggregateEquityCandlesToInterval(oneMinuteDocs, interval);
    } catch (err: unknown) {
      if (err instanceof MarketCandleError) {
        throw new MarketDataServiceError(
          "INVALID_CANDLE_INTERVAL",
          400,
          err.message
        );
      }
      throw err;
    }

    if (from) {
      const alignedFromMs = getCandleTimeBucket(from, interval).openTime.getTime();
      aggregated = aggregated.filter(
        (c) => c.openTime.getTime() >= alignedFromMs
      );
    }
    if (to) {
      aggregated = aggregated.filter(
        (c) => c.openTime.getTime() <= to.getTime()
      );
    }

    const sliced = aggregated.slice(-limit);

    return {
      instrument,
      interval,
      candles: sliced,
    };
  }
}

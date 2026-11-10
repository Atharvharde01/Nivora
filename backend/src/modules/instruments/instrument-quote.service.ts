import { ClientSession, Types } from "mongoose";
import { isPositiveSafeIntegerPaise } from "../../shared/finance/financial.utils";
import { TradeSide } from "../trades/trade.types";
import { InstrumentModel } from "./instrument.model";
import { isValidInstrumentSymbol } from "./instrument.schema";
import { INSTRUMENT_EXCHANGES, InstrumentExchange } from "./instrument.types";
import {
  ExecutableInstrumentQuote,
  GetInstrumentQuoteOptions,
  InstrumentQuoteError,
  InstrumentQuoteLookupPort,
  InstrumentQuoteServiceOptions,
  InstrumentQuoteSnapshot,
  PersistedInstrumentQuoteRecord,
  SIMULATED_QUOTE_SOURCE,
  ValidateQuoteOptions,
} from "./instrument-quote.types";

export const SECONDS_PER_MINUTE = 60;
export const MILLISECONDS_PER_SECOND = 1_000;
export const MILLISECONDS_PER_MINUTE =
  SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/**
 * Default maximum quote age when not overridden by caller/configuration:
 * 15 minutes (900,000 ms).
 */
export const DEFAULT_QUOTE_MAX_AGE_MINUTES = 15;
export const DEFAULT_SIMULATED_QUOTE_MAX_AGE_MS =
  DEFAULT_QUOTE_MAX_AGE_MINUTES * MILLISECONDS_PER_MINUTE;

/**
 * Default maximum future clock skew tolerance: 0 ms.
 */
export const DEFAULT_MAX_FUTURE_CLOCK_SKEW_MS = 0;

function isValidDateInstance(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function assertValidMillisecondsThreshold(
  value: unknown,
  fieldName: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new InstrumentQuoteError(
      "INVALID_FRESHNESS_POLICY",
      `${fieldName} must be a non-negative safe integer in milliseconds.`
    );
  }
  return value;
}

function resolveObjectId(rawInstrumentId: Types.ObjectId | string): Types.ObjectId {
  if (rawInstrumentId instanceof Types.ObjectId) {
    return rawInstrumentId;
  }
  if (
    typeof rawInstrumentId === "string" &&
    Types.ObjectId.isValid(rawInstrumentId) &&
    new Types.ObjectId(rawInstrumentId).toString() === rawInstrumentId.trim()
  ) {
    return new Types.ObjectId(rawInstrumentId.trim());
  }
  throw new InstrumentQuoteError(
    "INVALID_INSTRUMENT_ID",
    "instrumentId must be a valid MongoDB ObjectId."
  );
}

/**
 * Default Mongoose-backed lookup adapter for `InstrumentModel`.
 * Performs a read-only `.lean()` query and never mutates persisted quote fields.
 */
export class MongooseInstrumentQuoteRepository
  implements InstrumentQuoteLookupPort
{
  public async findById(
    instrumentId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedInstrumentQuoteRecord | null> {
    const query = InstrumentModel.findById(instrumentId).select(
      "_id symbol exchange isTradable lastPricePaise bidPricePaise askPricePaise previousClosePaise priceUpdatedAt"
    );

    if (options?.session) {
      query.session(options.session);
    }

    const doc = await query.lean<PersistedInstrumentQuoteRecord>().exec();
    return doc ?? null;
  }
}

/**
 * Validates a persisted instrument record and produces an immutable, normalized
 * `InstrumentQuoteSnapshot` with `quoteSource: "SIMULATED"`.
 *
 * Never mutates the input record or fabricates fallback prices.
 */
export function validateInstrumentQuoteRecord(
  record: PersistedInstrumentQuoteRecord,
  options: ValidateQuoteOptions = {}
): InstrumentQuoteSnapshot {
  if (!record || !(record._id instanceof Types.ObjectId)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument record is missing a valid ObjectId."
    );
  }

  const normalizedSymbol =
    typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
  if (!isValidInstrumentSymbol(normalizedSymbol)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument symbol is invalid."
    );
  }

  const normalizedExchange =
    typeof record.exchange === "string"
      ? (record.exchange.trim().toUpperCase() as InstrumentExchange)
      : ("" as InstrumentExchange);
  if (
    !(INSTRUMENT_EXCHANGES as readonly string[]).includes(normalizedExchange)
  ) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument exchange must be 'NSE' or 'BSE'."
    );
  }

  if (typeof record.isTradable !== "boolean") {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument isTradable flag must be a boolean."
    );
  }

  if (!isPositiveSafeIntegerPaise(record.lastPricePaise)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument lastPricePaise must be a positive safe integer in paise."
    );
  }

  if (!isPositiveSafeIntegerPaise(record.bidPricePaise)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument bidPricePaise must be a positive safe integer in paise."
    );
  }

  if (!isPositiveSafeIntegerPaise(record.askPricePaise)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument askPricePaise must be a positive safe integer in paise."
    );
  }

  if (record.bidPricePaise > record.askPricePaise) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      `Instrument bidPricePaise (${record.bidPricePaise}) must not exceed askPricePaise (${record.askPricePaise}).`
    );
  }

  const previousClosePaise =
    record.previousClosePaise !== undefined
      ? record.previousClosePaise
      : record.lastPricePaise;
  if (!isPositiveSafeIntegerPaise(previousClosePaise)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument previousClosePaise must be a positive safe integer in paise."
    );
  }

  if (!isValidDateInstance(record.priceUpdatedAt)) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument priceUpdatedAt must be a valid Date."
    );
  }

  const evaluationNow = options.now ?? new Date();
  if (!isValidDateInstance(evaluationNow)) {
    throw new InstrumentQuoteError(
      "INVALID_FRESHNESS_POLICY",
      "Evaluation timestamp (now) must be a valid Date."
    );
  }

  const maxQuoteAgeMs = assertValidMillisecondsThreshold(
    options.maxQuoteAgeMs ?? DEFAULT_SIMULATED_QUOTE_MAX_AGE_MS,
    "maxQuoteAgeMs"
  );
  const maxFutureSkewMs = assertValidMillisecondsThreshold(
    options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_CLOCK_SKEW_MS,
    "maxFutureSkewMs"
  );

  const rawElapsedMs =
    evaluationNow.getTime() - record.priceUpdatedAt.getTime();
  if (rawElapsedMs < -maxFutureSkewMs) {
    throw new InstrumentQuoteError(
      "INVALID_QUOTE_DATA",
      "Instrument priceUpdatedAt timestamp cannot be in the future."
    );
  }

  const quoteAgeMs = Math.max(0, rawElapsedMs);
  const isStale = quoteAgeMs > maxQuoteAgeMs;

  if (options.requireTradable && !record.isTradable) {
    throw new InstrumentQuoteError(
      "INSTRUMENT_UNAVAILABLE",
      `Instrument ${normalizedSymbol} (${normalizedExchange}) is not currently tradable.`
    );
  }

  if (options.requireFresh && isStale) {
    throw new InstrumentQuoteError(
      "STALE_QUOTE",
      `Simulated quote for ${normalizedSymbol} (${normalizedExchange}) is stale (age ${quoteAgeMs}ms exceeds maxQuoteAgeMs ${maxQuoteAgeMs}ms).`
    );
  }

  return Object.freeze({
    instrumentId: new Types.ObjectId(record._id.toString()),
    symbol: normalizedSymbol,
    exchange: normalizedExchange,
    isTradable: record.isTradable,
    lastPricePaise: record.lastPricePaise,
    bidPricePaise: record.bidPricePaise,
    askPricePaise: record.askPricePaise,
    previousClosePaise,
    priceUpdatedAt: new Date(record.priceUpdatedAt.getTime()),
    quoteSource: SIMULATED_QUOTE_SOURCE,
    quoteAgeMs,
    isStale,
  });
}

/**
 * Server-authoritative Simulated Instrument Quote Service.
 *
 * Responsibilities:
 * - Retrieves persisted simulated quotes from the global `Instrument` catalog.
 * - Explicitly tags all returned quotes with `quoteSource: "SIMULATED"`.
 * - Enforces positive safe-integer paise validation, `bidPricePaise <= askPricePaise`,
 *   quote timestamp integrity, configurable staleness detection, and tradability checks.
 * - Never trusts client-supplied prices and never mutates `priceUpdatedAt` on read.
 */
export class InstrumentQuoteService {
  private readonly repository: InstrumentQuoteLookupPort;
  private readonly nowProvider: () => Date;
  private readonly defaultMaxQuoteAgeMs: number;
  private readonly defaultMaxFutureSkewMs: number;

  constructor(options: InstrumentQuoteServiceOptions = {}) {
    this.repository =
      options.repository ?? new MongooseInstrumentQuoteRepository();
    this.nowProvider = options.nowProvider ?? (() => new Date());
    this.defaultMaxQuoteAgeMs = assertValidMillisecondsThreshold(
      options.defaultMaxQuoteAgeMs ?? DEFAULT_SIMULATED_QUOTE_MAX_AGE_MS,
      "defaultMaxQuoteAgeMs"
    );
    this.defaultMaxFutureSkewMs = assertValidMillisecondsThreshold(
      options.defaultMaxFutureSkewMs ?? DEFAULT_MAX_FUTURE_CLOCK_SKEW_MS,
      "defaultMaxFutureSkewMs"
    );
  }

  /**
   * Retrieves and validates a simulated quote snapshot by instrument ID.
   */
  public async getQuoteByInstrumentId(
    instrumentId: Types.ObjectId | string,
    options: GetInstrumentQuoteOptions = {}
  ): Promise<InstrumentQuoteSnapshot> {
    const resolvedId = resolveObjectId(instrumentId);
    const record = await this.repository.findById(resolvedId, {
      session: options.session,
    });

    if (!record) {
      throw new InstrumentQuoteError(
        "INSTRUMENT_NOT_FOUND",
        `Instrument ${resolvedId.toString()} was not found.`
      );
    }

    return validateInstrumentQuoteRecord(record, {
      now: options.now ?? this.nowProvider(),
      maxQuoteAgeMs: options.maxQuoteAgeMs ?? this.defaultMaxQuoteAgeMs,
      maxFutureSkewMs: options.maxFutureSkewMs ?? this.defaultMaxFutureSkewMs,
      requireTradable: options.requireTradable,
      requireFresh: options.requireFresh,
    });
  }

  /**
   * Resolves a validated, tradable, fresh quote for market-order execution (`BUY` -> ask, `SELL` -> bid).
   * Enforces `requireTradable: true` and `requireFresh: true` by default.
   */
  public async getExecutableQuote(
    instrumentId: Types.ObjectId | string,
    side: TradeSide,
    options: GetInstrumentQuoteOptions = {}
  ): Promise<ExecutableInstrumentQuote> {
    if (side !== "BUY" && side !== "SELL") {
      throw new InstrumentQuoteError(
        "INVALID_QUOTE_DATA",
        "Trade side must be either 'BUY' or 'SELL'."
      );
    }

    const snapshot = await this.getQuoteByInstrumentId(instrumentId, {
      ...options,
      requireTradable: options.requireTradable ?? true,
      requireFresh: options.requireFresh ?? true,
    });

    const executionPricePaise =
      side === "BUY" ? snapshot.askPricePaise : snapshot.bidPricePaise;

    return Object.freeze({
      snapshot,
      side,
      executionPricePaise,
      tradeQuoteSnapshot: Object.freeze({
        lastPricePaise: snapshot.lastPricePaise,
        bidPricePaise: snapshot.bidPricePaise,
        askPricePaise: snapshot.askPricePaise,
        priceUpdatedAt: new Date(snapshot.priceUpdatedAt.getTime()),
      }),
    });
  }
}

import { Types } from "mongoose";
import {
  DEFAULT_MARKET_SIMULATION_ENGINE_CONFIG,
  getVolatilityProfileForSymbol,
} from "./market-simulation.config";
import {
  ClockProvider,
  MARKET_SENTIMENT_REGIMES,
  MarketSentimentRegime,
  MarketSimulationEngineConfig,
  MarketSimulationError,
  MarketSimulationTickComputation,
  RandomSource,
  SimulatableInstrumentRecord,
  SimulatedInstrumentQuoteUpdate,
  VolatilityProfileConfig,
} from "./market-simulation.types";
import {
  calculateBidAskQuotesPaise,
  calculateMarketEffectBps,
  calculateNextInstrumentPrice,
  calculateStockShockBps,
  selectNextSentimentRegime,
} from "./market-simulation.utils";

export interface MarketSimulationEngineOptions {
  readonly config?: Partial<MarketSimulationEngineConfig>;
  readonly randomSource?: RandomSource;
  readonly clockProvider?: ClockProvider;
  readonly initialSentiment?: MarketSentimentRegime;
  readonly volatilityResolver?: (symbol: string) => Readonly<VolatilityProfileConfig>;
}

export interface ComputeMarketTickOptions {
  readonly overrideSentiment?: MarketSentimentRegime;
  readonly now?: Date;
}

/**
 * Pure domain engine for computing synthetic equity market quote movements.
 *
 * Responsibilities:
 * - Manages shared market sentiment state (`BULLISH`, `BEARISH`, `SIDEWAYS`).
 * - Applies per-instrument volatility profiles (`LOW`, `MEDIUM`, `HIGH`).
 * - Enforces single-tick movement caps, `previousClosePaise` deviation guardrails,
 *   5-paise NSE tick rounding, and positive integer-paise bid/ask spread invariants.
 * - Skips non-tradable instruments (`isTradable === false`).
 * - Supports deterministic injection of `randomSource` and `clockProvider` for reproducible tests.
 */
export class MarketSimulationEngine {
  private readonly config: Readonly<MarketSimulationEngineConfig>;
  private readonly randomSource: RandomSource;
  private readonly clockProvider: ClockProvider;
  private readonly volatilityResolver: (
    symbol: string
  ) => Readonly<VolatilityProfileConfig>;
  private currentSentiment: MarketSentimentRegime;
  private tickCount = 0;

  constructor(options: MarketSimulationEngineOptions = {}) {
    const mergedConfig: MarketSimulationEngineConfig = {
      ...DEFAULT_MARKET_SIMULATION_ENGINE_CONFIG,
      ...options.config,
    };

    if (
      !Number.isSafeInteger(mergedConfig.maxMoveBps) ||
      mergedConfig.maxMoveBps < 1 ||
      mergedConfig.maxMoveBps > 5_000
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "maxMoveBps must be an integer between 1 and 5000."
      );
    }

    if (
      !Number.isSafeInteger(mergedConfig.maxDeviationFromPrevCloseBps) ||
      mergedConfig.maxDeviationFromPrevCloseBps < mergedConfig.maxMoveBps ||
      mergedConfig.maxDeviationFromPrevCloseBps >= 10_000
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        `maxDeviationFromPrevCloseBps must be between maxMoveBps (${mergedConfig.maxMoveBps}) and 9999.`
      );
    }

    if (
      !Number.isSafeInteger(mergedConfig.minPricePaise) ||
      mergedConfig.minPricePaise < 1
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "minPricePaise must be a positive safe integer >= 1."
      );
    }

    if (
      !Number.isSafeInteger(mergedConfig.tickSizePaise) ||
      mergedConfig.tickSizePaise < 1
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "tickSizePaise must be a positive safe integer >= 1."
      );
    }

    if (
      typeof mergedConfig.sentimentTransitionProbability !== "number" ||
      !Number.isFinite(mergedConfig.sentimentTransitionProbability) ||
      mergedConfig.sentimentTransitionProbability < 0 ||
      mergedConfig.sentimentTransitionProbability > 1
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "sentimentTransitionProbability must be between 0 and 1."
      );
    }

    const initialSentiment = options.initialSentiment ?? "SIDEWAYS";
    if (
      !(MARKET_SENTIMENT_REGIMES as readonly string[]).includes(initialSentiment)
    ) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        `Invalid initialSentiment: ${String(initialSentiment)}.`
      );
    }

    this.config = Object.freeze(mergedConfig);
    this.randomSource = options.randomSource ?? Math.random;
    this.clockProvider = options.clockProvider ?? (() => new Date());
    this.volatilityResolver =
      options.volatilityResolver ?? getVolatilityProfileForSymbol;
    this.currentSentiment = initialSentiment;
  }

  public getConfig(): Readonly<MarketSimulationEngineConfig> {
    return this.config;
  }

  public getCurrentSentiment(): MarketSentimentRegime {
    return this.currentSentiment;
  }

  public getTickCount(): number {
    return this.tickCount;
  }

  /**
   * Computes a full market tick across the provided instruments without performing I/O.
   */
  public computeTick(
    instruments: readonly SimulatableInstrumentRecord[],
    options: ComputeMarketTickOptions = {}
  ): MarketSimulationTickComputation {
    if (!Array.isArray(instruments)) {
      throw new MarketSimulationError(
        "INVALID_INSTRUMENT_STATE",
        "instruments must be an array."
      );
    }

    const timestamp = options.now ?? this.clockProvider();
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
      throw new MarketSimulationError(
        "INVALID_SIMULATION_CONFIG",
        "Tick timestamp must be a valid Date instance."
      );
    }

    if (options.overrideSentiment !== undefined) {
      if (
        !(MARKET_SENTIMENT_REGIMES as readonly string[]).includes(
          options.overrideSentiment
        )
      ) {
        throw new MarketSimulationError(
          "INVALID_SIMULATION_CONFIG",
          `Invalid overrideSentiment: ${String(options.overrideSentiment)}.`
        );
      }
      this.currentSentiment = options.overrideSentiment;
    } else {
      this.currentSentiment = selectNextSentimentRegime(
        this.currentSentiment,
        this.config.sentimentTransitionProbability,
        this.randomSource
      );
    }

    const marketEffectBps = calculateMarketEffectBps(
      this.currentSentiment,
      this.randomSource
    );

    const updates: SimulatedInstrumentQuoteUpdate[] = [];
    let skippedNonTradableCount = 0;

    for (const inst of instruments) {
      if (!inst || !(inst._id instanceof Types.ObjectId)) {
        throw new MarketSimulationError(
          "INVALID_INSTRUMENT_STATE",
          "Each instrument record must include a valid MongoDB ObjectId."
        );
      }

      if (!inst.isTradable) {
        skippedNonTradableCount++;
        continue;
      }

      const profile = this.volatilityResolver(inst.symbol);
      const stockShockBps = calculateStockShockBps(
        profile.maxStockShockBps,
        this.randomSource
      );

      const priceTransition = calculateNextInstrumentPrice({
        currentLastPricePaise: inst.lastPricePaise,
        previousClosePaise: inst.previousClosePaise,
        volatilityProfile: profile,
        marketEffectBps,
        stockShockBps,
        maxMoveBps: this.config.maxMoveBps,
        maxDeviationFromPrevCloseBps: this.config.maxDeviationFromPrevCloseBps,
        minPricePaise: this.config.minPricePaise,
        tickSizePaise: this.config.tickSizePaise,
      });

      const spreadQuote = calculateBidAskQuotesPaise(
        priceTransition.nextLastPricePaise,
        profile.spreadBps,
        this.config.tickSizePaise
      );

      updates.push(
        Object.freeze({
          instrumentId: new Types.ObjectId(inst._id.toString()),
          symbol: inst.symbol,
          exchange: inst.exchange,
          volatilityTier: profile.tier,
          previousLastPricePaise: inst.lastPricePaise,
          nextLastPricePaise: priceTransition.nextLastPricePaise,
          nextBidPricePaise: spreadQuote.bidPricePaise,
          nextAskPricePaise: spreadQuote.askPricePaise,
          previousClosePaise: inst.previousClosePaise,
          appliedMoveBps: priceTransition.appliedMoveBps,
          priceUpdatedAt: new Date(timestamp.getTime()),
        })
      );
    }

    this.tickCount += 1;

    return Object.freeze({
      tickNumber: this.tickCount,
      sentiment: this.currentSentiment,
      marketEffectBps,
      timestamp: new Date(timestamp.getTime()),
      totalInputInstruments: instruments.length,
      skippedNonTradableCount,
      updates: Object.freeze(updates),
    });
  }
}

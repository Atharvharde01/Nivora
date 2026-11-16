import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getVolatilityProfileForSymbol,
  VOLATILITY_PROFILES,
} from "./market-simulation.config";
import { MarketSimulationError } from "./market-simulation.types";
import {
  assertValidRandomUnitValue,
  calculateBidAskQuotesPaise,
  calculateMarketEffectBps,
  calculateNextInstrumentPrice,
  calculateStockShockBps,
  roundToTickPaise,
  selectNextSentimentRegime,
} from "./market-simulation.utils";

describe("Milestone 3 — Market Simulation Mathematical Utilities (Unit)", () => {
  describe("A. Shared Market Sentiment & Regime Transitions", () => {
    it("produces positive market effect in BULLISH regime, negative in BEARISH, and bounded near-zero in SIDEWAYS", () => {
      const samplePoints = [0, 0.25, 0.5, 0.75, 0.999];

      for (const u of samplePoints) {
        const bullishBps = calculateMarketEffectBps("BULLISH", () => u);
        assert.ok(
          bullishBps >= 8 && bullishBps <= 22,
          `Expected BULLISH effect in [8, 22], got ${bullishBps}`
        );

        const bearishBps = calculateMarketEffectBps("BEARISH", () => u);
        assert.ok(
          bearishBps >= -22 && bearishBps <= -8,
          `Expected BEARISH effect in [-22, -8], got ${bearishBps}`
        );

        const sidewaysBps = calculateMarketEffectBps("SIDEWAYS", () => u);
        assert.ok(
          sidewaysBps >= -6 && sidewaysBps <= 6,
          `Expected SIDEWAYS effect in [-6, 6], got ${sidewaysBps}`
        );
      }
    });

    it("retains current sentiment when roll >= transitionProbability and transitions deterministically otherwise", () => {
      // Roll 0.50 >= 0.15 -> stays SIDEWAYS
      const retained = selectNextSentimentRegime("SIDEWAYS", 0.15, () => 0.5);
      assert.equal(retained, "SIDEWAYS");

      // Roll 0.05 < 0.15, followed by 0.1 -> index 0 ("BULLISH")
      const rolls = [0.05, 0.1];
      let idx = 0;
      const transitionedBullish = selectNextSentimentRegime(
        "SIDEWAYS",
        0.15,
        () => rolls[idx++]
      );
      assert.equal(transitionedBullish, "BULLISH");

      // Roll 0.05 < 0.15, followed by 0.5 -> index 1 ("BEARISH")
      const rollsBear = [0.05, 0.5];
      let idxBear = 0;
      const transitionedBearish = selectNextSentimentRegime(
        "BULLISH",
        0.15,
        () => rollsBear[idxBear++]
      );
      assert.equal(transitionedBearish, "BEARISH");
    });
  });

  describe("B. Volatility Profiles & Idiosyncratic Shocks", () => {
    it("maps defensive blue-chips to LOW, general equities to MEDIUM, and high-beta cyclicals to HIGH", () => {
      assert.equal(getVolatilityProfileForSymbol("HDFCBANK").tier, "LOW");
      assert.equal(getVolatilityProfileForSymbol("TCS").tier, "LOW");
      assert.equal(getVolatilityProfileForSymbol("INFY").tier, "MEDIUM");
      assert.equal(getVolatilityProfileForSymbol("RELIANCE").tier, "MEDIUM");
      assert.equal(getVolatilityProfileForSymbol("ADANIENT").tier, "HIGH");
      assert.equal(getVolatilityProfileForSymbol("TATASTEEL").tier, "HIGH");
      assert.equal(getVolatilityProfileForSymbol("UNKNOWNSYM").tier, "MEDIUM");

      assert.ok(
        VOLATILITY_PROFILES.LOW.maxStockShockBps <
          VOLATILITY_PROFILES.MEDIUM.maxStockShockBps
      );
      assert.ok(
        VOLATILITY_PROFILES.MEDIUM.maxStockShockBps <
          VOLATILITY_PROFILES.HIGH.maxStockShockBps
      );
    });

    it("computes bounded stock shocks across LOW, MEDIUM, and HIGH profiles", () => {
      assert.equal(calculateStockShockBps(20, () => 0), -20);
      assert.equal(calculateStockShockBps(20, () => 0.5), 0);
      assert.equal(calculateStockShockBps(20, () => 0.9999), 20);

      assert.equal(calculateStockShockBps(55, () => 0), -55);
      assert.equal(calculateStockShockBps(55, () => 0.9999), 55);
    });
  });

  describe("C. Price Movement, Guardrails & Paise Rounding", () => {
    it("rounds prices >= 100 paise to 5-paise NSE tick increments and enforces positive floor", () => {
      assert.equal(roundToTickPaise(254002, 5, 5), 254000);
      assert.equal(roundToTickPaise(254003, 5, 5), 254005);
      assert.equal(roundToTickPaise(-500, 5, 5), 5);
      assert.equal(roundToTickPaise(0, 5, 5), 5);
      assert.equal(roundToTickPaise(42, 5, 5), 42);
    });

    it("calculates upward movement in bullish conditions and downward in bearish conditions", () => {
      const mediumProfile = VOLATILITY_PROFILES.MEDIUM;

      const upward = calculateNextInstrumentPrice({
        currentLastPricePaise: 250000, // ₹2,500.00
        previousClosePaise: 248000,
        volatilityProfile: mediumProfile,
        marketEffectBps: 20, // +0.20%
        stockShockBps: 30,   // +0.30% -> total +50 bps (+0.50% = +1250 paise)
        maxMoveBps: 75,
        maxDeviationFromPrevCloseBps: 1000,
      });

      assert.equal(upward.appliedMoveBps, 50);
      assert.equal(upward.nextLastPricePaise, 251250);

      const downward = calculateNextInstrumentPrice({
        currentLastPricePaise: 250000,
        previousClosePaise: 248000,
        volatilityProfile: mediumProfile,
        marketEffectBps: -20,
        stockShockBps: -30, // total -50 bps (-1250 paise)
        maxMoveBps: 75,
        maxDeviationFromPrevCloseBps: 1000,
      });

      assert.equal(downward.appliedMoveBps, -50);
      assert.equal(downward.nextLastPricePaise, 248750);
    });

    it("enforces single-tick maxMoveBps cap and cumulative previousClosePaise deviation band", () => {
      const highProfile = VOLATILITY_PROFILES.HIGH;

      // 1. Single-tick cap: raw move = 1.25 * 22 + 55 = +83 bps, capped at maxMoveBps = 50 bps
      const cappedTick = calculateNextInstrumentPrice({
        currentLastPricePaise: 100000, // ₹1,000.00
        previousClosePaise: 100000,
        volatilityProfile: highProfile,
        marketEffectBps: 22,
        stockShockBps: 55,
        maxMoveBps: 50,
        maxDeviationFromPrevCloseBps: 1000,
      });

      assert.equal(cappedTick.rawUnclampedBps, 83);
      assert.equal(cappedTick.appliedMoveBps, 50);
      assert.equal(cappedTick.nextLastPricePaise, 100500);

      // 2. Cumulative previousClose deviation cap (+10% = 110,000 paise max)
      const upperBandClamped = calculateNextInstrumentPrice({
        currentLastPricePaise: 109800,
        previousClosePaise: 100000,
        volatilityProfile: highProfile,
        marketEffectBps: 20,
        stockShockBps: 50,
        maxMoveBps: 75,
        maxDeviationFromPrevCloseBps: 1000, // +10% max = 110000
      });

      assert.equal(upperBandClamped.nextLastPricePaise, 110000);

      // 3. Cumulative previousClose lower band (-10% = 90,000 paise min)
      const lowerBandClamped = calculateNextInstrumentPrice({
        currentLastPricePaise: 90200,
        previousClosePaise: 100000,
        volatilityProfile: highProfile,
        marketEffectBps: -20,
        stockShockBps: -50,
        maxMoveBps: 75,
        maxDeviationFromPrevCloseBps: 1000, // -10% min = 90000
      });

      assert.equal(lowerBandClamped.nextLastPricePaise, 90000);
    });
  });

  describe("D. Bid/Ask Spread Calculation & Input Validation", () => {
    it("computes integer-paise bid and ask prices satisfying 1 <= bid <= last <= ask", () => {
      const quote = calculateBidAskQuotesPaise(254000, 8, 5);
      assert.ok(quote.bidPricePaise > 0);
      assert.ok(quote.askPricePaise > 0);
      assert.ok(quote.bidPricePaise < 254000);
      assert.ok(quote.askPricePaise > 254000);
      assert.ok(quote.bidPricePaise <= quote.askPricePaise);
      assert.equal(quote.bidPricePaise % 5, 0);
      assert.equal(quote.askPricePaise % 5, 0);

      // Edge case: minimum possible price (1 paise) stays >= 1
      const minQuote = calculateBidAskQuotesPaise(1, 8, 5);
      assert.equal(minQuote.bidPricePaise, 1);
      assert.ok(minQuote.askPricePaise >= 1);
    });

    it("rejects invalid random numbers, negative prices, floating-point prices, and unsafe integers", () => {
      assert.throws(
        () => assertValidRandomUnitValue(-0.1),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "INVALID_RANDOM_VALUE"
      );
      assert.throws(
        () => assertValidRandomUnitValue(1.5),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "INVALID_RANDOM_VALUE"
      );
      assert.throws(
        () => assertValidRandomUnitValue(Number.NaN),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "INVALID_RANDOM_VALUE"
      );

      assert.throws(
        () =>
          calculateNextInstrumentPrice({
            currentLastPricePaise: 0,
            previousClosePaise: 10000,
            volatilityProfile: VOLATILITY_PROFILES.MEDIUM,
            marketEffectBps: 0,
            stockShockBps: 0,
          }),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "INVALID_INSTRUMENT_STATE"
      );

      assert.throws(
        () =>
          calculateNextInstrumentPrice({
            currentLastPricePaise: 1000.5,
            previousClosePaise: 10000,
            volatilityProfile: VOLATILITY_PROFILES.MEDIUM,
            marketEffectBps: 0,
            stockShockBps: 0,
          }),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "INVALID_INSTRUMENT_STATE"
      );

      assert.throws(
        () => calculateBidAskQuotesPaise(-100, 8, 5),
        (err: unknown) =>
          err instanceof MarketSimulationError &&
          err.code === "PRICE_INVARIANT_VIOLATION"
      );
    });
  });
});

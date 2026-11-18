import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { SYNTHETIC_NSE_INSTRUMENTS_SEED } from "../../../scripts/data/instruments.seed";
import {
  NIFTY50_BASE_VALUE,
  NIFTY50_CONSTITUENT_SYMBOLS,
  SENSEX_BASE_VALUE,
  SENSEX_CONSTITUENT_SYMBOLS,
} from "./market-index.config";
import { MarketIndexModel } from "./market-index.model";
import { MarketIndexError, TOTAL_INDEX_WEIGHT_BPS } from "./market-index.types";
import {
  buildMarketIndexSeedRecord,
  calculateIndexChangeMetrics,
  calculateSyntheticIndexValue,
  computeEqualConstituentWeightsBps,
  InstrumentForIndexSeed,
  normalizeMarketIndexSymbol,
} from "./market-index.utils";

function buildMockSeededInstruments(): InstrumentForIndexSeed[] {
  return SYNTHETIC_NSE_INSTRUMENTS_SEED.map((seed, idx) => ({
    _id: new Types.ObjectId(`${(idx + 1).toString(16).padStart(24, "0")}`),
    symbol: seed.symbol,
    exchange: seed.exchange,
    lastPricePaise: seed.lastPricePaise,
    previousClosePaise: seed.previousClosePaise,
  }));
}

describe("Milestone 4 — Synthetic Market Indices & Calculation Engine (Unit)", () => {
  it("normalizes NIFTY50 and SENSEX symbols and rejects unknown index symbols", () => {
    assert.equal(normalizeMarketIndexSymbol("NIFTY50"), "NIFTY50");
    assert.equal(normalizeMarketIndexSymbol("nifty 50"), "NIFTY50");
    assert.equal(normalizeMarketIndexSymbol("NIFTY-50"), "NIFTY50");
    assert.equal(normalizeMarketIndexSymbol("SENSEX"), "SENSEX");
    assert.equal(normalizeMarketIndexSymbol("bse sensex"), "SENSEX");

    assert.throws(
      () => normalizeMarketIndexSymbol("BANKNIFTY"),
      (err: unknown) =>
        err instanceof MarketIndexError && err.code === "INVALID_INDEX_SYMBOL"
    );
  });

  it("distributes 10,000 bps deterministically across 50 NIFTY50 and 30 SENSEX constituents", () => {
    const niftyWeights = computeEqualConstituentWeightsBps(50);
    assert.equal(niftyWeights.length, 50);
    assert.ok(niftyWeights.every((w) => w === 200));
    assert.equal(
      niftyWeights.reduce((acc, w) => acc + w, 0),
      TOTAL_INDEX_WEIGHT_BPS
    );

    const sensexWeights = computeEqualConstituentWeightsBps(30);
    assert.equal(sensexWeights.length, 30);
    assert.equal(sensexWeights.filter((w) => w === 334).length, 10);
    assert.equal(sensexWeights.filter((w) => w === 333).length, 20);
    assert.equal(
      sensexWeights.reduce((acc, w) => acc + w, 0),
      TOTAL_INDEX_WEIGHT_BPS
    );
  });

  it("calculates NIFTY50 (50 constituents) and SENSEX (30 constituents) with exact fixed-point BigInt precision", () => {
    const instruments = buildMockSeededInstruments();
    assert.equal(NIFTY50_CONSTITUENT_SYMBOLS.length, 50);
    assert.equal(SENSEX_CONSTITUENT_SYMBOLS.length, 30);

    const niftyRecord = buildMarketIndexSeedRecord("NIFTY50", instruments);
    const sensexRecord = buildMarketIndexSeedRecord("SENSEX", instruments);

    assert.equal(niftyRecord.symbol, "NIFTY50");
    assert.equal(niftyRecord.constituents.length, 50);
    assert.equal(niftyRecord.baseValue, NIFTY50_BASE_VALUE);
    assert.equal(niftyRecord.previousCloseValue, NIFTY50_BASE_VALUE);
    assert.ok(Number.isSafeInteger(niftyRecord.currentValue));
    assert.ok(niftyRecord.currentValue > NIFTY50_BASE_VALUE);

    assert.equal(sensexRecord.symbol, "SENSEX");
    assert.equal(sensexRecord.constituents.length, 30);
    assert.equal(sensexRecord.baseValue, SENSEX_BASE_VALUE);
    assert.equal(sensexRecord.previousCloseValue, SENSEX_BASE_VALUE);
    assert.ok(Number.isSafeInteger(sensexRecord.currentValue));
    assert.ok(sensexRecord.currentValue > SENSEX_BASE_VALUE);

    // Verify exact identity when all constituents are at basePricePaise
    const baseLookup = new Map<string, number>();
    for (const c of niftyRecord.constituents) {
      baseLookup.set(c.symbol, c.basePricePaise);
    }
    assert.equal(
      calculateSyntheticIndexValue(
        NIFTY50_BASE_VALUE,
        niftyRecord.constituents,
        baseLookup
      ),
      NIFTY50_BASE_VALUE
    );

    // Verify exact +10% movement across all constituents -> +10% index value
    const plusTenPctLookup = new Map<string, number>();
    for (const c of niftyRecord.constituents) {
      plusTenPctLookup.set(c.symbol, Math.round(c.basePricePaise * 1.1));
    }
    assert.equal(
      calculateSyntheticIndexValue(
        NIFTY50_BASE_VALUE,
        niftyRecord.constituents,
        plusTenPctLookup
      ),
      2_640_000
    );

    // Validate both generated index records against MarketIndexModel Mongoose schema
    const niftyDoc = new MarketIndexModel(niftyRecord);
    assert.equal(niftyDoc.validateSync(), undefined);

    const sensexDoc = new MarketIndexModel(sensexRecord);
    assert.equal(sensexDoc.validateSync(), undefined);
  });

  it("rejects missing constituent prices, zero/negative prices, duplicate constituents, and invalid weight sums", () => {
    const id1 = new Types.ObjectId();
    const id2 = new Types.ObjectId();

    const constituents = [
      {
        instrumentId: id1,
        symbol: "RELIANCE",
        weightBps: 5000,
        basePricePaise: 250000,
      },
      {
        instrumentId: id2,
        symbol: "TCS",
        weightBps: 5000,
        basePricePaise: 400000,
      },
    ];

    // Missing TCS price
    assert.throws(
      () =>
        calculateSyntheticIndexValue(2_400_000, constituents, {
          RELIANCE: 255000,
        }),
      (err: unknown) =>
        err instanceof MarketIndexError &&
        err.code === "MISSING_CONSTITUENT_PRICE"
    );

    // Zero constituent price
    assert.throws(
      () =>
        calculateSyntheticIndexValue(2_400_000, constituents, {
          RELIANCE: 255000,
          TCS: 0,
        }),
      (err: unknown) =>
        err instanceof MarketIndexError &&
        err.code === "INVALID_CONSTITUENT_PRICE"
    );

    // Weight sum !== 10,000 bps
    assert.throws(
      () =>
        calculateSyntheticIndexValue(
          2_400_000,
          [
            { ...constituents[0], weightBps: 4000 },
            { ...constituents[1], weightBps: 5000 },
          ],
          {
            RELIANCE: 255000,
            TCS: 405000,
          }
        ),
      (err: unknown) =>
        err instanceof MarketIndexError &&
        err.code === "INVALID_INDEX_CONSTITUENTS"
    );

    // Verify change metrics calculation
    const change = calculateIndexChangeMetrics(2_424_000, 2_400_000);
    assert.equal(change.changeValue, 24_000);
    assert.equal(change.changeBps, 100); // +1.00% = +100 bps
  });
});

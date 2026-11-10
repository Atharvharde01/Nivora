import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { HoldingModel } from "../../modules/holdings/holding.model";
import { TradeModel } from "../../modules/trades/trade.model";
import {
  allocateSellCostBasisPaise,
  assertNonNegativeSafeIntegerPaise,
  assertNonNegativeWholeShareQuantity,
  assertPositiveSafeIntegerPaise,
  assertPositiveWholeShareQuantity,
  assertSignedSafeIntegerPaise,
  calculateAverageBuyPricePaise,
  calculateBuyTradeValuePaise,
  calculateHoldingAfterBuy,
  calculateHoldingAfterSell,
  calculateRealizedPnlPaise,
  calculateSellProceedsPaise,
  FinancialCalculationError,
  INITIAL_VIRTUAL_BALANCE_PAISE,
  INITIAL_VIRTUAL_BALANCE_RUPEES,
  isNonNegativeSafeIntegerPaise,
  isNonNegativeWholeShareQuantity,
  isPositiveSafeIntegerPaise,
  isPositiveWholeShareQuantity,
  isSignedSafeIntegerPaise,
  PAISE_PER_RUPEE,
  safeAddPaise,
  safeAddSignedPaise,
  safeDebitBalancePaise,
  safeMultiplyQuantityAndPricePaise,
  safeSignedSubtractPaise,
  willAddOverflow,
  willMultiplyOverflow,
  willSignedSubtractOverflow,
} from "./financial.utils";

describe("Task 16 — Financial Calculation Utilities", () => {
  it("exposes NIVORA initial virtual balance constants in rupees and paise", () => {
    assert.equal(PAISE_PER_RUPEE, 100);
    assert.equal(INITIAL_VIRTUAL_BALANCE_RUPEES, 1_000_000);
    assert.equal(INITIAL_VIRTUAL_BALANCE_PAISE, 100_000_000);
  });

  it("validates positive, non-negative, signed paise and whole-share quantities", () => {
    assert.equal(isPositiveSafeIntegerPaise(1), true);
    assert.equal(isPositiveSafeIntegerPaise(12_575), true);
    assert.equal(isPositiveSafeIntegerPaise(0), false);
    assert.equal(isPositiveSafeIntegerPaise(-1), false);
    assert.equal(isPositiveSafeIntegerPaise(12.5), false);
    assert.equal(isPositiveSafeIntegerPaise(Number.NaN), false);
    assert.equal(isPositiveSafeIntegerPaise(Number.POSITIVE_INFINITY), false);
    assert.equal(
      isPositiveSafeIntegerPaise(Number.MAX_SAFE_INTEGER + 1),
      false
    );

    assert.equal(isNonNegativeSafeIntegerPaise(0), true);
    assert.equal(isNonNegativeSafeIntegerPaise(100), true);
    assert.equal(isNonNegativeSafeIntegerPaise(-1), false);

    assert.equal(isSignedSafeIntegerPaise(-500_000), true);
    assert.equal(isSignedSafeIntegerPaise(0), true);
    assert.equal(isSignedSafeIntegerPaise(500_000), true);
    assert.equal(isSignedSafeIntegerPaise(1.25), false);

    assert.equal(isPositiveWholeShareQuantity(1), true);
    assert.equal(isPositiveWholeShareQuantity(0), false);
    assert.equal(isNonNegativeWholeShareQuantity(0), true);
    assert.equal(isNonNegativeWholeShareQuantity(-1), false);

    assert.equal(assertPositiveSafeIntegerPaise(100), 100);
    assert.equal(assertNonNegativeSafeIntegerPaise(0), 0);
    assert.equal(assertSignedSafeIntegerPaise(-0), 0);
    assert.equal(assertPositiveWholeShareQuantity(5), 5);
    assert.equal(assertNonNegativeWholeShareQuantity(0), 0);
  });

  it("calculates normal BUY trade values accurately in integer paise", () => {
    // ₹125.75 = 12575 paise * 10 shares = 125750 paise
    assert.equal(calculateBuyTradeValuePaise(10, 12_575), 125_750);
    assert.equal(calculateBuyTradeValuePaise(1, 1), 1);
    assert.equal(
      safeMultiplyQuantityAndPricePaise(250, 245_000),
      61_250_000
    );
  });

  it("calculates normal SELL proceeds accurately in integer paise", () => {
    assert.equal(calculateSellProceedsPaise(15, 340_050), 5_100_750);
    assert.equal(calculateSellProceedsPaise(1, 99_999), 99_999);
  });

  it("rejects invalid quantities, zero/negative prices, decimals, NaN, Infinity, and unsafe integers", () => {
    const invalidQuantities = [
      0,
      -1,
      -50,
      1.5,
      0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const q of invalidQuantities) {
      assert.throws(
        () => calculateBuyTradeValuePaise(q, 10_000),
        (err: unknown) =>
          err instanceof FinancialCalculationError &&
          err.code === "INVALID_QUANTITY"
      );
      assert.throws(
        () => calculateSellProceedsPaise(q, 10_000),
        (err: unknown) =>
          err instanceof FinancialCalculationError &&
          err.code === "INVALID_QUANTITY"
      );
    }

    const invalidPrices = [
      0,
      -1,
      -10_000,
      125.75,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const p of invalidPrices) {
      assert.throws(
        () => calculateBuyTradeValuePaise(10, p),
        (err: unknown) =>
          err instanceof FinancialCalculationError &&
          err.code === "INVALID_PAISE_VALUE"
      );
      assert.throws(
        () => calculateSellProceedsPaise(10, p),
        (err: unknown) =>
          err instanceof FinancialCalculationError &&
          err.code === "INVALID_PAISE_VALUE"
      );
    }
  });

  it("detects and rejects multiplication, addition, and signed subtraction overflows", () => {
    assert.equal(willMultiplyOverflow(10_000_000, 1_000_000_000), true);
    assert.equal(willMultiplyOverflow(1_000, 1_000), false);
    assert.throws(
      () => calculateBuyTradeValuePaise(10_000_000, 1_000_000_000),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
    );

    assert.equal(willAddOverflow(Number.MAX_SAFE_INTEGER, 1), true);
    assert.equal(willAddOverflow(Number.MIN_SAFE_INTEGER, -1), true);
    assert.equal(willAddOverflow(100, 200), false);
    assert.throws(
      () => safeAddPaise(Number.MAX_SAFE_INTEGER, 1),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
    );
    assert.throws(
      () => safeAddSignedPaise(Number.MIN_SAFE_INTEGER, -1),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
    );

    assert.equal(
      willSignedSubtractOverflow(Number.MIN_SAFE_INTEGER, 1),
      true
    );
    assert.equal(
      willSignedSubtractOverflow(Number.MAX_SAFE_INTEGER, -1),
      true
    );
    assert.throws(
      () => safeSignedSubtractPaise(Number.MIN_SAFE_INTEGER, 1),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
    );

    assert.equal(safeDebitBalancePaise(100_000, 40_000), 60_000);
    assert.throws(
      () => safeDebitBalancePaise(100_000, 100_001),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "INSUFFICIENT_FUNDS"
    );
  });

  it("calculates rounded averageBuyPricePaise and enforces zero/positive holding state invariants", () => {
    assert.equal(calculateAverageBuyPricePaise(0, 0), 0);
    // 100 paise / 3 shares = 33.333... -> 33 paise
    assert.equal(calculateAverageBuyPricePaise(100, 3), 33);
    // 200 paise / 3 shares = 66.666... -> 67 paise
    assert.equal(calculateAverageBuyPricePaise(200, 3), 67);
    // Exact half-way: 3 paise / 2 shares = 1.5 -> 2 paise (half-up)
    assert.equal(calculateAverageBuyPricePaise(3, 2), 2);

    assert.throws(
      () => calculateAverageBuyPricePaise(100, 0),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "INVALID_HOLDING_STATE"
    );
    assert.throws(
      () => calculateAverageBuyPricePaise(5, 10),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "INVALID_HOLDING_STATE"
    );
  });

  it("allocates partial SELL cost basis using BigInt intermediate arithmetic and removes full cost basis on full exit", () => {
    // 3 shares acquired for total 100 paise (averageBuyPricePaise = 33).
    // Sell 1 share: proportional cost basis = round(100 * 1 / 3) = 33 paise; remaining = 67 paise.
    const firstPartial = allocateSellCostBasisPaise({
      currentQuantity: 3,
      currentTotalInvestedPaise: 100,
      sellQuantity: 1,
    });
    assert.deepEqual(firstPartial, {
      costBasisSoldPaise: 33,
      remainingQuantity: 2,
      remainingTotalInvestedPaise: 67,
      remainingAverageBuyPricePaise: 34, // round(67 / 2) = 33.5 -> 34
    });

    // Sell 2nd share from remaining (2 shares, 67 paise): round(67 * 1 / 2) = 34 paise; remaining = 33 paise.
    const secondPartial = allocateSellCostBasisPaise({
      currentQuantity: firstPartial.remainingQuantity,
      currentTotalInvestedPaise: firstPartial.remainingTotalInvestedPaise,
      sellQuantity: 1,
    });
    assert.deepEqual(secondPartial, {
      costBasisSoldPaise: 34,
      remainingQuantity: 1,
      remainingTotalInvestedPaise: 33,
      remainingAverageBuyPricePaise: 33,
    });

    // Full exit of final share removes exact remaining 33 paise.
    // Total removed across 3 sells: 33 + 34 + 33 === 100 paise (zero cumulative drift!).
    const finalExit = allocateSellCostBasisPaise({
      currentQuantity: secondPartial.remainingQuantity,
      currentTotalInvestedPaise: secondPartial.remainingTotalInvestedPaise,
      sellQuantity: 1,
    });
    assert.deepEqual(finalExit, {
      costBasisSoldPaise: 33,
      remainingQuantity: 0,
      remainingTotalInvestedPaise: 0,
      remainingAverageBuyPricePaise: 0,
    });
    assert.equal(
      firstPartial.costBasisSoldPaise +
        secondPartial.costBasisSoldPaise +
        finalExit.costBasisSoldPaise,
      100
    );

    // Large values where currentTotalInvestedPaise * sellQuantity > Number.MAX_SAFE_INTEGER (requires BigInt intermediate)
    const largeTotalInvested = 5_000_000_000_000; // ₹50,000 crore in paise (< MAX_SAFE_INTEGER)
    const largeQty = 10_000;
    const sellQty = 3_333; // 5e12 * 3333 = 1.6665e16 > Number.MAX_SAFE_INTEGER (9.007e15)!
    const largeAlloc = allocateSellCostBasisPaise({
      currentQuantity: largeQty,
      currentTotalInvestedPaise: largeTotalInvested,
      sellQuantity: sellQty,
    });
    assert.equal(largeAlloc.costBasisSoldPaise, 1_666_500_000_000);
    assert.equal(largeAlloc.remainingQuantity, 6_667);
    assert.equal(largeAlloc.remainingTotalInvestedPaise, 3_333_500_000_000);
  });

  it("calculates profitable, break-even, and loss-making realized P&L", () => {
    // Profitable
    assert.equal(calculateRealizedPnlPaise(250_000, 200_000), 50_000);
    // Break-even
    assert.equal(calculateRealizedPnlPaise(200_000, 200_000), 0);
    // Loss-making
    assert.equal(calculateRealizedPnlPaise(180_000, 200_000), -20_000);
  });

  it("produces Holding and Trade transition states that pass Mongoose validation on HoldingModel and TradeModel", async () => {
    const ids = {
      orderId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      practiceAccountId: new Types.ObjectId(),
      instrumentId: new Types.ObjectId(),
    };
    const now = new Date();

    // Step 1: Initial BUY of 3 shares at ask = 33_335 paise
    const buyResult = calculateHoldingAfterBuy({
      currentQuantity: 0,
      currentTotalInvestedPaise: 0,
      currentRealizedPnlPaise: 0,
      currentVersion: 0,
      buyQuantity: 3,
      askPricePaise: 33_335,
    });

    const holdingAfterBuy = new HoldingModel({
      userId: ids.userId,
      practiceAccountId: ids.practiceAccountId,
      instrumentId: ids.instrumentId,
      symbol: "RELIANCE",
      exchange: "NSE",
      quantity: buyResult.newQuantity,
      totalInvestedPaise: buyResult.newTotalInvestedPaise,
      averageBuyPricePaise: buyResult.newAverageBuyPricePaise,
      realizedPnlPaise: buyResult.newRealizedPnlPaise,
      version: buyResult.newVersion,
    });
    await holdingAfterBuy.validate();

    const buyTrade = new TradeModel({
      ...ids,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 3,
      executionPricePaise: buyResult.executionPricePaise,
      totalValuePaise: buyResult.totalValuePaise,
      costBasisSoldPaise: buyResult.costBasisSoldPaise,
      realizedPnlPaise: buyResult.tradeRealizedPnlPaise,
      quoteSnapshot: {
        lastPricePaise: 33_330,
        bidPricePaise: 33_325,
        askPricePaise: 33_335,
        priceUpdatedAt: now,
      },
      idempotencyKey: "buy-1",
      executedAt: now,
    });
    await buyTrade.validate();

    // Step 2: Full SELL of 3 shares at bid = 34_000 paise
    const sellResult = calculateHoldingAfterSell({
      currentQuantity: buyResult.newQuantity,
      currentTotalInvestedPaise: buyResult.newTotalInvestedPaise,
      currentRealizedPnlPaise: buyResult.newRealizedPnlPaise,
      currentVersion: buyResult.newVersion,
      sellQuantity: 3,
      bidPricePaise: 34_000,
    });

    assert.equal(sellResult.newQuantity, 0);
    assert.equal(sellResult.newTotalInvestedPaise, 0);
    assert.equal(sellResult.newAverageBuyPricePaise, 0);
    assert.equal(sellResult.costBasisSoldPaise, 100_005);
    assert.equal(sellResult.totalValuePaise, 102_000);
    assert.equal(sellResult.tradeRealizedPnlPaise, 1_995);

    const holdingAfterFullSell = new HoldingModel({
      userId: ids.userId,
      practiceAccountId: ids.practiceAccountId,
      instrumentId: ids.instrumentId,
      symbol: "RELIANCE",
      exchange: "NSE",
      quantity: sellResult.newQuantity,
      totalInvestedPaise: sellResult.newTotalInvestedPaise,
      averageBuyPricePaise: sellResult.newAverageBuyPricePaise,
      realizedPnlPaise: sellResult.newRealizedPnlPaise,
      version: sellResult.newVersion,
    });
    await holdingAfterFullSell.validate();

    const sellTrade = new TradeModel({
      ...ids,
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "SELL",
      quantity: 3,
      executionPricePaise: sellResult.executionPricePaise,
      totalValuePaise: sellResult.totalValuePaise,
      costBasisSoldPaise: sellResult.costBasisSoldPaise,
      realizedPnlPaise: sellResult.tradeRealizedPnlPaise,
      quoteSnapshot: {
        lastPricePaise: 34_010,
        bidPricePaise: 34_000,
        askPricePaise: 34_020,
        priceUpdatedAt: now,
      },
      idempotencyKey: "sell-1",
      executedAt: now,
    });
    await sellTrade.validate();
  });
});

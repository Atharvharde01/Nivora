import {
  indexValueToPoints,
  indexChangeValueToPoints,
  bpsToPercent,
  paiseToRupees,
  formatRupees,
  formatIndexPoints,
  MarketIndexSummary,
  MarketIndexDetail,
} from "../types";

describe("API Types & Conversion Utilities", () => {
  test("converts backend fixed-point index integer to points (100 units = 1.00 pt)", () => {
    // Backend: 24,120.50 index points = 2412050 fixed-point units
    expect(indexValueToPoints(2412050)).toBe(24120.5);
    expect(indexValueToPoints(7985025)).toBe(79850.25);
    expect(indexValueToPoints(0)).toBe(0);
  });

  test("converts backend fixed-point change integer to index change points", () => {
    // Backend: +125.50 points = 12550 units, -85.20 points = -8520 units
    expect(indexChangeValueToPoints(12550)).toBe(125.5);
    expect(indexChangeValueToPoints(-8520)).toBe(-85.2);
    expect(indexChangeValueToPoints(0)).toBe(0);
  });

  test("converts basis points to percentage (100 bps = 1.00%)", () => {
    expect(bpsToPercent(52)).toBe(0.52);
    expect(bpsToPercent(-125)).toBe(-1.25);
    expect(bpsToPercent(10000)).toBe(100);
    expect(bpsToPercent(0)).toBe(0);
  });

  test("converts paise to rupees", () => {
    expect(paiseToRupees(250050)).toBe(2500.5);
    expect(paiseToRupees(100)).toBe(1);
    expect(paiseToRupees(50)).toBe(0.5);
  });

  test("formats rupees and index points with Indian locale number conventions", () => {
    expect(formatRupees(2500.5)).toBe("2,500.50");
    expect(formatRupees(1000000)).toBe("10,00,000.00");
    expect(formatIndexPoints(24120.75)).toBe("24,120.75");
    expect(formatIndexPoints(79850)).toBe("79,850.00");
  });

  test("accurately represents backend MarketIndexSummary and MarketIndexDetail contracts", () => {
    const summaryFixture: MarketIndexSummary = {
      _id: "664000000000000000000001",
      symbol: "NIFTY50",
      name: "NIFTY 50",
      description: "Equal-weighted synthetic benchmark of top 50 Indian equities.",
      currentValue: 2400000,
      baseValue: 2400000,
      previousCloseValue: 2385000,
      changeValue: 15000,
      changeBps: 63,
      constituentCount: 50,
      methodology: "EQUAL_WEIGHTED_CONSTITUENT_BASKET",
      source: "SIMULATED",
      valueUpdatedAt: "2026-11-18T10:00:00.000Z",
    };

    expect(indexValueToPoints(summaryFixture.currentValue)).toBe(24000);
    expect(indexChangeValueToPoints(summaryFixture.changeValue)).toBe(150);
    expect(bpsToPercent(summaryFixture.changeBps)).toBe(0.63);

    const detailFixture: MarketIndexDetail = {
      ...summaryFixture,
      constituents: [
        {
          instrumentId: "664000000000000000000010",
          symbol: "RELIANCE",
          exchange: "NSE",
          weightBps: 200,
          basePricePaise: 250000,
        },
      ],
    };

    expect(detailFixture.constituents).toHaveLength(1);
    expect(bpsToPercent(detailFixture.constituents[0].weightBps)).toBe(2);
    expect(paiseToRupees(detailFixture.constituents[0].basePricePaise)).toBe(2500);
  });
});

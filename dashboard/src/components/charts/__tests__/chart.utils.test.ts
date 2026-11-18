import {
  parseIsoToUnixSeconds,
  sortAndDeduplicateCandles,
  transformIndexCandles,
  transformEquityCandles,
  formatUnixTimestampToIST,
  formatChartPrice,
} from "../chart.utils";
import { InstrumentCandleDto, MarketIndexCandleDto } from "../../../api/types";

describe("Chart Utilities — Data Transformation & Formatting", () => {
  describe("parseIsoToUnixSeconds", () => {
    test("converts valid ISO UTC timestamp to Unix timestamp in seconds", () => {
      const iso = "2026-11-18T03:45:00.000Z";
      const seconds = parseIsoToUnixSeconds(iso);
      expect(seconds).toBe(1794973500);
    });

    test("returns null for invalid, non-string, or empty timestamp", () => {
      expect(parseIsoToUnixSeconds("")).toBeNull();
      expect(parseIsoToUnixSeconds("not-a-date")).toBeNull();
      expect(parseIsoToUnixSeconds(null as any)).toBeNull();
      expect(parseIsoToUnixSeconds(undefined as any)).toBeNull();
    });
  });

  describe("transformIndexCandles", () => {
    test("converts fixed-point index OHLC units to index points (dividing by 100)", () => {
      const mockCandles: MarketIndexCandleDto[] = [
        {
          indexId: "idx-1",
          interval: "1m",
          openTime: "2026-11-18T03:45:00.000Z",
          closeTime: "2026-11-18T03:46:00.000Z",
          openValue: 2400000, // 24,000.00
          highValue: 2405050, // 24,050.50
          lowValue: 2399000, // 23,990.00
          closeValue: 2402525, // 24,025.25
          source: "SIMULATED",
        },
      ];

      const result = transformIndexCandles(mockCandles);
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(24000.0);
      expect(result[0].high).toBe(24050.5);
      expect(result[0].low).toBe(23990.0);
      expect(result[0].close).toBe(24025.25);
      expect(result[0].time).toBe(1794973500);
    });

    test("returns empty array for empty candle list", () => {
      expect(transformIndexCandles([])).toEqual([]);
      expect(transformIndexCandles(null as any)).toEqual([]);
    });

    test("filters out records with invalid timestamps or non-finite OHLC values", () => {
      const invalidCandles: MarketIndexCandleDto[] = [
        {
          indexId: "idx-1",
          interval: "1m",
          openTime: "invalid-date",
          closeTime: "2026-11-18T03:46:00.000Z",
          openValue: 2400000,
          highValue: 2405000,
          lowValue: 2399000,
          closeValue: 2402500,
          source: "SIMULATED",
        },
        {
          indexId: "idx-1",
          interval: "1m",
          openTime: "2026-11-18T03:46:00.000Z",
          closeTime: "2026-11-18T03:47:00.000Z",
          openValue: NaN,
          highValue: 2405000,
          lowValue: 2399000,
          closeValue: 2402500,
          source: "SIMULATED",
        },
      ];

      const result = transformIndexCandles(invalidCandles);
      expect(result).toHaveLength(0);
    });
  });

  describe("transformEquityCandles", () => {
    test("converts integer paise OHLC values to rupees (dividing by 100)", () => {
      const mockCandles: InstrumentCandleDto[] = [
        {
          instrumentId: "eq-1",
          interval: "1m",
          openTime: "2026-11-18T03:45:00.000Z",
          closeTime: "2026-11-18T03:46:00.000Z",
          openPaise: 250000, // ₹2,500.00
          highPaise: 251550, // ₹2,515.50
          lowPaise: 249500, // ₹2,495.00
          closePaise: 251025, // ₹2,510.25
          source: "SIMULATED",
        },
      ];

      const result = transformEquityCandles(mockCandles);
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(2500.0);
      expect(result[0].high).toBe(2515.5);
      expect(result[0].low).toBe(2495.0);
      expect(result[0].close).toBe(2510.25);
      expect(result[0].time).toBe(1794973500);
    });

    test("returns empty array for empty candle list", () => {
      expect(transformEquityCandles([])).toEqual([]);
      expect(transformEquityCandles(null as any)).toEqual([]);
    });

    test("filters out invalid timestamps or non-finite paise values", () => {
      const invalidCandles: InstrumentCandleDto[] = [
        {
          instrumentId: "eq-1",
          interval: "1m",
          openTime: "corrupted",
          closeTime: "2026-11-18T03:46:00.000Z",
          openPaise: 250000,
          highPaise: 251550,
          lowPaise: 249500,
          closePaise: 251025,
          source: "SIMULATED",
        },
      ];

      expect(transformEquityCandles(invalidCandles)).toHaveLength(0);
    });
  });

  describe("sortAndDeduplicateCandles", () => {
    test("sorts out-of-order candles chronologically ascending", () => {
      const unsorted = [
        { time: 1794973620 as any, open: 102, high: 105, low: 101, close: 104 },
        { time: 1794973500 as any, open: 100, high: 103, low: 99, close: 102 },
        { time: 1794973560 as any, open: 101, high: 104, low: 100, close: 103 },
      ];

      const result = sortAndDeduplicateCandles(unsorted);
      expect(result.map((c) => c.time)).toEqual([1794973500, 1794973560, 1794973620]);
    });

    test("deduplicates identical timestamps by keeping the latter record", () => {
      const duplicateCandles = [
        { time: 1794973500 as any, open: 100, high: 103, low: 99, close: 101 },
        { time: 1794973500 as any, open: 100, high: 105, low: 98, close: 104 }, // updated close
        { time: 1794973560 as any, open: 104, high: 106, low: 103, close: 105 },
      ];

      const result = sortAndDeduplicateCandles(duplicateCandles);
      expect(result).toHaveLength(2);
      expect(result[0].time).toBe(1794973500);
      expect(result[0].close).toBe(104);
      expect(result[1].time).toBe(1794973560);
    });
  });

  describe("formatUnixTimestampToIST", () => {
    test("formats intraday timestamp into Asia/Kolkata date and time", () => {
      // 2026-11-18T03:45:00.000Z is 09:15 AM IST (03:45 + 05:30)
      const unixSeconds = 1794973500;
      const formatted = formatUnixTimestampToIST(unixSeconds, "1m");
      expect(formatted).toMatch(/18\s+Nov,\s+09:15/);
    });

    test("formats daily timestamp into Asia/Kolkata date", () => {
      // 2026-11-17T18:30:00.000Z corresponds to 2026-11-18 00:00 IST
      const dailyOpenSeconds = Math.floor(
        Date.parse("2026-11-17T18:30:00.000Z") / 1000
      );
      const formatted = formatUnixTimestampToIST(dailyOpenSeconds, "1d");
      expect(formatted).toMatch(/18\s+Nov\s+2026/);
    });
  });

  describe("formatChartPrice", () => {
    test("formats index values without rupee symbol", () => {
      expect(formatChartPrice(24120.5, true)).toBe("24,120.50");
      expect(formatChartPrice(80550.25, true)).toBe("80,550.25");
    });

    test("formats equity values with rupee symbol", () => {
      expect(formatChartPrice(2500.5, false)).toBe("₹2,500.50");
      expect(formatChartPrice(1850.0, false)).toBe("₹1,850.00");
    });
  });
});

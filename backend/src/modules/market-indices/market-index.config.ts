import {
  MARKET_INDEX_METHODOLOGY,
  MarketIndexSymbol,
  SIMULATED_MARKET_INDEX_SOURCE,
} from "./market-index.types";

/**
 * Fixed-point base value for Synthetic NIFTY 50:
 * 2,400,000 fixed-point units = 24,000.00 index points.
 */
export const NIFTY50_BASE_VALUE = 2_400_000 as const;

/**
 * Fixed-point base value for Synthetic SENSEX:
 * 7,900,000 fixed-point units = 79,000.00 index points.
 */
export const SENSEX_BASE_VALUE = 7_900_000 as const;

/**
 * All 50 NSE equity symbols in NIVORA's synthetic catalog (sorted alphabetically)
 * forming the constituent basket of Synthetic NIFTY 50.
 * Equal weight: 50 constituents * 200 bps = 10,000 bps (100.00%).
 */
export const NIFTY50_CONSTITUENT_SYMBOLS: readonly string[] = Object.freeze([
  "ADANIENT",
  "ADANIPORTS",
  "APOLLOHOSP",
  "ASIANPAINT",
  "AXISBANK",
  "BAJAJ-AUTO",
  "BAJAJFINSV",
  "BAJFINANCE",
  "BHARTIARTL",
  "BPCL",
  "BRITANNIA",
  "CIPLA",
  "COALINDIA",
  "DIVISLAB",
  "DRREDDY",
  "EICHERMOT",
  "GRASIM",
  "HCLTECH",
  "HDFCBANK",
  "HDFCLIFE",
  "HEROMOTOCO",
  "HINDALCO",
  "HINDUNILVR",
  "ICICIBANK",
  "INDUSINDBK",
  "INFY",
  "ITC",
  "JSWSTEEL",
  "KOTAKBANK",
  "LT",
  "LTIM",
  "M&M",
  "MARUTI",
  "NESTLEIND",
  "NTPC",
  "ONGC",
  "POWERGRID",
  "RELIANCE",
  "SBILIFE",
  "SBIN",
  "SUNPHARMA",
  "TATACOMM",
  "TATACONSUM",
  "TATAMOTORS",
  "TATASTEEL",
  "TCS",
  "TECHM",
  "TITAN",
  "ULTRACEMCO",
  "WIPRO",
]);

/**
 * Documented 30 large-cap NSE equity symbols from NIVORA's 50-stock catalog
 * (sorted alphabetically) forming the constituent basket of Synthetic SENSEX.
 * Deterministic equal weight: first 10 alphabetical symbols receive 334 bps (3,340 bps)
 * and remaining 20 symbols receive 333 bps (6,660 bps), totaling 10,000 bps (100.00%).
 */
export const SENSEX_CONSTITUENT_SYMBOLS: readonly string[] = Object.freeze([
  "ADANIPORTS",
  "ASIANPAINT",
  "AXISBANK",
  "BAJAJ-AUTO",
  "BAJAJFINSV",
  "BAJFINANCE",
  "BHARTIARTL",
  "HCLTECH",
  "HDFCBANK",
  "HINDALCO",
  "HINDUNILVR",
  "ICICIBANK",
  "INDUSINDBK",
  "INFY",
  "ITC",
  "JSWSTEEL",
  "KOTAKBANK",
  "LT",
  "M&M",
  "MARUTI",
  "NESTLEIND",
  "NTPC",
  "POWERGRID",
  "RELIANCE",
  "SBIN",
  "SUNPHARMA",
  "TATAMOTORS",
  "TATASTEEL",
  "TCS",
  "TITAN",
]);

export interface MarketIndexCatalogDefinition {
  readonly symbol: MarketIndexSymbol;
  readonly name: string;
  readonly description: string;
  readonly baseValue: number;
  readonly constituentSymbols: readonly string[];
  readonly methodology: typeof MARKET_INDEX_METHODOLOGY;
  readonly source: typeof SIMULATED_MARKET_INDEX_SOURCE;
}

export const SYNTHETIC_MARKET_INDEX_DEFINITIONS: Readonly<
  Record<MarketIndexSymbol, MarketIndexCatalogDefinition>
> = Object.freeze({
  NIFTY50: Object.freeze({
    symbol: "NIFTY50",
    name: "NIFTY 50 (Simulated)",
    description:
      "Synthetic equal-weighted benchmark index derived from all 50 NIVORA NSE practice equities (200 bps per constituent; base 24,000.00 index points = 2,400,000 fixed-point units).",
    baseValue: NIFTY50_BASE_VALUE,
    constituentSymbols: NIFTY50_CONSTITUENT_SYMBOLS,
    methodology: MARKET_INDEX_METHODOLOGY,
    source: SIMULATED_MARKET_INDEX_SOURCE,
  }),
  SENSEX: Object.freeze({
    symbol: "SENSEX",
    name: "BSE SENSEX (Simulated)",
    description:
      "Synthetic equal-weighted large-cap index derived from 30 flagship NIVORA NSE practice equities (334/333 bps per constituent totaling 10,000 bps; base 79,000.00 index points = 7,900,000 fixed-point units).",
    baseValue: SENSEX_BASE_VALUE,
    constituentSymbols: SENSEX_CONSTITUENT_SYMBOLS,
    methodology: MARKET_INDEX_METHODOLOGY,
    source: SIMULATED_MARKET_INDEX_SOURCE,
  }),
});

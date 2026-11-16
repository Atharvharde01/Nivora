import { IInstrument, InstrumentExchange } from "../../src/modules/instruments/instrument.types";

/**
 * Exact shape of an instrument seed document matching `InstrumentSchema` (`strict: "throw"`).
 * Contains only fields supported by the Mongoose `Instrument` schema.
 */
export type InstrumentSeedRecord = Omit<IInstrument, "createdAt" | "updatedAt">;

/**
 * Sector categories covered by the 50-stock synthetic NSE catalog.
 * Kept in a separate metadata structure so `InstrumentSeedRecord` strictly adheres
 * to the persisted `InstrumentSchema` fields (`strict: "throw"`).
 */
export type InstrumentSectorCategory =
  | "Banking & Financial Services"
  | "Information Technology"
  | "Energy & Power"
  | "FMCG"
  | "Automobiles"
  | "Pharmaceuticals & Healthcare"
  | "Infrastructure & Construction"
  | "Telecommunications"
  | "Metals & Mining"
  | "Consumer Goods & Retail";

/**
 * Deterministic baseline timestamp for static catalog inspection and unit tests.
 * When seeding via `seedInstruments`, callers can pass a runtime `Date` (defaulting to `new Date()`).
 */
export const DEFAULT_SEED_PRICE_UPDATED_AT = new Date("2026-11-16T09:15:00.000Z");

interface RawCatalogEntry {
  readonly symbol: string;
  readonly name: string;
  readonly sector: InstrumentSectorCategory;
  readonly lastPricePaise: number;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly previousClosePaise: number;
  readonly isStarterWatchlist: boolean;
}

/**
 * Controlled catalog of 50 recognizable Indian NSE equity instruments with
 * synthetic starting prices in integer paise (₹1.00 = 100 paise).
 *
 * NOTE: All prices below are synthetic practice-market starting values created
 * exclusively for the NIVORA simulation environment, not live NSE market feeds.
 */
const RAW_NSE_CATALOG: readonly RawCatalogEntry[] = [
  // ===========================================================================
  // 1. BANKING & FINANCIAL SERVICES (10 Instruments)
  // ===========================================================================
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 168500, // ₹1,685.00
    bidPricePaise: 168450,  // ₹1,684.50
    askPricePaise: 168550,  // ₹1,685.50
    previousClosePaise: 167200, // ₹1,672.00
    isStarterWatchlist: true,
  },
  {
    symbol: "ICICIBANK",
    name: "ICICI Bank Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 124500, // ₹1,245.00
    bidPricePaise: 124450,  // ₹1,244.50
    askPricePaise: 124550,  // ₹1,245.50
    previousClosePaise: 123100, // ₹1,231.00
    isStarterWatchlist: true,
  },
  {
    symbol: "SBIN",
    name: "State Bank of India",
    sector: "Banking & Financial Services",
    lastPricePaise: 82000,  // ₹820.00
    bidPricePaise: 81975,   // ₹819.75
    askPricePaise: 82025,   // ₹820.25
    previousClosePaise: 81250,  // ₹812.50
    isStarterWatchlist: true,
  },
  {
    symbol: "AXISBANK",
    name: "Axis Bank Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 116000, // ₹1,160.00
    bidPricePaise: 115950,  // ₹1,159.50
    askPricePaise: 116050,  // ₹1,160.50
    previousClosePaise: 114800, // ₹1,148.00
    isStarterWatchlist: false,
  },
  {
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 179000, // ₹1,790.00
    bidPricePaise: 178950,  // ₹1,789.50
    askPricePaise: 179050,  // ₹1,790.50
    previousClosePaise: 180200, // ₹1,802.00
    isStarterWatchlist: false,
  },
  {
    symbol: "BAJFINANCE",
    name: "Bajaj Finance Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 695000, // ₹6,950.00
    bidPricePaise: 694800,  // ₹6,948.00
    askPricePaise: 695200,  // ₹6,952.00
    previousClosePaise: 689000, // ₹6,890.00
    isStarterWatchlist: true,
  },
  {
    symbol: "BAJAJFINSV",
    name: "Bajaj Finserv Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 164000, // ₹1,640.00
    bidPricePaise: 163950,  // ₹1,639.50
    askPricePaise: 164050,  // ₹1,640.50
    previousClosePaise: 162500, // ₹1,625.00
    isStarterWatchlist: false,
  },
  {
    symbol: "INDUSINDBK",
    name: "IndusInd Bank Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 138000, // ₹1,380.00
    bidPricePaise: 137950,  // ₹1,379.50
    askPricePaise: 138050,  // ₹1,380.50
    previousClosePaise: 139400, // ₹1,394.00
    isStarterWatchlist: false,
  },
  {
    symbol: "HDFCLIFE",
    name: "HDFC Life Insurance Company Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 69500,  // ₹695.00
    bidPricePaise: 69475,   // ₹694.75
    askPricePaise: 69525,   // ₹695.25
    previousClosePaise: 68800,  // ₹688.00
    isStarterWatchlist: false,
  },
  {
    symbol: "SBILIFE",
    name: "SBI Life Insurance Company Limited",
    sector: "Banking & Financial Services",
    lastPricePaise: 156000, // ₹1,560.00
    bidPricePaise: 155950,  // ₹1,559.50
    askPricePaise: 156050,  // ₹1,560.50
    previousClosePaise: 154500, // ₹1,545.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 2. INFORMATION TECHNOLOGY (6 Instruments)
  // ===========================================================================
  {
    symbol: "TCS",
    name: "Tata Consultancy Services Limited",
    sector: "Information Technology",
    lastPricePaise: 412000, // ₹4,120.00
    bidPricePaise: 411900,  // ₹4,119.00
    askPricePaise: 412100,  // ₹4,121.00
    previousClosePaise: 409500, // ₹4,095.00
    isStarterWatchlist: true,
  },
  {
    symbol: "INFY",
    name: "Infosys Limited",
    sector: "Information Technology",
    lastPricePaise: 186000, // ₹1,860.00
    bidPricePaise: 185950,  // ₹1,859.50
    askPricePaise: 186050,  // ₹1,860.50
    previousClosePaise: 184200, // ₹1,842.00
    isStarterWatchlist: true,
  },
  {
    symbol: "HCLTECH",
    name: "HCL Technologies Limited",
    sector: "Information Technology",
    lastPricePaise: 178500, // ₹1,785.00
    bidPricePaise: 178450,  // ₹1,784.50
    askPricePaise: 178550,  // ₹1,785.50
    previousClosePaise: 176900, // ₹1,769.00
    isStarterWatchlist: false,
  },
  {
    symbol: "WIPRO",
    name: "Wipro Limited",
    sector: "Information Technology",
    lastPricePaise: 54500,  // ₹545.00
    bidPricePaise: 54475,   // ₹544.75
    askPricePaise: 54525,   // ₹545.25
    previousClosePaise: 53950,  // ₹539.50
    isStarterWatchlist: false,
  },
  {
    symbol: "TECHM",
    name: "Tech Mahindra Limited",
    sector: "Information Technology",
    lastPricePaise: 162500, // ₹1,625.00
    bidPricePaise: 162450,  // ₹1,624.50
    askPricePaise: 162550,  // ₹1,625.50
    previousClosePaise: 161000, // ₹1,610.00
    isStarterWatchlist: false,
  },
  {
    symbol: "LTIM",
    name: "LTIMindtree Limited",
    sector: "Information Technology",
    lastPricePaise: 598000, // ₹5,980.00
    bidPricePaise: 597800,  // ₹5,978.00
    askPricePaise: 598200,  // ₹5,982.00
    previousClosePaise: 592500, // ₹5,925.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 3. ENERGY & POWER (6 Instruments)
  // ===========================================================================
  {
    symbol: "RELIANCE",
    name: "Reliance Industries Limited",
    sector: "Energy & Power",
    lastPricePaise: 254000, // ₹2,540.00
    bidPricePaise: 253950,  // ₹2,539.50
    askPricePaise: 254050,  // ₹2,540.50
    previousClosePaise: 251800, // ₹2,518.00
    isStarterWatchlist: true,
  },
  {
    symbol: "ONGC",
    name: "Oil and Natural Gas Corporation Limited",
    sector: "Energy & Power",
    lastPricePaise: 28600,  // ₹286.00
    bidPricePaise: 28585,   // ₹285.85
    askPricePaise: 28615,   // ₹286.15
    previousClosePaise: 28900,  // ₹289.00
    isStarterWatchlist: false,
  },
  {
    symbol: "NTPC",
    name: "NTPC Limited",
    sector: "Energy & Power",
    lastPricePaise: 39800,  // ₹398.00
    bidPricePaise: 39780,   // ₹397.80
    askPricePaise: 39820,   // ₹398.20
    previousClosePaise: 39450,  // ₹394.50
    isStarterWatchlist: false,
  },
  {
    symbol: "POWERGRID",
    name: "Power Grid Corporation of India Limited",
    sector: "Energy & Power",
    lastPricePaise: 33200,  // ₹332.00
    bidPricePaise: 33185,   // ₹331.85
    askPricePaise: 33215,   // ₹332.15
    previousClosePaise: 32950,  // ₹329.50
    isStarterWatchlist: false,
  },
  {
    symbol: "COALINDIA",
    name: "Coal India Limited",
    sector: "Energy & Power",
    lastPricePaise: 46500,  // ₹465.00
    bidPricePaise: 46475,   // ₹464.75
    askPricePaise: 46525,   // ₹465.25
    previousClosePaise: 46100,  // ₹461.00
    isStarterWatchlist: false,
  },
  {
    symbol: "BPCL",
    name: "Bharat Petroleum Corporation Limited",
    sector: "Energy & Power",
    lastPricePaise: 31800,  // ₹318.00
    bidPricePaise: 31785,   // ₹317.85
    askPricePaise: 31815,   // ₹318.15
    previousClosePaise: 32100,  // ₹321.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 4. AUTOMOBILES (6 Instruments)
  // ===========================================================================
  {
    symbol: "TATAMOTORS",
    name: "Tata Motors Limited",
    sector: "Automobiles",
    lastPricePaise: 94500,  // ₹945.00
    bidPricePaise: 94475,   // ₹944.75
    askPricePaise: 94525,   // ₹945.25
    previousClosePaise: 93600,  // ₹936.00
    isStarterWatchlist: true,
  },
  {
    symbol: "MARUTI",
    name: "Maruti Suzuki India Limited",
    sector: "Automobiles",
    lastPricePaise: 1215000, // ₹12,150.00
    bidPricePaise: 1214700,  // ₹12,147.00
    askPricePaise: 1215300,  // ₹12,153.00
    previousClosePaise: 1204000, // ₹12,040.00
    isStarterWatchlist: true,
  },
  {
    symbol: "M&M",
    name: "Mahindra & Mahindra Limited",
    sector: "Automobiles",
    lastPricePaise: 289000, // ₹2,890.00
    bidPricePaise: 288900,  // ₹2,889.00
    askPricePaise: 289100,  // ₹2,891.00
    previousClosePaise: 286500, // ₹2,865.00
    isStarterWatchlist: false,
  },
  {
    symbol: "BAJAJ-AUTO",
    name: "Bajaj Auto Limited",
    sector: "Automobiles",
    lastPricePaise: 985000, // ₹9,850.00
    bidPricePaise: 984750,  // ₹9,847.50
    askPricePaise: 985250,  // ₹9,852.50
    previousClosePaise: 978000, // ₹9,780.00
    isStarterWatchlist: false,
  },
  {
    symbol: "EICHERMOT",
    name: "Eicher Motors Limited",
    sector: "Automobiles",
    lastPricePaise: 476000, // ₹4,760.00
    bidPricePaise: 475850,  // ₹4,758.50
    askPricePaise: 476150,  // ₹4,761.50
    previousClosePaise: 472500, // ₹4,725.00
    isStarterWatchlist: false,
  },
  {
    symbol: "HEROMOTOCO",
    name: "Hero MotoCorp Limited",
    sector: "Automobiles",
    lastPricePaise: 512000, // ₹5,120.00
    bidPricePaise: 511850,  // ₹5,118.50
    askPricePaise: 512150,  // ₹5,121.50
    previousClosePaise: 516000, // ₹5,160.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 5. FMCG (5 Instruments)
  // ===========================================================================
  {
    symbol: "ITC",
    name: "ITC Limited",
    sector: "FMCG",
    lastPricePaise: 48800,  // ₹488.00
    bidPricePaise: 48780,   // ₹487.80
    askPricePaise: 48820,   // ₹488.20
    previousClosePaise: 48450,  // ₹484.50
    isStarterWatchlist: true,
  },
  {
    symbol: "HINDUNILVR",
    name: "Hindustan Unilever Limited",
    sector: "FMCG",
    lastPricePaise: 264000, // ₹2,640.00
    bidPricePaise: 263900,  // ₹2,639.00
    askPricePaise: 264100,  // ₹2,641.00
    previousClosePaise: 262200, // ₹2,622.00
    isStarterWatchlist: true,
  },
  {
    symbol: "NESTLEIND",
    name: "Nestle India Limited",
    sector: "FMCG",
    lastPricePaise: 248000, // ₹2,480.00
    bidPricePaise: 247900,  // ₹2,479.00
    askPricePaise: 248100,  // ₹2,481.00
    previousClosePaise: 249500, // ₹2,495.00
    isStarterWatchlist: false,
  },
  {
    symbol: "BRITANNIA",
    name: "Britannia Industries Limited",
    sector: "FMCG",
    lastPricePaise: 562000, // ₹5,620.00
    bidPricePaise: 561800,  // ₹5,618.00
    askPricePaise: 562200,  // ₹5,622.00
    previousClosePaise: 558000, // ₹5,580.00
    isStarterWatchlist: false,
  },
  {
    symbol: "TATACONSUM",
    name: "Tata Consumer Products Limited",
    sector: "FMCG",
    lastPricePaise: 108500, // ₹1,085.00
    bidPricePaise: 108450,  // ₹1,084.50
    askPricePaise: 108550,  // ₹1,085.50
    previousClosePaise: 107600, // ₹1,076.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 6. PHARMACEUTICALS & HEALTHCARE (5 Instruments)
  // ===========================================================================
  {
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical Industries Limited",
    sector: "Pharmaceuticals & Healthcare",
    lastPricePaise: 184000, // ₹1,840.00
    bidPricePaise: 183950,  // ₹1,839.50
    askPricePaise: 184050,  // ₹1,840.50
    previousClosePaise: 182500, // ₹1,825.00
    isStarterWatchlist: true,
  },
  {
    symbol: "DRREDDY",
    name: "Dr. Reddy's Laboratories Limited",
    sector: "Pharmaceuticals & Healthcare",
    lastPricePaise: 134500, // ₹1,345.00
    bidPricePaise: 134450,  // ₹1,344.50
    askPricePaise: 134550,  // ₹1,345.50
    previousClosePaise: 133200, // ₹1,332.00
    isStarterWatchlist: false,
  },
  {
    symbol: "CIPLA",
    name: "Cipla Limited",
    sector: "Pharmaceuticals & Healthcare",
    lastPricePaise: 158000, // ₹1,580.00
    bidPricePaise: 157950,  // ₹1,579.50
    askPricePaise: 158050,  // ₹1,580.50
    previousClosePaise: 159200, // ₹1,592.00
    isStarterWatchlist: false,
  },
  {
    symbol: "APOLLOHOSP",
    name: "Apollo Hospitals Enterprise Limited",
    sector: "Pharmaceuticals & Healthcare",
    lastPricePaise: 689000, // ₹6,890.00
    bidPricePaise: 688800,  // ₹6,888.00
    askPricePaise: 689200,  // ₹6,892.00
    previousClosePaise: 684000, // ₹6,840.00
    isStarterWatchlist: false,
  },
  {
    symbol: "DIVISLAB",
    name: "Divi's Laboratories Limited",
    sector: "Pharmaceuticals & Healthcare",
    lastPricePaise: 542000, // ₹5,420.00
    bidPricePaise: 541800,  // ₹5,418.00
    askPricePaise: 542200,  // ₹5,422.00
    previousClosePaise: 537500, // ₹5,375.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 7. INFRASTRUCTURE & CONSTRUCTION (4 Instruments)
  // ===========================================================================
  {
    symbol: "LT",
    name: "Larsen & Toubro Limited",
    sector: "Infrastructure & Construction",
    lastPricePaise: 362000, // ₹3,620.00
    bidPricePaise: 361900,  // ₹3,619.00
    askPricePaise: 362100,  // ₹3,621.00
    previousClosePaise: 359000, // ₹3,590.00
    isStarterWatchlist: true,
  },
  {
    symbol: "ULTRACEMCO",
    name: "UltraTech Cement Limited",
    sector: "Infrastructure & Construction",
    lastPricePaise: 1125000, // ₹11,250.00
    bidPricePaise: 1124700,  // ₹11,247.00
    askPricePaise: 1125300,  // ₹11,253.00
    previousClosePaise: 1118000, // ₹11,180.00
    isStarterWatchlist: false,
  },
  {
    symbol: "GRASIM",
    name: "Grasim Industries Limited",
    sector: "Infrastructure & Construction",
    lastPricePaise: 268000, // ₹2,680.00
    bidPricePaise: 267900,  // ₹2,679.00
    askPricePaise: 268100,  // ₹2,681.00
    previousClosePaise: 265500, // ₹2,655.00
    isStarterWatchlist: false,
  },
  {
    symbol: "ADANIPORTS",
    name: "Adani Ports and Special Economic Zone Limited",
    sector: "Infrastructure & Construction",
    lastPricePaise: 139000, // ₹1,390.00
    bidPricePaise: 138950,  // ₹1,389.50
    askPricePaise: 139050,  // ₹1,390.50
    previousClosePaise: 137800, // ₹1,378.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 8. METALS & MINING (4 Instruments)
  // ===========================================================================
  {
    symbol: "TATASTEEL",
    name: "Tata Steel Limited",
    sector: "Metals & Mining",
    lastPricePaise: 15400,  // ₹154.00
    bidPricePaise: 15390,   // ₹153.90
    askPricePaise: 15410,   // ₹154.10
    previousClosePaise: 15250,  // ₹152.50
    isStarterWatchlist: false,
  },
  {
    symbol: "JSWSTEEL",
    name: "JSW Steel Limited",
    sector: "Metals & Mining",
    lastPricePaise: 96500,  // ₹965.00
    bidPricePaise: 96475,   // ₹964.75
    askPricePaise: 96525,   // ₹965.25
    previousClosePaise: 95800,  // ₹958.00
    isStarterWatchlist: false,
  },
  {
    symbol: "HINDALCO",
    name: "Hindalco Industries Limited",
    sector: "Metals & Mining",
    lastPricePaise: 67800,  // ₹678.00
    bidPricePaise: 67775,   // ₹677.75
    askPricePaise: 67825,   // ₹678.25
    previousClosePaise: 67100,  // ₹671.00
    isStarterWatchlist: false,
  },
  {
    symbol: "ADANIENT",
    name: "Adani Enterprises Limited",
    sector: "Metals & Mining",
    lastPricePaise: 298000, // ₹2,980.00
    bidPricePaise: 297900,  // ₹2,979.00
    askPricePaise: 298100,  // ₹2,981.00
    previousClosePaise: 301000, // ₹3,010.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 9. TELECOMMUNICATIONS (2 Instruments)
  // ===========================================================================
  {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Limited",
    sector: "Telecommunications",
    lastPricePaise: 164500, // ₹1,645.00
    bidPricePaise: 164450,  // ₹1,644.50
    askPricePaise: 164550,  // ₹1,645.50
    previousClosePaise: 162800, // ₹1,628.00
    isStarterWatchlist: true,
  },
  {
    symbol: "TATACOMM",
    name: "Tata Communications Limited",
    sector: "Telecommunications",
    lastPricePaise: 189000, // ₹1,890.00
    bidPricePaise: 188950,  // ₹1,889.50
    askPricePaise: 189050,  // ₹1,890.50
    previousClosePaise: 187500, // ₹1,875.00
    isStarterWatchlist: false,
  },

  // ===========================================================================
  // 10. CONSUMER GOODS & RETAIL (2 Instruments)
  // ===========================================================================
  {
    symbol: "ASIANPAINT",
    name: "Asian Paints Limited",
    sector: "Consumer Goods & Retail",
    lastPricePaise: 294000, // ₹2,940.00
    bidPricePaise: 293900,  // ₹2,939.00
    askPricePaise: 294100,  // ₹2,941.00
    previousClosePaise: 296500, // ₹2,965.00
    isStarterWatchlist: false,
  },
  {
    symbol: "TITAN",
    name: "Titan Company Limited",
    sector: "Consumer Goods & Retail",
    lastPricePaise: 348000, // ₹3,480.00
    bidPricePaise: 347900,  // ₹3,479.00
    askPricePaise: 348100,  // ₹3,481.00
    previousClosePaise: 345200, // ₹3,452.00
    isStarterWatchlist: true,
  },
];

/**
 * Separate sector metadata map keyed by NSE symbol.
 * Preserves sector classification for documentation/reporting without adding
 * non-schema fields to `InstrumentSeedRecord`.
 */
export const INSTRUMENT_SECTOR_METADATA: Readonly<
  Record<string, InstrumentSectorCategory>
> = Object.freeze(
  Object.fromEntries(RAW_NSE_CATALOG.map((entry) => [entry.symbol, entry.sector]))
);

/**
 * Builds the 50-stock NSE instrument catalog stamped with the given `priceUpdatedAt` date.
 * Returns frozen `InstrumentSeedRecord` objects containing strictly the fields defined
 * on `InstrumentSchema`.
 */
export function buildNseInstrumentSeedCatalog(
  priceUpdatedAt: Date = DEFAULT_SEED_PRICE_UPDATED_AT
): readonly Readonly<InstrumentSeedRecord>[] {
  const stampedDate = new Date(priceUpdatedAt.getTime());
  const exchange: InstrumentExchange = "NSE";

  return Object.freeze(
    RAW_NSE_CATALOG.map((entry) =>
      Object.freeze({
        symbol: entry.symbol,
        name: entry.name,
        exchange,
        isTradable: true,
        lastPricePaise: entry.lastPricePaise,
        bidPricePaise: entry.bidPricePaise,
        askPricePaise: entry.askPricePaise,
        previousClosePaise: entry.previousClosePaise,
        isStarterWatchlist: entry.isStarterWatchlist,
        priceUpdatedAt: new Date(stampedDate.getTime()),
      })
    )
  );
}

/**
 * Default exported 50-stock synthetic NSE instrument catalog.
 */
export const SYNTHETIC_NSE_INSTRUMENTS_SEED: readonly Readonly<InstrumentSeedRecord>[] =
  buildNseInstrumentSeedCatalog(DEFAULT_SEED_PRICE_UPDATED_AT);

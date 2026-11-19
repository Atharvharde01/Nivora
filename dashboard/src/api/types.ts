/**
 * NIVORA Trading Platform — API Type Definitions
 * Typed contracts matching the backend /api/v1 REST endpoints.
 */

export type InstrumentExchange = "NSE" | "BSE";
export type InstrumentType = "equity" | "index";
export type MarketIndexSymbol = "NIFTY50" | "SENSEX";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?:
    | {
        code: string;
        message: string;
        requestId?: string;
      }
    | string;
}

// ==================== INSTRUMENTS & QUOTES ====================

export interface InstrumentSummary {
  _id: string;
  symbol: string;
  name: string;
  exchange: InstrumentExchange;
  isTradable: boolean;
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  isStarterWatchlist?: boolean;
  priceUpdatedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchInstrumentsParams {
  search?: string;
  q?: string;
  exchange?: InstrumentExchange;
  isTradable?: boolean;
  page?: number;
  limit?: number;
}

export interface SearchInstrumentsResult {
  items: InstrumentSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InstrumentQuote {
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  isTradable: boolean;
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  priceUpdatedAt: string;
  quoteSource: string;
  quoteAgeMs: number;
  isStale: boolean;
}

// ==================== MARKET INDICES & CONSTITUENTS ====================

/**
 * Constituent equity inside a synthetic market index.
 * Matches backend `IMarketIndexConstituent`.
 */
export interface MarketIndexConstituent {
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  weightBps: number; // 100 bps = 1.00%
  basePricePaise: number; // In paise
}

/**
 * Synthetic market index summary returned by `GET /api/v1/market/indices`.
 * Values are stored as fixed-point integers (100 units = 1.00 index point).
 */
export interface MarketIndexSummary {
  _id: string;
  symbol: MarketIndexSymbol;
  name: string;
  description: string;
  currentValue: number; // Fixed-point: divide by 100 for display
  baseValue: number;
  previousCloseValue: number;
  changeValue: number; // Fixed-point: divide by 100 for display
  changeBps: number; // Basis points: divide by 100 for percentage
  constituentCount: number;
  methodology: string;
  source: string;
  valueUpdatedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Detailed synthetic market index returned by `GET /api/v1/market/indices/:symbol`.
 * Includes complete constituent equity breakdown.
 */
export interface MarketIndexDetail extends MarketIndexSummary {
  constituents: MarketIndexConstituent[];
}

export interface MarketIndicesListResult {
  items: MarketIndexSummary[];
}

// ==================== CONVERSION & FORMATTING HELPERS ====================

/** Converts backend fixed-point index integer (100 units = 1 pt) to index points */
export function indexValueToPoints(fixedPointValue: number): number {
  return fixedPointValue / 100;
}

/** Converts backend fixed-point change integer to index change points */
export function indexChangeValueToPoints(changeValue: number): number {
  return changeValue / 100;
}

/** Converts basis points (100 bps = 1.00%) to percentage number */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** Converts paise to rupees */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Formats a numerical rupee value with Indian comma separation */
export function formatRupees(rupees: number, decimals: number = 2): string {
  return rupees.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Formats index points with Indian comma separation */
export function formatIndexPoints(points: number, decimals: number = 2): string {
  return points.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ==================== MARKET CANDLES ====================

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export const INITIAL_CANDLE_LIMITS: Readonly<Record<CandleInterval, number>> = Object.freeze({
  "1m": 375,
  "5m": 200,
  "15m": 200,
  "1h": 120,
  "1d": 90,
});

export interface MarketCandlesQuery {
  interval?: CandleInterval;
  from?: string;
  to?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Synthetic market index OHLC candle returned by
 * `GET /api/v1/market/indices/:symbol/candles`.
 * OHLC values are fixed-point integers (100 units = 1.00 index point).
 */
export interface MarketIndexCandleDto {
  indexId: string;
  interval: CandleInterval;
  openTime: string;
  closeTime: string;
  openValue: number; // Divide by 100 for index points
  highValue: number;
  lowValue: number;
  closeValue: number;
  source: string; // "SIMULATED"
}

export interface MarketIndexCandlesResult {
  index: MarketIndexSummary;
  interval: CandleInterval;
  candles: MarketIndexCandleDto[];
}

/**
 * Tradable equity instrument OHLC candle returned by
 * `GET /api/v1/market/instruments/:instrumentId/candles`.
 * OHLC values are in integer paise (100 paise = ₹1.00).
 */
export interface InstrumentCandleDto {
  instrumentId: string;
  interval: CandleInterval;
  openTime: string;
  closeTime: string;
  openPaise: number; // Divide by 100 for rupees
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  source: string; // "SIMULATED"
}

export interface InstrumentCandlesResult {
  instrument: {
    _id: string;
    symbol: string;
    name: string;
    exchange: string;
  };
  interval: CandleInterval;
  candles: InstrumentCandleDto[];
}

// ==================== WATCHLIST ====================

export interface WatchlistQuoteView {
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  priceUpdatedAt: string;
  isStale: boolean;
}

export interface WatchlistItemDto {
  id: string;
  userId: string;
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  isTradable: boolean;
  sortOrder: number;
  quote: WatchlistQuoteView | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistResult {
  items: WatchlistItemDto[];
  count: number;
}

export interface RemoveWatchlistItemResult {
  success: boolean;
  removedInstrumentId: string;
}

// ==================== ORDERS & TRADES ====================

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET";
export type OrderStatus = "RECEIVED" | "EXECUTED" | "REJECTED";

export type OrderRejectionCode =
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_QUANTITY"
  | "INSTRUMENT_UNAVAILABLE"
  | "STALE_QUOTE"
  | "ACCOUNT_INACTIVE"
  | "OVERFLOW_LIMIT_EXCEEDED"
  | "VALIDATION_ERROR";

export interface PlaceOrderPayload {
  instrumentId: string;
  side: OrderSide;
  quantity: number;
  practiceAccountId?: string;
}

export interface OrderDto {
  _id: string;
  userId?: string;
  practiceAccountId?: string;
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  status: OrderStatus;
  idempotencyKey?: string;
  executedQuantity: number;
  executionPricePaise?: number;
  totalValuePaise?: number;
  rejectionCode?: OrderRejectionCode;
  rejectionReason?: string;
  executedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface OrdersListResult {
  items: OrderDto[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface OrderExecutionResult {
  order: OrderDto;
  trade: TradeDto | null;
  status: OrderStatus;
  wasIdempotentReplay: boolean;
  rejectionCode?: OrderRejectionCode;
  rejectionReason?: string;
}

export interface TradeQuoteSnapshot {
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  priceUpdatedAt: string;
}

export interface TradeDto {
  _id: string;
  orderId: string;
  userId: string;
  practiceAccountId: string;
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  side: OrderSide;
  quantity: number;
  executionPricePaise: number;
  totalValuePaise: number;
  costBasisSoldPaise: number;
  realizedPnlPaise: number;
  quoteSnapshot?: TradeQuoteSnapshot;
  executedAt: string;
  createdAt: string;
}

export interface TradesListResult {
  items: TradeDto[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ==================== PORTFOLIO & ACCOUNTS ====================

export interface PortfolioHoldingDto {
  _id: string;
  userId?: string;
  practiceAccountId?: string;
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  quantity: number;
  averageBuyPricePaise: number;
  totalInvestedPaise: number;
  realizedPnlPaise: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioPositionDto {
  instrumentId: string;
  symbol: string;
  exchange: InstrumentExchange;
  quantity: number;
  averageBuyPricePaise: number;
  totalInvestedPaise: number;
  realizedPnlPaise: number;
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  currentMarketValuePaise: number;
  unrealizedPnlPaise: number;
  quoteTimestamp: string;
  quoteAgeMs: number;
  isQuoteStale: boolean;
  isTradable: boolean;
  quoteSource?: string;
}

export interface PortfolioSummaryDto {
  practiceAccountId: string;
  accountNumber: number;
  cashBalancePaise: number;
  totalInvestedPaise: number;
  currentMarketValuePaise: number;
  unrealizedPnlPaise: number;
  realizedPnlPaise: number;
  totalPnlPaise: number;
  activePositionsCount: number;
  hasStaleQuotes: boolean;
}

export interface PortfolioResponseData {
  practiceAccountId: string;
  summary: PortfolioSummaryDto;
  positions: PortfolioPositionDto[];
  activePositionsCount: number;
}

export interface PortfolioViewDto {
  summary: PortfolioSummaryDto;
  positions: PortfolioPositionDto[];
}

export interface PracticeAccountSummaryDto {
  accountId: string;
  id?: string;
  _id?: string;
  userId: string;
  accountNumber: number;
  status: "ACTIVE" | "ARCHIVED";
  isActive?: boolean;
  initialBalancePaise: number;
  cashBalancePaise: number;
  virtualBalancePaise?: number;
  version: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== AUTHENTICATION ====================

export interface AuthUserDto {
  id: string;
  userId?: string;
  email: string;
  emailVerifiedAt?: string;
  displayName?: string;
  status: string;
  onboardingCompleted?: boolean;
  createdAt?: string;
}

export interface UpdateProfilePayload {
  displayName: string;
}

export interface UpdateProfileResult {
  user: AuthUserDto;
}

export interface AuthSessionDto {
  id: string;
  status: string;
  lastActiveAt?: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface AuthRefreshResponse {
  success: boolean;
  accessToken: string;
  user: AuthUserDto;
  session: AuthSessionDto;
}

export interface AuthMeResponse {
  success: boolean;
  user: AuthUserDto;
  session: AuthSessionDto;
}

export interface AuthLogoutResponse {
  success: boolean;
  message: string;
}

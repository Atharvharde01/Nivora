/**
 * NIVORA Trading Platform — API Type Definitions
 * Typed contracts matching the backend /api/v1 REST endpoints.
 */

export type InstrumentExchange = "NSE" | "BSE";
export type InstrumentType = "equity" | "index";

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
  lotSize: number;
  tickSize: number;
  isTradable: boolean;
  currentPricePaise?: number;
  closePricePaise?: number;
  openPricePaise?: number;
  highPricePaise?: number;
  lowPricePaise?: number;
  lastTradedAt?: string;
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
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  priceUpdatedAt: string;
  isStale: boolean;
  quoteSource?: string;
}

// ==================== MARKET INDICES & CANDLES ====================

export interface MarketIndexConstituent {
  instrumentId: string;
  symbol: string;
  weight: number;
  lastPricePaise?: number;
}

export interface MarketIndexSummary {
  symbol: string; // e.g. "NIFTY50", "SENSEX"
  name: string; // e.g. "NIFTY 50", "BSE SENSEX"
  exchange: InstrumentExchange;
  currentValuePaise: number;
  currentValue: number;
  previousClosePaise?: number;
  changePoints: number;
  changePercent: number;
  constituents?: MarketIndexConstituent[];
  updatedAt: string;
}

export interface MarketIndicesListResult {
  items: MarketIndexSummary[];
}

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export interface MarketCandle {
  openTime: string;
  closeTime: string;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  volume: number;
}

export interface MarketCandlesQuery {
  interval?: CandleInterval;
  from?: string;
  to?: string;
  limit?: number;
}

export interface MarketCandlesResult {
  symbol?: string;
  instrumentId?: string;
  interval: CandleInterval;
  candles: MarketCandle[];
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
}

// ==================== ORDERS & TRADES ====================

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET";
export type OrderStatus = "RECEIVED" | "EXECUTED" | "REJECTED";

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
  rejectionCode?: string;
  rejectionReason?: string;
  executedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface OrdersListResult {
  items: OrderDto[];
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

export interface PortfolioViewDto {
  summary: PortfolioSummaryDto;
  positions: PortfolioPositionDto[];
}

export interface PracticeAccountSummaryDto {
  id: string;
  userId: string;
  accountNumber: number;
  virtualBalancePaise: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

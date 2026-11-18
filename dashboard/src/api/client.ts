/**
 * NIVORA Trading Platform — Centralized Typed API Client
 * Configured Axios instance with request/response interceptors,
 * in-memory Bearer token injection, and typed resource operations.
 */

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import {
  ApiResponse,
  MarketCandlesQuery,
  MarketIndexCandlesResult,
  InstrumentCandlesResult,
  MarketIndicesListResult,
  MarketIndexDetail,
  InstrumentQuote,
  InstrumentSummary,
  OrdersListResult,
  PlaceOrderPayload,
  OrderExecutionResult,
  OrderSide,
  OrderStatus,
  PortfolioPositionDto,
  PortfolioResponseData,
  PracticeAccountSummaryDto,
  SearchInstrumentsParams,
  SearchInstrumentsResult,
  TradesListResult,
  WatchlistItemDto,
  WatchlistResult,
  RemoveWatchlistItemResult,
} from "./types";

export const DEFAULT_API_URL = "http://localhost:3002";
export const API_TIMEOUT_MS = 10000;

export const baseURL =
  process.env.REACT_APP_API_URL && process.env.REACT_APP_API_URL.trim().length > 0
    ? process.env.REACT_APP_API_URL.trim()
    : DEFAULT_API_URL;

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

let tokenGetter: (() => string | null) | null = null;
let unauthorizedHandler: (() => void) | null = null;

/**
 * Registers an in-memory token retrieval function.
 * Called by AuthContext to ensure the Bearer token stays in React memory.
 */
export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter;
}

/**
 * Registers a handler called when backend responds with 401 Unauthorized.
 */
export function setOnUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

// Request Interceptor: Attach in-memory bearer token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (tokenGetter) {
      const token = tokenGetter();
      if (token && token.trim().length > 0) {
        config.headers.set("Authorization", `Bearer ${token.trim()}`);
      }
    }
    return config;
  },
  (error: unknown) => Promise.reject(error)
);

// Response Interceptor: Catch 401 and extract meaningful errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    if (error.response?.status === 401) {
      if (unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
    return Promise.reject(error);
  }
);

// ==================== TYPED RESOURCE METHODS ====================

export const MarketApi = {
  /** Fetch all synthetic indices (NIFTY 50, SENSEX) */
  async getIndices(): Promise<ApiResponse<MarketIndicesListResult>> {
    const res = await apiClient.get<ApiResponse<MarketIndicesListResult>>(
      "/api/v1/market/indices"
    );
    return res.data;
  },

  /** Fetch a single market index by symbol with full constituent breakdown */
  async getIndex(symbol: string): Promise<ApiResponse<{ index: MarketIndexDetail }>> {
    const res = await apiClient.get<ApiResponse<{ index: MarketIndexDetail }>>(
      `/api/v1/market/indices/${encodeURIComponent(symbol)}`
    );
    return res.data;
  },

  /** Fetch candles for a market index */
  async getIndexCandles(
    symbol: string,
    query?: MarketCandlesQuery
  ): Promise<ApiResponse<MarketIndexCandlesResult>> {
    const { signal, ...params } = query || {};
    const res = await apiClient.get<ApiResponse<MarketIndexCandlesResult>>(
      `/api/v1/market/indices/${encodeURIComponent(symbol)}/candles`,
      { params, signal }
    );
    return res.data;
  },

  /** Fetch candles for an equity instrument */
  async getInstrumentCandles(
    instrumentId: string,
    query?: MarketCandlesQuery
  ): Promise<ApiResponse<InstrumentCandlesResult>> {
    const { signal, ...params } = query || {};
    const res = await apiClient.get<ApiResponse<InstrumentCandlesResult>>(
      `/api/v1/market/instruments/${encodeURIComponent(instrumentId)}/candles`,
      { params, signal }
    );
    return res.data;
  },
};

export const InstrumentsApi = {
  /** Search instruments with pagination & filters */
  async search(
    params?: SearchInstrumentsParams,
    config?: { signal?: AbortSignal }
  ): Promise<ApiResponse<SearchInstrumentsResult>> {
    const res = await apiClient.get<ApiResponse<SearchInstrumentsResult>>(
      "/api/v1/instruments",
      { params, signal: config?.signal }
    );
    return res.data;
  },

  /** Get instrument details by ID */
  async getById(instrumentId: string): Promise<ApiResponse<{ instrument: InstrumentSummary }>> {
    const res = await apiClient.get<ApiResponse<{ instrument: InstrumentSummary }>>(
      `/api/v1/instruments/${encodeURIComponent(instrumentId)}`
    );
    return res.data;
  },

  /** Get real-time quote for an instrument */
  async getQuote(instrumentId: string): Promise<ApiResponse<{ quote: InstrumentQuote }>> {
    const res = await apiClient.get<ApiResponse<{ quote: InstrumentQuote }>>(
      `/api/v1/instruments/${encodeURIComponent(instrumentId)}/quote`
    );
    return res.data;
  },
};

export const WatchlistApi = {
  /** Fetch active user's watchlist */
  async getWatchlist(): Promise<ApiResponse<WatchlistResult>> {
    const res = await apiClient.get<ApiResponse<WatchlistResult>>("/api/v1/watchlist");
    return res.data;
  },

  /** Add an instrument to user's watchlist */
  async addItem(instrumentId: string): Promise<ApiResponse<{ item: WatchlistItemDto }>> {
    const res = await apiClient.post<ApiResponse<{ item: WatchlistItemDto }>>(
      "/api/v1/watchlist/items",
      { instrumentId }
    );
    return res.data;
  },

  /** Remove an instrument from user's watchlist */
  async removeItem(
    instrumentId: string
  ): Promise<ApiResponse<RemoveWatchlistItemResult>> {
    const res = await apiClient.delete<ApiResponse<RemoveWatchlistItemResult>>(
      `/api/v1/watchlist/items/${encodeURIComponent(instrumentId)}`
    );
    return res.data;
  },

  /** Reorder user's watchlist items */
  async reorder(instrumentIds: string[]): Promise<ApiResponse<WatchlistResult>> {
    const res = await apiClient.patch<ApiResponse<WatchlistResult>>(
      "/api/v1/watchlist/reorder",
      { instrumentIds }
    );
    return res.data;
  },
};

export const OrdersApi = {
  /** List user orders */
  async getOrders(params?: {
    practiceAccountId?: string;
    instrumentId?: string;
    side?: OrderSide;
    status?: OrderStatus;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<OrdersListResult>> {
    const res = await apiClient.get<ApiResponse<OrdersListResult>>("/api/v1/orders", {
      params,
    });
    return res.data;
  },

  /** Place a simulated market order with Idempotency-Key header */
  async placeOrder(
    payload: PlaceOrderPayload,
    idempotencyKey: string
  ): Promise<ApiResponse<OrderExecutionResult>> {
    const res = await apiClient.post<ApiResponse<OrderExecutionResult>>(
      "/api/v1/orders",
      payload,
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      }
    );
    return res.data;
  },
};

export const TradesApi = {
  /** List user trade executions */
  async getTrades(params?: {
    practiceAccountId?: string;
    instrumentId?: string;
    side?: OrderSide;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<TradesListResult>> {
    const res = await apiClient.get<ApiResponse<TradesListResult>>("/api/v1/trades", {
      params,
    });
    return res.data;
  },
};

export const PortfolioApi = {
  /** Get full portfolio (summary and active positions) */
  async getPortfolio(params?: {
    practiceAccountId?: string;
  }): Promise<ApiResponse<PortfolioResponseData>> {
    const res = await apiClient.get<ApiResponse<PortfolioResponseData>>(
      "/api/v1/portfolio",
      { params }
    );
    return res.data;
  },

  /** Get specific position by instrument ID */
  async getPositionByInstrumentId(
    instrumentId: string,
    params?: { practiceAccountId?: string }
  ): Promise<ApiResponse<{ position: PortfolioPositionDto }>> {
    const res = await apiClient.get<ApiResponse<{ position: PortfolioPositionDto }>>(
      `/api/v1/portfolio/positions/${encodeURIComponent(instrumentId)}`,
      { params }
    );
    return res.data;
  },
};

export const AccountsApi = {
  /** Get current active practice account details */
  async getActiveAccount(): Promise<ApiResponse<{ account: PracticeAccountSummaryDto }>> {
    const res = await apiClient.get<ApiResponse<{ account: PracticeAccountSummaryDto }>>(
      "/api/v1/accounts/active"
    );
    return res.data;
  },
};

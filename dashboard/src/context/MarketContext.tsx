/**
 * NIVORA Trading Platform — Market & Workspace Context
 * Manages the globally selected instrument (equity or synthetic index),
 * real-time synthetic indices overview with 5-second polling,
 * expandable index constituents cache, selected-equity quote polling,
 * and buy/sell order action window states.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { InstrumentsApi, MarketApi } from "../api/client";
import {
  InstrumentExchange,
  InstrumentQuote,
  InstrumentType,
  MarketIndexDetail,
  MarketIndexSummary,
  MarketIndexSymbol,
} from "../api/types";
import { useAuth } from "./AuthContext";

export const INDEX_POLL_INTERVAL_MS = 5000;
export const QUOTE_POLL_INTERVAL_MS = 5000;

export interface SelectedInstrument {
  symbol: string;
  name: string;
  type: InstrumentType;
  exchange: InstrumentExchange;
  instrumentId?: string;
  // Index reference symbol if type === "index"
  indexSymbol?: MarketIndexSymbol;
  // Fallback quote metrics if available
  lastPricePaise?: number;
  previousClosePaise?: number;
  isTradable?: boolean;
}

export const DEFAULT_SELECTED_INSTRUMENT: SelectedInstrument = {
  symbol: "NIFTY 50",
  name: "NIFTY 50 Synthetic Index",
  type: "index",
  exchange: "NSE",
  indexSymbol: "NIFTY50",
};

export interface MarketContextType {
  selectedInstrument: SelectedInstrument;
  selectInstrument: (instrument: SelectedInstrument) => void;

  // Live Synthetic Indices
  indices: MarketIndexSummary[];
  indicesLoading: boolean;
  indicesError: string | null;
  refreshIndices: () => Promise<void>;

  // Expandable Index Constituents
  expandedIndices: Record<MarketIndexSymbol, boolean>;
  indexDetailsCache: Partial<Record<MarketIndexSymbol, MarketIndexDetail>>;
  indexDetailsLoading: Partial<Record<MarketIndexSymbol, boolean>>;
  indexDetailsError: Partial<Record<MarketIndexSymbol, string | null>>;
  toggleExpandIndex: (symbol: MarketIndexSymbol) => Promise<void>;

  // Selected Equity Live Quote
  selectedQuote: InstrumentQuote | null;
  selectedQuoteLoading: boolean;
  selectedQuoteError: string | null;
  refreshSelectedQuote: () => Promise<void>;

  // Buy/Sell Order Action Windows
  isBuyWindowOpen: boolean;
  isSellWindowOpen: boolean;
  actionInstrument: SelectedInstrument | null;
  openBuyWindow: (instrument?: SelectedInstrument) => void;
  openSellWindow: (instrument?: SelectedInstrument) => void;
  closeActionWindows: () => void;
}

export const MarketContext = createContext<MarketContextType>({
  selectedInstrument: DEFAULT_SELECTED_INSTRUMENT,
  selectInstrument: () => {},

  indices: [],
  indicesLoading: false,
  indicesError: null,
  refreshIndices: async () => {},

  expandedIndices: { NIFTY50: false, SENSEX: false },
  indexDetailsCache: {},
  indexDetailsLoading: {},
  indexDetailsError: {},
  toggleExpandIndex: async () => {},

  selectedQuote: null,
  selectedQuoteLoading: false,
  selectedQuoteError: null,
  refreshSelectedQuote: async () => {},

  isBuyWindowOpen: false,
  isSellWindowOpen: false,
  actionInstrument: null,
  openBuyWindow: () => {},
  openSellWindow: () => {},
  closeActionWindows: () => {},
});

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated } = useAuth();

  // Active Instrument Selection
  const [selectedInstrument, setSelectedInstrument] = useState<SelectedInstrument>(
    DEFAULT_SELECTED_INSTRUMENT
  );

  // Indices List State
  const [indices, setIndices] = useState<MarketIndexSummary[]>([]);
  const [indicesLoading, setIndicesLoading] = useState<boolean>(false);
  const [indicesError, setIndicesError] = useState<string | null>(null);

  // Concurrency Guard for Index Polling
  const isFetchingIndicesRef = useRef<boolean>(false);

  // Index Constituents Cache & Expansion
  const [expandedIndices, setExpandedIndices] = useState<
    Record<MarketIndexSymbol, boolean>
  >({
    NIFTY50: false,
    SENSEX: false,
  });
  const [indexDetailsCache, setIndexDetailsCache] = useState<
    Partial<Record<MarketIndexSymbol, MarketIndexDetail>>
  >({});
  const [indexDetailsLoading, setIndexDetailsLoading] = useState<
    Partial<Record<MarketIndexSymbol, boolean>>
  >({});
  const [indexDetailsError, setIndexDetailsError] = useState<
    Partial<Record<MarketIndexSymbol, string | null>>
  >({});

  // Selected Equity Live Quote
  const [selectedQuote, setSelectedQuote] = useState<InstrumentQuote | null>(null);
  const [selectedQuoteLoading, setSelectedQuoteLoading] = useState<boolean>(false);
  const [selectedQuoteError, setSelectedQuoteError] = useState<string | null>(null);

  // Concurrency Guard for Quote Polling
  const isFetchingQuoteRef = useRef<boolean>(false);

  // Buy/Sell Order Modal Windows
  const [isBuyWindowOpen, setIsBuyWindowOpen] = useState<boolean>(false);
  const [isSellWindowOpen, setIsSellWindowOpen] = useState<boolean>(false);
  const [actionInstrument, setActionInstrument] = useState<SelectedInstrument | null>(null);

  // ==================== INSTRUMENT SELECTION ====================

  const selectInstrument = useCallback((instrument: SelectedInstrument) => {
    setSelectedInstrument(instrument);
    // Reset selected quote when instrument changes
    setSelectedQuote(null);
    setSelectedQuoteError(null);
  }, []);

  // ==================== INDICES FETCHING & POLLING ====================

  const refreshIndices = useCallback(async () => {
    if (!isAuthenticated) {
      setIndices([]);
      setIndicesError(null);
      return;
    }

    if (isFetchingIndicesRef.current) {
      return; // Prevent overlapping requests
    }

    isFetchingIndicesRef.current = true;
    // Only show full loading skeleton on initial fetch
    setIndices((prev) => {
      if (prev.length === 0) setIndicesLoading(true);
      return prev;
    });

    try {
      const response = await MarketApi.getIndices();
      if (response.success && response.data?.items) {
        setIndices(response.data.items);
        setIndicesError(null);
      }
    } catch (err: unknown) {
      // Preserve previous valid indices during transient errors
      setIndicesError(
        err instanceof Error ? err.message : "Failed to load market indices"
      );
    } finally {
      setIndicesLoading(false);
      isFetchingIndicesRef.current = false;
    }
  }, [isAuthenticated]);

  // Initial fetch and 5-second recurring polling for indices
  useEffect(() => {
    refreshIndices();

    if (!isAuthenticated) return;

    const intervalId = setInterval(() => {
      refreshIndices();
    }, INDEX_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isAuthenticated, refreshIndices]);

  // ==================== CONSTITUENTS EXPANSION ====================

  const toggleExpandIndex = useCallback(
    async (symbol: MarketIndexSymbol) => {
      const isCurrentlyExpanded = Boolean(expandedIndices[symbol]);

      if (isCurrentlyExpanded) {
        // Collapse
        setExpandedIndices((prev) => ({ ...prev, [symbol]: false }));
        return;
      }

      // Expand
      setExpandedIndices((prev) => ({ ...prev, [symbol]: true }));

      // If already cached, do not re-fetch
      if (indexDetailsCache[symbol]) {
        return;
      }

      // Fetch constituents
      setIndexDetailsLoading((prev) => ({ ...prev, [symbol]: true }));
      setIndexDetailsError((prev) => ({ ...prev, [symbol]: null }));

      try {
        const response = await MarketApi.getIndex(symbol);
        if (response.success && response.data && response.data.index) {
          setIndexDetailsCache((prev) => ({
            ...prev,
            [symbol]: response.data!.index,
          }));
        } else {
          setIndexDetailsError((prev) => ({
            ...prev,
            [symbol]: "Index constituents unavailable.",
          }));
        }
      } catch (err: unknown) {
        setIndexDetailsError((prev) => ({
          ...prev,
          [symbol]:
            err instanceof Error ? err.message : "Failed to load constituents.",
        }));
      } finally {
        setIndexDetailsLoading((prev) => ({ ...prev, [symbol]: false }));
      }
    },
    [expandedIndices, indexDetailsCache]
  );

  // ==================== SELECTED EQUITY QUOTE POLLING ====================

  const selectedInstrumentId =
    selectedInstrument.type === "equity" ? selectedInstrument.instrumentId : undefined;

  const refreshSelectedQuote = useCallback(async () => {
    if (!isAuthenticated || !selectedInstrumentId) {
      setSelectedQuote(null);
      setSelectedQuoteError(null);
      return;
    }

    if (isFetchingQuoteRef.current) {
      return; // Prevent overlapping requests
    }

    isFetchingQuoteRef.current = true;
    setSelectedQuote((prev) => {
      if (!prev) setSelectedQuoteLoading(true);
      return prev;
    });

    try {
      const response = await InstrumentsApi.getQuote(selectedInstrumentId);
      if (response.success && response.data && response.data.quote) {
        setSelectedQuote(response.data.quote);
        setSelectedQuoteError(null);
      }
    } catch (err: unknown) {
      setSelectedQuoteError(
        err instanceof Error ? err.message : "Failed to load instrument quote"
      );
    } finally {
      setSelectedQuoteLoading(false);
      isFetchingQuoteRef.current = false;
    }
  }, [isAuthenticated, selectedInstrumentId]);

  // Initial fetch and 5-second polling for selected equity quote
  useEffect(() => {
    if (!selectedInstrumentId || !isAuthenticated) {
      setSelectedQuote(null);
      setSelectedQuoteError(null);
      return;
    }

    refreshSelectedQuote();

    const intervalId = setInterval(() => {
      refreshSelectedQuote();
    }, QUOTE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [selectedInstrumentId, isAuthenticated, refreshSelectedQuote]);

  // ==================== ORDER ACTION WINDOWS ====================

  const openBuyWindow = useCallback(
    (instrument?: SelectedInstrument) => {
      setActionInstrument(instrument || selectedInstrument);
      setIsSellWindowOpen(false);
      setIsBuyWindowOpen(true);
    },
    [selectedInstrument]
  );

  const openSellWindow = useCallback(
    (instrument?: SelectedInstrument) => {
      setActionInstrument(instrument || selectedInstrument);
      setIsBuyWindowOpen(false);
      setIsSellWindowOpen(true);
    },
    [selectedInstrument]
  );

  const closeActionWindows = useCallback(() => {
    setIsBuyWindowOpen(false);
    setIsSellWindowOpen(false);
    setActionInstrument(null);
  }, []);

  const value = useMemo<MarketContextType>(
    () => ({
      selectedInstrument,
      selectInstrument,

      indices,
      indicesLoading,
      indicesError,
      refreshIndices,

      expandedIndices,
      indexDetailsCache,
      indexDetailsLoading,
      indexDetailsError,
      toggleExpandIndex,

      selectedQuote,
      selectedQuoteLoading,
      selectedQuoteError,
      refreshSelectedQuote,

      isBuyWindowOpen,
      isSellWindowOpen,
      actionInstrument,
      openBuyWindow,
      openSellWindow,
      closeActionWindows,
    }),
    [
      selectedInstrument,
      selectInstrument,

      indices,
      indicesLoading,
      indicesError,
      refreshIndices,

      expandedIndices,
      indexDetailsCache,
      indexDetailsLoading,
      indexDetailsError,
      toggleExpandIndex,

      selectedQuote,
      selectedQuoteLoading,
      selectedQuoteError,
      refreshSelectedQuote,

      isBuyWindowOpen,
      isSellWindowOpen,
      actionInstrument,
      openBuyWindow,
      openSellWindow,
      closeActionWindows,
    ]
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
};

export function useMarket(): MarketContextType {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error("useMarket must be used within a MarketProvider");
  }
  return context;
}

export default MarketContext;

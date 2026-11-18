/**
 * NIVORA Trading Platform — Market & Workspace Context
 * Manages the globally selected instrument (stock or synthetic index),
 * market indices cache, and buy/sell order window states.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MarketApi } from "../api/client";
import { InstrumentExchange, InstrumentType, MarketIndexSummary } from "../api/types";
import { useAuth } from "./AuthContext";

export interface SelectedInstrument {
  symbol: string;
  name: string;
  type: InstrumentType;
  exchange: InstrumentExchange;
  instrumentId?: string;
  lastPricePaise?: number;
  previousClosePaise?: number;
  changePoints?: number;
  changePercent?: number;
}

export const DEFAULT_SELECTED_INSTRUMENT: SelectedInstrument = {
  symbol: "NIFTY 50",
  name: "NIFTY 50 Synthetic Index",
  type: "index",
  exchange: "NSE",
};

export interface MarketContextType {
  selectedInstrument: SelectedInstrument;
  selectInstrument: (instrument: SelectedInstrument) => void;
  indices: MarketIndexSummary[];
  indicesLoading: boolean;
  indicesError: string | null;
  refreshIndices: () => Promise<void>;
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
  const [selectedInstrument, setSelectedInstrument] = useState<SelectedInstrument>(
    DEFAULT_SELECTED_INSTRUMENT
  );

  const [indices, setIndices] = useState<MarketIndexSummary[]>([]);
  const [indicesLoading, setIndicesLoading] = useState<boolean>(false);
  const [indicesError, setIndicesError] = useState<string | null>(null);

  const [isBuyWindowOpen, setIsBuyWindowOpen] = useState<boolean>(false);
  const [isSellWindowOpen, setIsSellWindowOpen] = useState<boolean>(false);
  const [actionInstrument, setActionInstrument] = useState<SelectedInstrument | null>(null);

  const selectInstrument = useCallback((instrument: SelectedInstrument) => {
    setSelectedInstrument(instrument);
  }, []);

  const refreshIndices = useCallback(async () => {
    if (!isAuthenticated) {
      setIndices([]);
      setIndicesError(null);
      return;
    }

    setIndicesLoading(true);
    setIndicesError(null);
    try {
      const response = await MarketApi.getIndices();
      if (response.success && response.data?.items) {
        setIndices(response.data.items);
      } else {
        setIndices([]);
      }
    } catch (err: unknown) {
      // Clean error handling without throwing uncaught exceptions
      setIndices([]);
      setIndicesError(
        err instanceof Error ? err.message : "Failed to load market indices"
      );
    } finally {
      setIndicesLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshIndices();
  }, [refreshIndices]);

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

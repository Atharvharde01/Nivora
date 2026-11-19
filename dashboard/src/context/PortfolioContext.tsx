/**
 * NIVORA Trading Platform — Portfolio & Account Context
 * Centralizes portfolio valuation, active positions, cash balance metrics,
 * and synchronized data refresh across Orders, Holdings, Positions, Funds, and Workspace.
 * Uses request-generation and authentication session tracking to eliminate stale fetch races.
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
import { AccountsApi, PortfolioApi } from "../api/client";
import {
  PortfolioPositionDto,
  PortfolioResponseData,
  PortfolioSummaryDto,
  PracticeAccountSummaryDto,
} from "../api/types";
import { useAuth } from "./AuthContext";

export interface PortfolioContextType {
  // Live Portfolio Data (Summary & Active Positions)
  portfolio: PortfolioResponseData | null;
  summary: PortfolioSummaryDto | null;
  positions: PortfolioPositionDto[];
  portfolioLoading: boolean;
  portfolioError: string | null;
  refreshPortfolio: () => Promise<void>;

  // Active Practice Account Details
  account: PracticeAccountSummaryDto | null;
  accountLoading: boolean;
  accountError: string | null;
  refreshAccount: () => Promise<void>;

  // Global Multi-View Synchronizer
  refreshAll: () => Promise<void>;

  // Orders Refresh Signal
  ordersRefreshKey: number;
  triggerOrdersRefresh: () => void;
}

export const PortfolioContext = createContext<PortfolioContextType>({
  portfolio: null,
  summary: null,
  positions: [],
  portfolioLoading: false,
  portfolioError: null,
  refreshPortfolio: async () => {},

  account: null,
  accountLoading: false,
  accountError: null,
  refreshAccount: async () => {},

  refreshAll: async () => {},

  ordersRefreshKey: 0,
  triggerOrdersRefresh: () => {},
});

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated, token } = useAuth();

  // Synchronous auth-session generation tracking
  const authSessionGenRef = useRef<number>(0);
  const prevTokenRef = useRef<string | null>(token);

  if (prevTokenRef.current !== token) {
    prevTokenRef.current = token;
    authSessionGenRef.current += 1;
  }

  const isMountedRef = useRef<boolean>(true);

  // Monotonically increasing request IDs (replaces global boolean locks)
  const portfolioRequestIdRef = useRef<number>(0);
  const accountRequestIdRef = useRef<number>(0);

  // Session-scoped Portfolio State
  const [portfolioState, setPortfolioState] = useState<{
    data: PortfolioResponseData | null;
    sessionGen: number;
  }>({ data: null, sessionGen: 0 });

  const [portfolioLoadingState, setPortfolioLoadingState] = useState<{
    loading: boolean;
    sessionGen: number;
    requestId: number;
  }>({ loading: false, sessionGen: 0, requestId: 0 });

  const [portfolioErrorState, setPortfolioErrorState] = useState<{
    error: string | null;
    sessionGen: number;
  }>({ error: null, sessionGen: 0 });

  // Session-scoped Account State
  const [accountState, setAccountState] = useState<{
    data: PracticeAccountSummaryDto | null;
    sessionGen: number;
  }>({ data: null, sessionGen: 0 });

  const [accountLoadingState, setAccountLoadingState] = useState<{
    loading: boolean;
    sessionGen: number;
    requestId: number;
  }>({ loading: false, sessionGen: 0, requestId: 0 });

  const [accountErrorState, setAccountErrorState] = useState<{
    error: string | null;
    sessionGen: number;
  }>({ error: null, sessionGen: 0 });

  // Orders Refresh Version Key
  const [ordersRefreshKey, setOrdersRefreshKey] = useState<number>(0);

  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const triggerOrdersRefresh = useCallback(() => {
    setOrdersRefreshKey((prev) => prev + 1);
  }, []);

  // Synchronously derived states: immediately null when session does not match
  const activeSessionGen = authSessionGenRef.current;
  const isCurrentSessionActive = isAuthenticated && Boolean(token);

  const portfolio =
    isCurrentSessionActive && portfolioState.sessionGen === activeSessionGen
      ? portfolioState.data
      : null;

  const portfolioLoading =
    isCurrentSessionActive &&
    portfolioLoadingState.sessionGen === activeSessionGen &&
    portfolioLoadingState.requestId === portfolioRequestIdRef.current
      ? portfolioLoadingState.loading
      : false;

  const portfolioError =
    isCurrentSessionActive && portfolioErrorState.sessionGen === activeSessionGen
      ? portfolioErrorState.error
      : null;

  const account =
    isCurrentSessionActive && accountState.sessionGen === activeSessionGen
      ? accountState.data
      : null;

  const accountLoading =
    isCurrentSessionActive &&
    accountLoadingState.sessionGen === activeSessionGen &&
    accountLoadingState.requestId === accountRequestIdRef.current
      ? accountLoadingState.loading
      : false;

  const accountError =
    isCurrentSessionActive && accountErrorState.sessionGen === activeSessionGen
      ? accountErrorState.error
      : null;

  // Fetch full portfolio with request-generation and session-generation tracking
  const refreshPortfolio = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setPortfolioState({ data: null, sessionGen });
      setPortfolioErrorState({ error: null, sessionGen });
      setPortfolioLoadingState({ loading: false, sessionGen, requestId: 0 });
      return;
    }

    const requestId = ++portfolioRequestIdRef.current;

    if (isMountedRef.current) {
      setPortfolioLoadingState({ loading: true, sessionGen, requestId });
      setPortfolioErrorState({ error: null, sessionGen });
    }

    try {
      const res = await PortfolioApi.getPortfolio();

      // Guard: Discard responses whose session generation is no longer active,
      // or if superseded by a newer request in the same session
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        portfolioRequestIdRef.current !== requestId
      ) {
        return;
      }

      if (res.success && res.data) {
        setPortfolioState({ data: res.data, sessionGen });
        setPortfolioErrorState({ error: null, sessionGen });
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load portfolio.";
        setPortfolioErrorState({ error: errorMsg, sessionGen });
      }
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        portfolioRequestIdRef.current !== requestId
      ) {
        return;
      }
      setPortfolioErrorState({
        error: err instanceof Error ? err.message : "Failed to load portfolio.",
        sessionGen,
      });
    } finally {
      if (
        isMountedRef.current &&
        authSessionGenRef.current === sessionGen &&
        portfolioRequestIdRef.current === requestId
      ) {
        setPortfolioLoadingState({ loading: false, sessionGen, requestId });
      }
    }
  }, [isAuthenticated, token]);

  // Fetch active practice account with request-generation and session-generation tracking
  const refreshAccount = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setAccountState({ data: null, sessionGen });
      setAccountErrorState({ error: null, sessionGen });
      setAccountLoadingState({ loading: false, sessionGen, requestId: 0 });
      return;
    }

    const requestId = ++accountRequestIdRef.current;

    if (isMountedRef.current) {
      setAccountLoadingState({ loading: true, sessionGen, requestId });
      setAccountErrorState({ error: null, sessionGen });
    }

    try {
      const res = await AccountsApi.getActiveAccount();

      // Guard: Discard responses whose session generation is no longer active,
      // or if superseded by a newer request in the same session
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        accountRequestIdRef.current !== requestId
      ) {
        return;
      }

      if (res.success && res.data?.account) {
        setAccountState({ data: res.data.account, sessionGen });
        setAccountErrorState({ error: null, sessionGen });
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load practice account.";
        setAccountErrorState({ error: errorMsg, sessionGen });
      }
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        accountRequestIdRef.current !== requestId
      ) {
        return;
      }
      setAccountErrorState({
        error: err instanceof Error ? err.message : "Failed to load practice account.",
        sessionGen,
      });
    } finally {
      if (
        isMountedRef.current &&
        authSessionGenRef.current === sessionGen &&
        accountRequestIdRef.current === requestId
      ) {
        setAccountLoadingState({ loading: false, sessionGen, requestId });
      }
    }
  }, [isAuthenticated, token]);

  // Global synchronized data refresh (called after order execution)
  const refreshAll = useCallback(async () => {
    triggerOrdersRefresh();
    await Promise.all([refreshPortfolio(), refreshAccount()]);
  }, [triggerOrdersRefresh, refreshPortfolio, refreshAccount]);

  // On authentication change or mount, reset and fetch fresh data
  useEffect(() => {
    if (!isAuthenticated || !token) {
      setPortfolioState({ data: null, sessionGen: authSessionGenRef.current });
      setAccountState({ data: null, sessionGen: authSessionGenRef.current });
      setPortfolioErrorState({ error: null, sessionGen: authSessionGenRef.current });
      setAccountErrorState({ error: null, sessionGen: authSessionGenRef.current });
      setPortfolioLoadingState({ loading: false, sessionGen: authSessionGenRef.current, requestId: 0 });
      setAccountLoadingState({ loading: false, sessionGen: authSessionGenRef.current, requestId: 0 });
      return;
    }

    refreshPortfolio();
    refreshAccount();
  }, [isAuthenticated, token, refreshPortfolio, refreshAccount]);

  const value = useMemo<PortfolioContextType>(
    () => ({
      portfolio,
      summary: portfolio?.summary ?? null,
      positions: portfolio?.positions ? [...portfolio.positions] : [],
      portfolioLoading,
      portfolioError,
      refreshPortfolio,

      account,
      accountLoading,
      accountError,
      refreshAccount,

      refreshAll,

      ordersRefreshKey,
      triggerOrdersRefresh,
    }),
    [
      portfolio,
      portfolioLoading,
      portfolioError,
      refreshPortfolio,
      account,
      accountLoading,
      accountError,
      refreshAccount,
      refreshAll,
      ordersRefreshKey,
      triggerOrdersRefresh,
    ]
  );

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
};

export function usePortfolio(): PortfolioContextType {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error("usePortfolio must be used within a PortfolioProvider");
  }
  return context;
}

export default PortfolioContext;

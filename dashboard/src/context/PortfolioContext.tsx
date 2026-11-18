/**
 * NIVORA Trading Platform — Portfolio & Account Context
 * Centralizes portfolio valuation, active positions, cash balance metrics,
 * and synchronized data refresh across Orders, Holdings, Positions, Funds, and Workspace.
 * Strictly isolated across authentication sessions with synchronous generation tracking.
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
  const isFetchingPortfolioRef = useRef<boolean>(false);
  const isFetchingAccountRef = useRef<boolean>(false);

  // Portfolio State
  const [portfolio, setPortfolio] = useState<PortfolioResponseData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState<boolean>(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Practice Account State
  const [account, setAccount] = useState<PracticeAccountSummaryDto | null>(null);
  const [accountLoading, setAccountLoading] = useState<boolean>(false);
  const [accountError, setAccountError] = useState<string | null>(null);

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

  // Fetch full portfolio with session-generation guard
  const refreshPortfolio = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setPortfolio(null);
      setPortfolioError(null);
      setPortfolioLoading(false);
      return;
    }

    if (isFetchingPortfolioRef.current) return;
    isFetchingPortfolioRef.current = true;

    if (isMountedRef.current) {
      setPortfolioLoading(true);
      setPortfolioError(null);
    }

    try {
      const res = await PortfolioApi.getPortfolio();
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }

      if (res.success && res.data) {
        setPortfolio(res.data);
        setPortfolioError(null);
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load portfolio.";
        setPortfolioError(errorMsg);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }
      setPortfolioError(
        err instanceof Error ? err.message : "Failed to load portfolio."
      );
    } finally {
      isFetchingPortfolioRef.current = false;
      if (isMountedRef.current && authSessionGenRef.current === sessionGen) {
        setPortfolioLoading(false);
      }
    }
  }, [isAuthenticated, token]);

  // Fetch active practice account with session-generation guard
  const refreshAccount = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setAccount(null);
      setAccountError(null);
      setAccountLoading(false);
      return;
    }

    if (isFetchingAccountRef.current) return;
    isFetchingAccountRef.current = true;

    if (isMountedRef.current) {
      setAccountLoading(true);
      setAccountError(null);
    }

    try {
      const res = await AccountsApi.getActiveAccount();
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }

      if (res.success && res.data?.account) {
        setAccount(res.data.account);
        setAccountError(null);
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load practice account.";
        setAccountError(errorMsg);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }
      setAccountError(
        err instanceof Error ? err.message : "Failed to load practice account."
      );
    } finally {
      isFetchingAccountRef.current = false;
      if (isMountedRef.current && authSessionGenRef.current === sessionGen) {
        setAccountLoading(false);
      }
    }
  }, [isAuthenticated, token]);

  // Global synchronized data refresh (called after order execution)
  const refreshAll = useCallback(async () => {
    triggerOrdersRefresh();
    await Promise.all([refreshPortfolio(), refreshAccount()]);
  }, [triggerOrdersRefresh, refreshPortfolio, refreshAccount]);

  // On authentication change or mount, reset or fetch fresh data
  useEffect(() => {
    if (!isAuthenticated || !token) {
      setPortfolio(null);
      setAccount(null);
      setPortfolioError(null);
      setAccountError(null);
      setPortfolioLoading(false);
      setAccountLoading(false);
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

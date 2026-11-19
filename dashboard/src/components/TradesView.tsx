/**
 * NIVORA Trading Platform — Trades View
 * Displays executed trades retrieved from backend GET /api/v1/trades.
 * Uses request-generation and authentication session tracking to eliminate stale fetch races,
 * immediately isolates trade records on user transitions, and refreshes automatically after order fills.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { TradesApi } from "../api/client";
import { TradeDto, formatRupees, paiseToRupees } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { SwapHoriz, Refresh } from "@mui/icons-material";

export const TradesView: React.FC = () => {
  const { isAuthenticated, token } = useAuth();
  const { ordersRefreshKey } = usePortfolio();

  // Synchronous auth-session generation tracking
  const authSessionGenRef = useRef<number>(0);
  const prevTokenRef = useRef<string | null>(token);

  if (prevTokenRef.current !== token) {
    prevTokenRef.current = token;
    authSessionGenRef.current += 1;
  }

  const isMountedRef = useRef<boolean>(true);
  const tradesRequestIdRef = useRef<number>(0);

  // Session-scoped Trades State
  const [tradesState, setTradesState] = useState<{
    items: TradeDto[];
    sessionGen: number;
  }>({ items: [], sessionGen: 0 });

  const [loadingState, setLoadingState] = useState<{
    loading: boolean;
    sessionGen: number;
    requestId: number;
  }>({ loading: false, sessionGen: 0, requestId: 0 });

  const [errorState, setErrorState] = useState<{
    error: string | null;
    sessionGen: number;
  }>({ error: null, sessionGen: 0 });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Synchronously derived states: immediately empty when session does not match
  const activeSessionGen = authSessionGenRef.current;
  const isCurrentSessionActive = isAuthenticated && Boolean(token);

  const trades =
    isCurrentSessionActive && tradesState.sessionGen === activeSessionGen
      ? tradesState.items
      : [];

  const loading =
    isCurrentSessionActive &&
    loadingState.sessionGen === activeSessionGen &&
    loadingState.requestId === tradesRequestIdRef.current
      ? loadingState.loading
      : false;

  const error =
    isCurrentSessionActive && errorState.sessionGen === activeSessionGen
      ? errorState.error
      : null;

  const fetchTrades = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setTradesState({ items: [], sessionGen });
      setErrorState({ error: null, sessionGen });
      setLoadingState({ loading: false, sessionGen, requestId: 0 });
      return;
    }

    const requestId = ++tradesRequestIdRef.current;

    if (isMountedRef.current) {
      setLoadingState({ loading: true, sessionGen, requestId });
      setErrorState({ error: null, sessionGen });
    }

    try {
      const res = await TradesApi.getTrades({ limit: 50 });

      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        tradesRequestIdRef.current !== requestId
      ) {
        return;
      }

      if (res.success && res.data?.items) {
        setTradesState({ items: res.data.items, sessionGen });
        setErrorState({ error: null, sessionGen });
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load trades.";
        setErrorState({ error: errorMsg, sessionGen });
      }
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        tradesRequestIdRef.current !== requestId
      ) {
        return;
      }
      setErrorState({
        error: err instanceof Error ? err.message : "Failed to load trades.",
        sessionGen,
      });
    } finally {
      if (
        isMountedRef.current &&
        authSessionGenRef.current === sessionGen &&
        tradesRequestIdRef.current === requestId
      ) {
        setLoadingState({ loading: false, sessionGen, requestId });
      }
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades, ordersRefreshKey]);

  return (
    <div className="view-container">
      <div className="view-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="view-title">Trades ({trades.length})</h2>
            <p className="view-subtitle">Executed order fills and realized financial logs</p>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              className="btn btn-grey"
              onClick={fetchTrades}
              disabled={loading}
              title="Refresh trade history"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Refresh sx={{ fontSize: 16 }} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {loading && <div className="loading-state">Loading trades...</div>}

      {error && !loading && (
        <div
          className="error-state-card"
          style={{
            padding: "16px",
            color: "#DC2626",
            background: "#FEF2F2",
            borderRadius: "4px",
            marginBottom: "16px",
          }}
        >
          <p>
            <strong>Error loading trades:</strong> {error}
          </p>
        </div>
      )}

      {!loading && !error && trades.length === 0 ? (
        <div className="empty-state-card">
          <SwapHoriz className="empty-state-icon" sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Trades Recorded</h3>
          <p>
            {isAuthenticated
              ? "No trades executed for this account today."
              : "Session token required to view trade executions."}
          </p>
        </div>
      ) : (
        !loading &&
        trades.length > 0 && (
          <div className="order-table-container">
            <table className="nivora-table">
              <thead>
                <tr>
                  <th>Execution Time</th>
                  <th>Instrument</th>
                  <th>Exchange</th>
                  <th>Side</th>
                  <th>Qty.</th>
                  <th>Fill Price</th>
                  <th>Total Value</th>
                  <th>Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const isBuy = trade.side === "BUY";
                  const pnlRupees = paiseToRupees(trade.realizedPnlPaise);
                  const fillPriceRupees = paiseToRupees(trade.executionPricePaise);
                  const totalValRupees = paiseToRupees(trade.totalValuePaise);
                  const timeStr = new Date(trade.executedAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  return (
                    <tr key={trade._id}>
                      <td className="cell-muted">{timeStr}</td>
                      <td className="cell-bold">{trade.symbol}</td>
                      <td>{trade.exchange}</td>
                      <td>
                        <span className={`pill-badge ${isBuy ? "pill-buy" : "pill-sell"}`}>
                          {trade.side}
                        </span>
                      </td>
                      <td>{trade.quantity}</td>
                      <td>₹{formatRupees(fillPriceRupees)}</td>
                      <td>₹{formatRupees(totalValRupees)}</td>
                      <td className={pnlRupees >= 0 ? "profit" : "loss"}>
                        {pnlRupees !== 0
                          ? `${pnlRupees > 0 ? "+" : ""}₹${formatRupees(pnlRupees)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
};

export default TradesView;

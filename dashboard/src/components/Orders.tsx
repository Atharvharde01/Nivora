/**
 * NIVORA Trading Platform — Orders View
 * Displays user order history retrieved from backend /api/v1/orders.
 * Uses request-generation and authentication session tracking to eliminate stale fetch races,
 * displays statuses accurately (RECEIVED, EXECUTED, REJECTED),
 * and surfaces server rejection reasons.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { OrdersApi } from "../api/client";
import { OrderDto, formatRupees, paiseToRupees } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { ReceiptLong, Refresh } from "@mui/icons-material";

export const Orders: React.FC = () => {
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

  // Monotonically increasing request ID (replaces global boolean lock)
  const ordersRequestIdRef = useRef<number>(0);

  // Session-scoped Orders State
  const [ordersState, setOrdersState] = useState<{
    items: OrderDto[];
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

  // Synchronously derived states: immediately null/empty when session does not match
  const activeSessionGen = authSessionGenRef.current;
  const isCurrentSessionActive = isAuthenticated && Boolean(token);

  const orders =
    isCurrentSessionActive && ordersState.sessionGen === activeSessionGen
      ? ordersState.items
      : [];

  const loading =
    isCurrentSessionActive &&
    loadingState.sessionGen === activeSessionGen &&
    loadingState.requestId === ordersRequestIdRef.current
      ? loadingState.loading
      : false;

  const error =
    isCurrentSessionActive && errorState.sessionGen === activeSessionGen
      ? errorState.error
      : null;

  const fetchOrders = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setOrdersState({ items: [], sessionGen });
      setErrorState({ error: null, sessionGen });
      setLoadingState({ loading: false, sessionGen, requestId: 0 });
      return;
    }

    const requestId = ++ordersRequestIdRef.current;

    if (isMountedRef.current) {
      setLoadingState({ loading: true, sessionGen, requestId });
      setErrorState({ error: null, sessionGen });
    }

    try {
      const res = await OrdersApi.getOrders({ limit: 50 });

      // Guard: Discard responses whose session generation is no longer active,
      // or if superseded by a newer request in the same session
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        ordersRequestIdRef.current !== requestId
      ) {
        return;
      }

      if (res.success && res.data?.items) {
        setOrdersState({ items: res.data.items, sessionGen });
        setErrorState({ error: null, sessionGen });
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load orders.";
        setErrorState({ error: errorMsg, sessionGen });
      }
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        ordersRequestIdRef.current !== requestId
      ) {
        return;
      }
      setErrorState({
        error: err instanceof Error ? err.message : "Failed to load orders.",
        sessionGen,
      });
    } finally {
      if (
        isMountedRef.current &&
        authSessionGenRef.current === sessionGen &&
        ordersRequestIdRef.current === requestId
      ) {
        setLoadingState({ loading: false, sessionGen, requestId });
      }
    }
  }, [isAuthenticated, token]);

  // Refetch when authentication changes, or when signal is triggered
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, ordersRefreshKey]);

  return (
    <div className="view-container">
      <div className="view-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="view-title">Orders ({orders.length})</h2>
            <p className="view-subtitle">Order History • Executed, received, and rejected market orders</p>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              className="btn btn-grey"
              onClick={fetchOrders}
              disabled={loading}
              title="Refresh order history"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Refresh sx={{ fontSize: 16 }} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {loading && <div className="loading-state">Loading orders...</div>}

      {error && !loading && (
        <div className="error-state-card" style={{ padding: "16px", color: "#DC2626", background: "#FEF2F2", borderRadius: "4px", marginBottom: "16px" }}>
          <p><strong>Error loading orders:</strong> {error}</p>
        </div>
      )}

      {!loading && !error && orders.length === 0 ? (
        <div className="empty-state-card">
          <ReceiptLong className="empty-state-icon" sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Orders Recorded</h3>
          <p>
            {isAuthenticated
              ? "You haven't placed any orders yet. Select an equity from the Marketwatch and click BUY to execute your first simulated trade."
              : "Session token required to view order history. Please sign in to continue."}
          </p>
        </div>
      ) : (
        !loading &&
        orders.length > 0 && (
          <div className="order-table-container">
            <table className="nivora-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Instrument</th>
                  <th>Exchange</th>
                  <th>Type</th>
                  <th>Side</th>
                  <th>Qty.</th>
                  <th>Execution Price</th>
                  <th>Status & Notes</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isBuy = order.side === "BUY";
                  const isExecuted = order.status === "EXECUTED";
                  const isRejected = order.status === "REJECTED";

                  const timeStr = order.createdAt
                    ? new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "—";

                  return (
                    <tr key={order._id}>
                      <td className="cell-muted" style={{ whiteSpace: "nowrap" }}>{timeStr}</td>
                      <td className="cell-bold">{order.symbol}</td>
                      <td>{order.exchange}</td>
                      <td>{order.orderType}</td>
                      <td>
                        <span className={`pill-badge ${isBuy ? "pill-buy" : "pill-sell"}`}>
                          {order.side}
                        </span>
                      </td>
                      <td>{order.quantity}</td>
                      <td>
                        {order.executionPricePaise
                          ? `₹${formatRupees(paiseToRupees(order.executionPricePaise))}`
                          : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span
                            className={`status-chip ${
                              isExecuted
                                ? "status-success"
                                : isRejected
                                ? "status-danger"
                                : "status-pending"
                            }`}
                          >
                            {order.status}
                          </span>
                          {isRejected && order.rejectionReason && (
                            <span
                              style={{
                                fontSize: "0.72rem",
                                color: "#B91C1C",
                                marginTop: "2px",
                                maxWidth: "220px",
                                lineHeight: "1.2",
                              }}
                              title={order.rejectionReason}
                            >
                              {order.rejectionCode ? `[${order.rejectionCode}] ` : ""}
                              {order.rejectionReason}
                            </span>
                          )}
                        </div>
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

export default Orders;

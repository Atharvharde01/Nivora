/**
 * NIVORA Trading Platform — Orders View
 * Displays user order history retrieved from backend /api/v1/orders.
 * Tracks session generation to prevent cross-session leakage,
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

  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous auth-session generation tracking
  const authSessionGenRef = useRef<number>(0);
  const prevTokenRef = useRef<string | null>(token);

  if (prevTokenRef.current !== token) {
    prevTokenRef.current = token;
    authSessionGenRef.current += 1;
  }

  const isMountedRef = useRef<boolean>(true);
  const isFetchingRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchOrders = useCallback(async () => {
    const sessionGen = authSessionGenRef.current;

    if (!isAuthenticated || !token) {
      setOrders([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await OrdersApi.getOrders({ limit: 50 });
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }

      if (res.success && res.data?.items) {
        setOrders(res.data.items);
        setError(null);
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Failed to load orders.";
        setError(errorMsg);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || authSessionGenRef.current !== sessionGen) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load orders.");
    } finally {
      isFetchingRef.current = false;
      if (isMountedRef.current && authSessionGenRef.current === sessionGen) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, token]);

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
              : "Session token required to view order history. Use Dev Token in the top menu to authenticate."}
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
                  const timeStr = new Date(order.createdAt).toLocaleString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

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

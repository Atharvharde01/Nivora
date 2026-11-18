/**
 * NIVORA Trading Platform — Orders View
 * Displays user orders retrieved from backend /api/v1/orders.
 */

import React, { useState, useEffect } from "react";
import { OrdersApi } from "../api/client";
import { OrderDto } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { ReceiptLong } from "@mui/icons-material";

export const Orders: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setOrders([]);
      return;
    }

    let active = true;
    setLoading(true);

    OrdersApi.getOrders()
      .then((res) => {
        if (active && res.success && res.data?.items) {
          setOrders(res.data.items);
        }
      })
      .catch(() => {
        if (active) setOrders([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Orders ({orders.length})</h2>
        <p className="view-subtitle">Today's executed, received, and cancelled orders</p>
      </div>

      {loading && <div className="loading-state">Loading orders...</div>}

      {!loading && orders.length === 0 ? (
        <div className="empty-state-card">
          <ReceiptLong className="empty-state-icon" sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Orders Today</h3>
          <p>
            {isAuthenticated
              ? "You haven't placed any orders today. Use the Marketwatch or Workspace to submit an order."
              : "Session token required to view order history. Use Dev Token in the top menu to authenticate."}
          </p>
        </div>
      ) : (
        <div className="order-table-container">
          <table className="nivora-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Instrument</th>
                <th>Exchange</th>
                <th>Type</th>
                <th>Side</th>
                <th>Qty.</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const isBuy = order.side === "BUY";
                const isExecuted = order.status === "EXECUTED";
                const isRejected = order.status === "REJECTED";
                const timeStr = new Date(order.createdAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                return (
                  <tr key={order._id}>
                    <td className="cell-muted">{timeStr}</td>
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
                        ? `₹${(order.executionPricePaise / 100).toFixed(2)}`
                        : "MARKET"}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Orders;

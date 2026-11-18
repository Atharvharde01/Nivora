/**
 * NIVORA Trading Platform — Trades View
 * Displays executed trades from backend /api/v1/trades.
 */

import React, { useState, useEffect } from "react";
import { TradesApi } from "../api/client";
import { TradeDto } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { SwapHoriz } from "@mui/icons-material";

export const TradesView: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [trades, setTrades] = useState<TradeDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setTrades([]);
      return;
    }

    let active = true;
    setLoading(true);

    TradesApi.getTrades()
      .then((res) => {
        if (active && res.success && res.data?.items) {
          setTrades(res.data.items);
        }
      })
      .catch(() => {
        if (active) setTrades([]);
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
        <h2 className="view-title">Trades ({trades.length})</h2>
        <p className="view-subtitle">Executed order fills and realized financial logs</p>
      </div>

      {loading && <div className="loading-state">Loading trades...</div>}

      {!loading && trades.length === 0 ? (
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
                const pnlRupees = trade.realizedPnlPaise / 100;
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
                    <td>₹{(trade.executionPricePaise / 100).toFixed(2)}</td>
                    <td>₹{(trade.totalValuePaise / 100).toFixed(2)}</td>
                    <td className={pnlRupees >= 0 ? "profit" : "loss"}>
                      {pnlRupees !== 0 ? `₹${pnlRupees.toFixed(2)}` : "—"}
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

export default TradesView;

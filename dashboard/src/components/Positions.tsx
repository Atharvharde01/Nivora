/**
 * NIVORA Trading Platform — Positions View
 * Displays open intraday and delivery trading positions from backend /api/v1/portfolio/positions.
 */

import React, { useState, useEffect } from "react";
import { PortfolioApi } from "../api/client";
import { PortfolioPositionDto } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { WorkOutline } from "@mui/icons-material";

export const Positions: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [positions, setPositions] = useState<PortfolioPositionDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setPositions([]);
      return;
    }

    let active = true;
    setLoading(true);

    PortfolioApi.getPositions()
      .then((res) => {
        if (active && res.success && res.data?.items) {
          setPositions(res.data.items);
        }
      })
      .catch(() => {
        if (active) setPositions([]);
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
        <h2 className="view-title">Positions ({positions.length})</h2>
        <p className="view-subtitle">Active open trading positions and unrealized P&L</p>
      </div>

      {loading && <div className="loading-state">Loading positions...</div>}

      {!loading && positions.length === 0 ? (
        <div className="empty-state-card">
          <WorkOutline sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Open Positions</h3>
          <p>
            {isAuthenticated
              ? "You do not have any open trading positions today."
              : "Session token required to view open positions."}
          </p>
        </div>
      ) : (
        <div className="order-table-container">
          <table className="nivora-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Exchange</th>
                <th>Qty.</th>
                <th>Avg. Price</th>
                <th>LTP</th>
                <th>Current Val.</th>
                <th>Unrealized P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const avgPrice = pos.averageBuyPricePaise / 100;
                const ltp = pos.lastPricePaise / 100;
                const currentVal = pos.currentMarketValuePaise / 100;
                const unrealizedPnl = pos.unrealizedPnlPaise / 100;

                return (
                  <tr key={pos.instrumentId}>
                    <td className="cell-bold">{pos.symbol}</td>
                    <td>{pos.exchange}</td>
                    <td>{pos.quantity}</td>
                    <td>₹{avgPrice.toFixed(2)}</td>
                    <td>₹{ltp.toFixed(2)}</td>
                    <td>₹{currentVal.toFixed(2)}</td>
                    <td className={unrealizedPnl >= 0 ? "profit" : "loss"}>
                      ₹{unrealizedPnl.toFixed(2)}
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

export default Positions;

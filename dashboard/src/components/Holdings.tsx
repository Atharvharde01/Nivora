/**
 * NIVORA Trading Platform — Holdings View
 * Displays current long-term equity holdings from backend /api/v1/portfolio/holdings.
 */

import React, { useState, useEffect } from "react";
import { PortfolioApi } from "../api/client";
import { PortfolioHoldingDto } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { PieChartOutline } from "@mui/icons-material";

export const Holdings: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [holdings, setHoldings] = useState<PortfolioHoldingDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setHoldings([]);
      return;
    }

    let active = true;
    setLoading(true);

    PortfolioApi.getHoldings()
      .then((res) => {
        if (active && res.success && res.data?.items) {
          setHoldings(res.data.items);
        }
      })
      .catch(() => {
        if (active) setHoldings([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const totalInvestedRupees = holdings.reduce(
    (acc, curr) => acc + curr.totalInvestedPaise / 100,
    0
  );

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Holdings ({holdings.length})</h2>
        <p className="view-subtitle">Portfolio assets held in your practice account</p>
      </div>

      {loading && <div className="loading-state">Loading holdings...</div>}

      {!loading && holdings.length === 0 ? (
        <div className="empty-state-card">
          <PieChartOutline sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Holdings Found</h3>
          <p>
            {isAuthenticated
              ? "You do not have any open delivery holdings in this account yet."
              : "Session token required to view portfolio holdings."}
          </p>
        </div>
      ) : (
        <>
          <div className="order-table-container">
            <table className="nivora-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Exchange</th>
                  <th>Qty.</th>
                  <th>Avg. Cost</th>
                  <th>Total Invested</th>
                  <th>Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((stock) => {
                  const avgPrice = stock.averageBuyPricePaise / 100;
                  const totalInvested = stock.totalInvestedPaise / 100;
                  const realizedPnl = stock.realizedPnlPaise / 100;

                  return (
                    <tr key={stock._id}>
                      <td className="cell-bold">{stock.symbol}</td>
                      <td>{stock.exchange}</td>
                      <td>{stock.quantity}</td>
                      <td>₹{avgPrice.toFixed(2)}</td>
                      <td>₹{totalInvested.toFixed(2)}</td>
                      <td className={realizedPnl >= 0 ? "profit" : "loss"}>
                        {realizedPnl !== 0 ? `₹${realizedPnl.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="portfolio-summary-bar">
            <div className="summary-item">
              <span className="summary-label">Total Investment</span>
              <span className="summary-val">
                ₹
                {totalInvestedRupees.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total Holdings</span>
              <span className="summary-val">{holdings.length}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Holdings;

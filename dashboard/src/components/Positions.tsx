/**
 * NIVORA Trading Platform — Positions View
 * Displays active trading positions and unrealized P&L from backend GET /api/v1/portfolio.
 * Uses server-authoritative live valuations, quote freshness indicators, and strict paise conversions.
 */

import React from "react";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { formatRupees, paiseToRupees } from "../api/types";
import { WorkOutline, Refresh } from "@mui/icons-material";

export const Positions: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const {
    positions,
    summary,
    portfolioLoading,
    portfolioError,
    refreshPortfolio,
  } = usePortfolio();

  const totalCurrentValueRupees = summary
    ? paiseToRupees(summary.currentMarketValuePaise)
    : positions.reduce(
        (acc, curr) => acc + paiseToRupees(curr.currentMarketValuePaise),
        0
      );

  const totalUnrealizedPnlRupees = summary
    ? paiseToRupees(summary.unrealizedPnlPaise)
    : positions.reduce(
        (acc, curr) => acc + paiseToRupees(curr.unrealizedPnlPaise),
        0
      );

  return (
    <div className="view-container">
      <div className="view-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="view-title">Positions ({positions.length})</h2>
            <p className="view-subtitle">Active open trading positions and live unrealized P&L</p>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              className="btn btn-grey"
              onClick={refreshPortfolio}
              disabled={portfolioLoading}
              title="Refresh positions"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Refresh sx={{ fontSize: 16 }} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {portfolioLoading && <div className="loading-state">Loading positions...</div>}

      {portfolioError && !portfolioLoading && (
        <div className="error-state-card" style={{ padding: "16px", color: "#DC2626", background: "#FEF2F2", borderRadius: "4px", marginBottom: "16px" }}>
          <p><strong>Error loading positions:</strong> {portfolioError}</p>
        </div>
      )}

      {!portfolioLoading && !portfolioError && positions.length === 0 ? (
        <div className="empty-state-card">
          <WorkOutline sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Open Positions</h3>
          <p>
            {isAuthenticated
              ? "You do not have any open trading positions in this practice account. Executed BUY orders will appear here as active positions."
              : "Session token required to view open positions. Please sign in to continue."}
          </p>
        </div>
      ) : (
        !portfolioLoading &&
        positions.length > 0 && (
          <>
            <div className="order-table-container">
              <table className="nivora-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Exchange</th>
                    <th>Qty.</th>
                    <th>Avg. Price</th>
                    <th>LTP</th>
                    <th>Current Value</th>
                    <th>Unrealized P&L</th>
                    <th>Quote Status</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const avgPrice = paiseToRupees(pos.averageBuyPricePaise);
                    const ltp = paiseToRupees(pos.lastPricePaise);
                    const currentVal = paiseToRupees(pos.currentMarketValuePaise);
                    const unrealizedPnl = paiseToRupees(pos.unrealizedPnlPaise);

                    return (
                      <tr key={pos.instrumentId}>
                        <td className="cell-bold">{pos.symbol}</td>
                        <td>{pos.exchange}</td>
                        <td>{pos.quantity}</td>
                        <td>₹{formatRupees(avgPrice)}</td>
                        <td>₹{formatRupees(ltp)}</td>
                        <td>₹{formatRupees(currentVal)}</td>
                        <td className={unrealizedPnl >= 0 ? "profit" : "loss"}>
                          {unrealizedPnl > 0 ? "+" : ""}
                          ₹{formatRupees(unrealizedPnl)}
                        </td>
                        <td>
                          {pos.isQuoteStale ? (
                            <span className="badge-stale" aria-label="Stale quote">
                              STALE
                            </span>
                          ) : (
                            <span style={{ fontSize: "0.72rem", color: "#166534", fontWeight: 600 }}>
                              LIVE
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="portfolio-summary-bar">
              <div className="summary-item">
                <span className="summary-label">Total Market Value</span>
                <span className="summary-val">
                  ₹{formatRupees(totalCurrentValueRupees)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Unrealized P&L</span>
                <span
                  className={`summary-val ${
                    totalUnrealizedPnlRupees >= 0 ? "profit" : "loss"
                  }`}
                >
                  {totalUnrealizedPnlRupees > 0 ? "+" : ""}
                  ₹{formatRupees(totalUnrealizedPnlRupees)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Active Positions</span>
                <span className="summary-val">{positions.length}</span>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default Positions;

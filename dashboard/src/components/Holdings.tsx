/**
 * NIVORA Trading Platform — Holdings View
 * Displays current equity holdings from backend GET /api/v1/portfolio.
 * Strictly uses server-authoritative integer paise values and isolates sessions.
 */

import React from "react";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { formatRupees, paiseToRupees } from "../api/types";
import { PieChartOutline, Refresh } from "@mui/icons-material";

export const Holdings: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const {
    positions,
    summary,
    portfolioLoading,
    portfolioError,
    refreshPortfolio,
  } = usePortfolio();

  // Holdings represent all positions with positive share quantity
  const holdings = positions.filter((pos) => pos.quantity > 0);

  const totalInvestedRupees = summary
    ? paiseToRupees(summary.totalInvestedPaise)
    : holdings.reduce(
        (acc, curr) => acc + paiseToRupees(curr.totalInvestedPaise),
        0
      );

  const totalCurrentValueRupees = summary
    ? paiseToRupees(summary.currentMarketValuePaise)
    : holdings.reduce(
        (acc, curr) => acc + paiseToRupees(curr.currentMarketValuePaise),
        0
      );

  const totalRealizedPnlRupees = summary
    ? paiseToRupees(summary.realizedPnlPaise)
    : holdings.reduce(
        (acc, curr) => acc + paiseToRupees(curr.realizedPnlPaise),
        0
      );

  return (
    <div className="view-container">
      <div className="view-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="view-title">Holdings ({holdings.length})</h2>
            <p className="view-subtitle">Portfolio assets currently held in your practice account</p>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              className="btn btn-grey"
              onClick={refreshPortfolio}
              disabled={portfolioLoading}
              title="Refresh portfolio holdings"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Refresh sx={{ fontSize: 16 }} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {portfolioLoading && <div className="loading-state">Loading holdings...</div>}

      {portfolioError && !portfolioLoading && (
        <div className="error-state-card" style={{ padding: "16px", color: "#DC2626", background: "#FEF2F2", borderRadius: "4px", marginBottom: "16px" }}>
          <p><strong>Error loading holdings:</strong> {portfolioError}</p>
        </div>
      )}

      {!portfolioLoading && !portfolioError && holdings.length === 0 ? (
        <div className="empty-state-card">
          <PieChartOutline sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>No Holdings Found</h3>
          <p>
            {isAuthenticated
              ? "You do not have any open stock holdings in this practice account yet. Use the Marketwatch or Workspace to execute a BUY order."
              : "Session token required to view portfolio holdings. Use Dev Token in the top menu to authenticate."}
          </p>
        </div>
      ) : (
        !portfolioLoading &&
        holdings.length > 0 && (
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
                    const avgCostRupees = paiseToRupees(stock.averageBuyPricePaise);
                    const totalInvested = paiseToRupees(stock.totalInvestedPaise);
                    const realizedPnl = paiseToRupees(stock.realizedPnlPaise);

                    return (
                      <tr key={stock.instrumentId}>
                        <td className="cell-bold">{stock.symbol}</td>
                        <td>{stock.exchange}</td>
                        <td>{stock.quantity}</td>
                        <td>₹{formatRupees(avgCostRupees)}</td>
                        <td>₹{formatRupees(totalInvested)}</td>
                        <td className={realizedPnl >= 0 ? "profit" : "loss"}>
                          {realizedPnl !== 0 ? `₹${formatRupees(realizedPnl)}` : "—"}
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
                  ₹{formatRupees(totalInvestedRupees)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Current Valuation</span>
                <span className="summary-val">
                  ₹{formatRupees(totalCurrentValueRupees)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Realized P&L</span>
                <span
                  className={`summary-val ${
                    totalRealizedPnlRupees >= 0 ? "profit" : "loss"
                  }`}
                >
                  ₹{formatRupees(totalRealizedPnlRupees)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Holdings</span>
                <span className="summary-val">{holdings.length}</span>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default Holdings;

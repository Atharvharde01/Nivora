/**
 * NIVORA Trading Platform — Markets Directory View
 * Overview of synthetic market indices (NIFTY 50, SENSEX) and tradable equities.
 */

import React from "react";
import { TrendingUp, TrendingDown, ShowChart } from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";

export const MarketsView: React.FC = () => {
  const { indices, indicesLoading, selectInstrument } = useMarket();

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Markets Overview</h2>
        <p className="view-subtitle">
          Synthetic Indian equity indices and multi-constituent basket dynamics
        </p>
      </div>

      <div className="markets-grid">
        {indicesLoading && <div className="loading-state">Loading indices...</div>}

        {!indicesLoading && indices.length === 0 && (
          <div className="empty-state-card">
            <h3>Indices Unavailable</h3>
            <p>
              Connect an active in-memory session token in <strong>Dev Token</strong> to view
              live index feeds from <code>/api/v1/market/indices</code>.
            </p>
          </div>
        )}

        {indices.map((idx) => {
          const isUp = idx.changePoints >= 0;
          return (
            <div
              key={idx.symbol}
              className="market-index-card"
              onClick={() =>
                selectInstrument({
                  symbol: idx.symbol === "NIFTY50" ? "NIFTY 50" : idx.symbol,
                  name: idx.name,
                  type: "index",
                  exchange: idx.exchange,
                  lastPricePaise: idx.currentValuePaise,
                  changePoints: idx.changePoints,
                  changePercent: idx.changePercent,
                })
              }
              role="button"
              tabIndex={0}
            >
              <div className="index-card-header">
                <div>
                  <h3 className="index-card-title">{idx.name}</h3>
                  <span className="index-card-exchange">{idx.exchange} • SYNTHETIC</span>
                </div>
                <button
                  type="button"
                  className="btn-select-index"
                  title="View in Workspace"
                >
                  <ShowChart sx={{ fontSize: 18 }} />
                </button>
              </div>

              <div className="index-card-body">
                <div className="index-card-value">
                  ₹
                  {(idx.currentValue || idx.currentValuePaise / 100).toLocaleString(
                    "en-IN",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </div>
                <div className={`index-card-change ${isUp ? "up" : "down"}`}>
                  {isUp ? (
                    <TrendingUp sx={{ fontSize: 18 }} />
                  ) : (
                    <TrendingDown sx={{ fontSize: 18 }} />
                  )}
                  {isUp ? "+" : ""}
                  {idx.changePoints.toFixed(2)} ({isUp ? "+" : ""}
                  {idx.changePercent.toFixed(2)}%)
                </div>
              </div>

              <div className="index-card-footer">
                <span>
                  Constituents: {idx.constituents ? idx.constituents.length : "Multi-stock"}
                </span>
                <span className="status-tag">24x7 Simulation</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MarketsView;

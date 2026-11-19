/**
 * NIVORA Trading Platform — Markets Directory View
 * Overview of synthetic benchmark market indices (NIFTY 50, SENSEX) and their constituent baskets.
 */

import React from "react";
import { TrendingUp, TrendingDown, Remove, ShowChart } from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import {
  bpsToPercent,
  formatIndexPoints,
  indexChangeValueToPoints,
  indexValueToPoints,
} from "../api/types";

export const MarketsView: React.FC = () => {
  const { indices, indicesLoading, selectInstrument } = useMarket();

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Markets Overview</h2>
        <p className="view-subtitle">
          Synthetic benchmark indices derived from multi-constituent equity baskets (24x7 Continuous Simulation)
        </p>
      </div>

      <div className="markets-grid">
        {indicesLoading && indices.length === 0 && (
          <div className="loading-state">Loading synthetic market indices...</div>
        )}

        {!indicesLoading && indices.length === 0 && (
          <div className="empty-state-card">
            <h3>Indices Unavailable</h3>
            <p>
              Please sign in to your NIVORA account to view
              live index feeds from <code>/api/v1/market/indices</code>.
            </p>
          </div>
        )}

        {indices.map((idx) => {
          const isUp = idx.changeBps > 0;
          const isDown = idx.changeBps < 0;
          const exchange = idx.symbol === "NIFTY50" ? "NSE" : "BSE";
          const displayName = idx.symbol === "NIFTY50" ? "NIFTY 50" : "SENSEX";
          const changePoints = indexChangeValueToPoints(idx.changeValue);
          const changePercent = bpsToPercent(idx.changeBps);

          return (
            <div
              key={idx.symbol}
              className="market-index-card"
              onClick={() =>
                selectInstrument({
                  symbol: displayName,
                  name: idx.name,
                  type: "index",
                  exchange,
                  indexSymbol: idx.symbol,
                })
              }
              role="button"
              tabIndex={0}
            >
              <div className="index-card-header">
                <div>
                  <h3 className="index-card-title">{idx.name}</h3>
                  <span className="index-card-exchange">{exchange} • SYNTHETIC</span>
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
                  {formatIndexPoints(indexValueToPoints(idx.currentValue))}
                </div>
                <div
                  className={`index-card-change ${
                    isUp ? "up" : isDown ? "down" : "neutral"
                  }`}
                >
                  {isUp ? (
                    <TrendingUp sx={{ fontSize: 18 }} />
                  ) : isDown ? (
                    <TrendingDown sx={{ fontSize: 18 }} />
                  ) : (
                    <Remove sx={{ fontSize: 18 }} />
                  )}
                  {isUp ? "+" : ""}
                  {changePoints.toFixed(2)} ({isUp ? "+" : ""}
                  {changePercent.toFixed(2)}%)
                </div>
              </div>

              <div className="index-card-footer">
                <span>Constituents: {idx.constituentCount}</span>
                <span className="status-tag">Equal-Weighted Basket</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MarketsView;

/**
 * NIVORA Trading Platform — Selected Instrument Workspace
 * Displays active quote header, BUY/SELL triggers, timeframe toolbar,
 * and the chart workspace placeholder prepared for Milestone 5.4.
 */

import React, { useState } from "react";
import {
  ShowChart,
  TrendingUp,
  TrendingDown,
  InfoOutlined,
  Timeline,
} from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import { CandleInterval } from "../api/types";

export const Workspace: React.FC = () => {
  const {
    selectedInstrument,
    openBuyWindow,
    openSellWindow,
  } = useMarket();

  const [activeInterval, setActiveInterval] = useState<CandleInterval>("1m");

  const intervals: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

  const priceFormatted = selectedInstrument.lastPricePaise
    ? (selectedInstrument.lastPricePaise / 100).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : null;

  const isPositive = (selectedInstrument.changePercent ?? 0) >= 0;

  return (
    <div className="workspace-container">
      {/* HEADER: ACTIVE INSTRUMENT INFO & ACTIONS */}
      <div className="workspace-header">
        <div className="instrument-title-group">
          <div className="symbol-row">
            <h1 className="symbol-name">{selectedInstrument.symbol}</h1>
            <span className="exchange-pill">{selectedInstrument.exchange}</span>
            <span
              className={`type-pill ${
                selectedInstrument.type === "index" ? "pill-index" : "pill-equity"
              }`}
            >
              {selectedInstrument.type.toUpperCase()}
            </span>
          </div>
          <p className="full-name">{selectedInstrument.name}</p>
        </div>

        {/* QUOTE AND ACTION BUTTONS */}
        <div className="workspace-actions-group">
          <div className="quote-display">
            {priceFormatted ? (
              <>
                <span className="quote-price">₹{priceFormatted}</span>
                <span className={`quote-change ${isPositive ? "up" : "down"}`}>
                  {isPositive ? (
                    <TrendingUp className="trend-icon" />
                  ) : (
                    <TrendingDown className="trend-icon" />
                  )}
                  {isPositive ? "+" : ""}
                  {(selectedInstrument.changePercent ?? 0).toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="quote-placeholder">Live Feed Active</span>
            )}
          </div>

          <div className="action-buttons">
            <button
              type="button"
              className="btn-order btn-buy-main"
              onClick={() => openBuyWindow(selectedInstrument)}
            >
              BUY
            </button>
            <button
              type="button"
              className="btn-order btn-sell-main"
              onClick={() => openSellWindow(selectedInstrument)}
            >
              SELL
            </button>
          </div>
        </div>
      </div>

      {/* CHART WORKSPACE PLACEHOLDER & TIMEFRAME TOOLBAR */}
      <div className="chart-card">
        {/* Timeframe toolbar */}
        <div className="timeframe-toolbar">
          <div className="toolbar-left">
            <span className="toolbar-label">
              <Timeline sx={{ fontSize: 18, mr: 0.5, verticalAlign: "middle" }} />
              Timeframe:
            </span>
            <div className="interval-pills">
              {intervals.map((interval) => (
                <button
                  key={interval}
                  type="button"
                  className={`interval-pill ${
                    activeInterval === interval ? "active" : ""
                  }`}
                  onClick={() => setActiveInterval(interval)}
                >
                  {interval}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar-right">
            <span className="session-tag">
              IST Session: 09:15 - 15:30 (03:45 - 10:00 UTC)
            </span>
          </div>
        </div>

        {/* Chart Canvas Area */}
        <div className="chart-canvas-placeholder">
          <div className="chart-placeholder-content">
            <ShowChart className="chart-big-icon" />
            <h3>Candlestick Chart Workspace</h3>
            <p className="chart-sub">
              Ready for <strong>Milestone 5.4</strong>: Interactive candlestick rendering
              for <strong>{selectedInstrument.symbol}</strong> ({activeInterval} interval).
            </p>
            <div className="chart-badges">
              <span className="info-chip">
                <InfoOutlined sx={{ fontSize: 14 }} />
                Synthetic Market Engine
              </span>
              <span className="info-chip">24x7 Continuous Simulation</span>
              <span className="info-chip">375 1m Candles / Trading Session</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workspace;

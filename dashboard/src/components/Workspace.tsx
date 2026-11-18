/**
 * NIVORA Trading Platform — Selected Instrument Workspace
 * Displays active quote header (synthetic index or live equity quote with 5s polling),
 * stale quote indicator, BUY/SELL triggers, timeframe toolbar,
 * and chart workspace placeholder prepared for Milestone 5.4.
 */

import React, { useState } from "react";
import {
  ShowChart,
  TrendingUp,
  TrendingDown,
  Remove,
  InfoOutlined,
  Timeline,
  WarningAmber,
} from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import {
  CandleInterval,
  bpsToPercent,
  formatIndexPoints,
  formatRupees,
  indexChangeValueToPoints,
  indexValueToPoints,
  paiseToRupees,
} from "../api/types";

export const Workspace: React.FC = () => {
  const {
    selectedInstrument,
    indices,
    selectedQuote,
    selectedQuoteLoading,
    openBuyWindow,
    openSellWindow,
  } = useMarket();

  const [activeInterval, setActiveInterval] = useState<CandleInterval>("1m");
  const intervals: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

  const isIndex = selectedInstrument.type === "index";

  // Resolve Index Metrics
  const activeIndex = isIndex
    ? indices.find(
        (idx) =>
          idx.symbol === selectedInstrument.indexSymbol ||
          idx.symbol === selectedInstrument.symbol ||
          (selectedInstrument.symbol === "NIFTY 50" && idx.symbol === "NIFTY50")
      )
    : undefined;

  const indexPoints = activeIndex
    ? formatIndexPoints(indexValueToPoints(activeIndex.currentValue))
    : null;
  const indexChgPoints = activeIndex
    ? indexChangeValueToPoints(activeIndex.changeValue).toFixed(2)
    : null;
  const indexChgPct = activeIndex
    ? bpsToPercent(activeIndex.changeBps).toFixed(2)
    : null;
  const isIndexPositive = (activeIndex?.changeBps ?? 0) > 0;
  const isIndexNegative = (activeIndex?.changeBps ?? 0) < 0;

  // Resolve Equity Live Quote Metrics
  const quotePriceRupees = selectedQuote
    ? paiseToRupees(selectedQuote.lastPricePaise)
    : null;
  const quotePrevRupees =
    selectedQuote && selectedQuote.previousClosePaise > 0
      ? paiseToRupees(selectedQuote.previousClosePaise)
      : quotePriceRupees;

  const quoteDiffRupees =
    quotePriceRupees !== null && quotePrevRupees !== null
      ? quotePriceRupees - quotePrevRupees
      : null;
  const quotePct =
    quoteDiffRupees !== null && quotePrevRupees && quotePrevRupees > 0
      ? (quoteDiffRupees / quotePrevRupees) * 100
      : null;

  const isEquityPositive = (quoteDiffRupees ?? 0) > 0;
  const isEquityNegative = (quoteDiffRupees ?? 0) < 0;

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
                isIndex ? "pill-index" : "pill-equity"
              }`}
            >
              {selectedInstrument.type.toUpperCase()}
            </span>

            {/* STALE QUOTE WARNING BADGE */}
            {!isIndex && selectedQuote?.isStale && (
              <span className="stale-warning-badge" title="Quote age exceeds freshness policy">
                <WarningAmber sx={{ fontSize: 14 }} /> Stale Quote (Simulated)
              </span>
            )}
          </div>
          <p className="full-name">
            {selectedInstrument.name}
            {isIndex ? " • Synthetic Benchmark Index" : " • Simulated Indian Equity"}
          </p>
        </div>

        {/* QUOTE AND ACTION BUTTONS */}
        <div className="workspace-actions-group">
          <div className="quote-display">
            {isIndex ? (
              indexPoints ? (
                <>
                  <span className="quote-price">{indexPoints}</span>
                  <span
                    className={`quote-change ${
                      isIndexPositive
                        ? "up"
                        : isIndexNegative
                        ? "down"
                        : "neutral"
                    }`}
                  >
                    {isIndexPositive ? (
                      <TrendingUp className="trend-icon up" />
                    ) : isIndexNegative ? (
                      <TrendingDown className="trend-icon down" />
                    ) : (
                      <Remove className="trend-icon neutral" />
                    )}
                    {isIndexPositive ? "+" : ""}
                    {indexChgPoints} ({isIndexPositive ? "+" : ""}
                    {indexChgPct}%)
                  </span>
                </>
              ) : (
                <span className="quote-placeholder">Connecting to Synthetic Feed...</span>
              )
            ) : selectedQuoteLoading && !selectedQuote ? (
              <span className="quote-placeholder">Loading live quote...</span>
            ) : selectedQuote ? (
              <>
                <span className="quote-price">₹{formatRupees(quotePriceRupees!)}</span>
                <div className="quote-secondary-row">
                  <span
                    className={`quote-change ${
                      isEquityPositive
                        ? "up"
                        : isEquityNegative
                        ? "down"
                        : "neutral"
                    }`}
                  >
                    {isEquityPositive ? (
                      <TrendingUp className="trend-icon up" />
                    ) : isEquityNegative ? (
                      <TrendingDown className="trend-icon down" />
                    ) : (
                      <Remove className="trend-icon neutral" />
                    )}
                    {isEquityPositive ? "+" : ""}
                    ₹{quoteDiffRupees?.toFixed(2)} (
                    {isEquityPositive ? "+" : ""}
                    {quotePct?.toFixed(2)}%)
                  </span>
                  <span className="bid-ask-caption">
                    Bid ₹{formatRupees(paiseToRupees(selectedQuote.bidPricePaise))} • Ask ₹
                    {formatRupees(paiseToRupees(selectedQuote.askPricePaise))}
                  </span>
                </div>
              </>
            ) : (
              <span className="quote-placeholder">Live Feed Ready</span>
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

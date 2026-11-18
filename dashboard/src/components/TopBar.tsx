/**
 * NIVORA Trading Platform — TopBar Component
 * Displays NIVORA brand logo, persistent synthetic NIFTY 50 and SENSEX ticker indicators,
 * and primary navigation menu with developer session controls.
 */

import React from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Remove } from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import {
  bpsToPercent,
  formatIndexPoints,
  indexChangeValueToPoints,
  indexValueToPoints,
} from "../api/types";
import Menu from "./Menu";

export const TopBar: React.FC = () => {
  const { indices, indicesLoading, selectInstrument, selectedInstrument } = useMarket();

  const nifty = indices.find((idx) => idx.symbol === "NIFTY50");
  const sensex = indices.find((idx) => idx.symbol === "SENSEX");

  const handleSelectNifty = () => {
    selectInstrument({
      symbol: "NIFTY 50",
      name: nifty?.name || "NIFTY 50 Synthetic Index",
      type: "index",
      exchange: "NSE",
      indexSymbol: "NIFTY50",
    });
  };

  const handleSelectSensex = () => {
    selectInstrument({
      symbol: "SENSEX",
      name: sensex?.name || "BSE SENSEX Synthetic Index",
      type: "index",
      exchange: "BSE",
      indexSymbol: "SENSEX",
    });
  };

  return (
    <header className="topbar-container" role="banner">
      {/* Brand & Left Indices Area */}
      <div className="topbar-left">
        <Link to="/" className="topbar-brand" title="NIVORA Dashboard">
          <img
            src="/nivora-logo.svg"
            alt="NIVORA Logo"
            className="topbar-logo"
            height={28}
          />
        </Link>

        {/* Indices Tickers */}
        <div className="indices-container">
          {/* NIFTY 50 Pill */}
          <div
            className={`index-pill ${
              selectedInstrument.symbol === "NIFTY 50" ||
              selectedInstrument.symbol === "NIFTY50"
                ? "active"
                : ""
            }`}
            onClick={handleSelectNifty}
            role="button"
            tabIndex={0}
            title="Click to view NIFTY 50 in workspace"
          >
            <span className="index-name">NIFTY 50</span>
            {indicesLoading && !nifty ? (
              <span className="index-loading">...</span>
            ) : nifty ? (
              <span className="index-values">
                <span className="index-points">
                  {formatIndexPoints(indexValueToPoints(nifty.currentValue))}
                </span>
                <span
                  className={`index-chg ${
                    nifty.changeBps > 0
                      ? "positive"
                      : nifty.changeBps < 0
                      ? "negative"
                      : "neutral"
                  }`}
                >
                  {nifty.changeBps > 0 ? (
                    <TrendingUp className="chg-icon" />
                  ) : nifty.changeBps < 0 ? (
                    <TrendingDown className="chg-icon" />
                  ) : (
                    <Remove className="chg-icon" />
                  )}
                  {nifty.changeBps > 0 ? "+" : ""}
                  {indexChangeValueToPoints(nifty.changeValue).toFixed(2)} (
                  {nifty.changeBps > 0 ? "+" : ""}
                  {bpsToPercent(nifty.changeBps).toFixed(2)}%)
                </span>
              </span>
            ) : (
              <span className="index-empty">—</span>
            )}
          </div>

          {/* SENSEX Pill */}
          <div
            className={`index-pill ${
              selectedInstrument.symbol === "SENSEX" ? "active" : ""
            }`}
            onClick={handleSelectSensex}
            role="button"
            tabIndex={0}
            title="Click to view SENSEX in workspace"
          >
            <span className="index-name">SENSEX</span>
            {indicesLoading && !sensex ? (
              <span className="index-loading">...</span>
            ) : sensex ? (
              <span className="index-values">
                <span className="index-points">
                  {formatIndexPoints(indexValueToPoints(sensex.currentValue))}
                </span>
                <span
                  className={`index-chg ${
                    sensex.changeBps > 0
                      ? "positive"
                      : sensex.changeBps < 0
                      ? "negative"
                      : "neutral"
                  }`}
                >
                  {sensex.changeBps > 0 ? (
                    <TrendingUp className="chg-icon" />
                  ) : sensex.changeBps < 0 ? (
                    <TrendingDown className="chg-icon" />
                  ) : (
                    <Remove className="chg-icon" />
                  )}
                  {sensex.changeBps > 0 ? "+" : ""}
                  {indexChangeValueToPoints(sensex.changeValue).toFixed(2)} (
                  {sensex.changeBps > 0 ? "+" : ""}
                  {bpsToPercent(sensex.changeBps).toFixed(2)}%)
                </span>
              </span>
            ) : (
              <span className="index-empty">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Primary Navigation Menu */}
      <Menu />
    </header>
  );
};

export default TopBar;

/**
 * NIVORA Trading Platform — TopBar Component
 * Displays NIVORA brand logo, persistent NIFTY 50 and SENSEX ticker indicators,
 * and the primary navigation menu with dev session controls.
 */

import React from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown } from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import Menu from "./Menu";

export const TopBar: React.FC = () => {
  const { indices, indicesLoading, selectInstrument, selectedInstrument } = useMarket();

  const nifty = indices.find(
    (idx) => idx.symbol === "NIFTY50" || idx.name.includes("NIFTY")
  );
  const sensex = indices.find(
    (idx) => idx.symbol === "SENSEX" || idx.name.includes("SENSEX")
  );

  const handleSelectNifty = () => {
    selectInstrument({
      symbol: "NIFTY 50",
      name: nifty?.name || "NIFTY 50 Index",
      type: "index",
      exchange: "NSE",
      lastPricePaise: nifty?.currentValuePaise,
      changePoints: nifty?.changePoints,
      changePercent: nifty?.changePercent,
    });
  };

  const handleSelectSensex = () => {
    selectInstrument({
      symbol: "SENSEX",
      name: sensex?.name || "BSE SENSEX Index",
      type: "index",
      exchange: "BSE",
      lastPricePaise: sensex?.currentValuePaise,
      changePoints: sensex?.changePoints,
      changePercent: sensex?.changePercent,
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
            {indicesLoading ? (
              <span className="index-loading">...</span>
            ) : nifty ? (
              <span className="index-values">
                <span className="index-points">
                  {(nifty.currentValue || nifty.currentValuePaise / 100).toLocaleString(
                    "en-IN",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </span>
                <span
                  className={`index-chg ${
                    nifty.changePoints >= 0 ? "positive" : "negative"
                  }`}
                >
                  {nifty.changePoints >= 0 ? (
                    <TrendingUp className="chg-icon" />
                  ) : (
                    <TrendingDown className="chg-icon" />
                  )}
                  {nifty.changePoints >= 0 ? "+" : ""}
                  {nifty.changePercent.toFixed(2)}%
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
            {indicesLoading ? (
              <span className="index-loading">...</span>
            ) : sensex ? (
              <span className="index-values">
                <span className="index-points">
                  {(
                    sensex.currentValue || sensex.currentValuePaise / 100
                  ).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span
                  className={`index-chg ${
                    sensex.changePoints >= 0 ? "positive" : "negative"
                  }`}
                >
                  {sensex.changePoints >= 0 ? (
                    <TrendingUp className="chg-icon" />
                  ) : (
                    <TrendingDown className="chg-icon" />
                  )}
                  {sensex.changePoints >= 0 ? "+" : ""}
                  {sensex.changePercent.toFixed(2)}%
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

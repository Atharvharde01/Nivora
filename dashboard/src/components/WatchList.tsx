/**
 * NIVORA Trading Platform — Marketwatch Component
 * Displays fixed indices (NIFTY 50, SENSEX) and user equity watchlist.
 * Supports instant instrument selection, live search, and buy/sell actions.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Clear,
  TrendingUp,
  TrendingDown,
  ShowChart,
} from "@mui/icons-material";
import { Tooltip, Grow } from "@mui/material";
import { useMarket, SelectedInstrument } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { WatchlistApi, InstrumentsApi } from "../api/client";
import { WatchlistItemDto, InstrumentSummary } from "../api/types";
import { watchlist as defaultWatchlistSeed } from "../data/data";

export const WatchList: React.FC = () => {
  const {
    selectedInstrument,
    selectInstrument,
    indices,
    openBuyWindow,
    openSellWindow,
  } = useMarket();
  const { isAuthenticated } = useAuth();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [remoteWatchlist, setRemoteWatchlist] = useState<WatchlistItemDto[]>([]);
  const [searchResults, setSearchResults] = useState<InstrumentSummary[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<number>(1);

  // Fetch watchlist from backend if user is authenticated
  const fetchWatchlist = useCallback(async () => {
    if (!isAuthenticated) {
      setRemoteWatchlist([]);
      return;
    }
    try {
      const res = await WatchlistApi.getWatchlist();
      if (res.success && res.data?.items) {
        setRemoteWatchlist(res.data.items);
      }
    } catch {
      // Graceful fallback to local seed data
      setRemoteWatchlist([]);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Handle live search
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let active = true;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await InstrumentsApi.search({ search: trimmed, limit: 10 });
        if (active && res.success && res.data?.items) {
          setSearchResults(res.data.items);
        }
      } catch {
        if (active) {
          setSearchResults([]);
        }
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Pinned Indices data
  const nifty = indices.find(
    (i) => i.symbol === "NIFTY50" || i.name.includes("NIFTY")
  );
  const sensex = indices.find(
    (i) => i.symbol === "SENSEX" || i.name.includes("SENSEX")
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

  // Build items list: either live backend watchlist, or search results, or initial seed
  const displayItems = useMemo(() => {
    if (searchQuery.trim().length > 0) {
      return searchResults.map((item) => ({
        id: item._id,
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchange,
        price: item.currentPricePaise ? item.currentPricePaise / 100 : 0,
        pricePaise: item.currentPricePaise,
        percent: "0.00%",
        isDown: false,
      }));
    }

    if (remoteWatchlist.length > 0) {
      return remoteWatchlist.map((item) => {
        const ltp = item.quote ? item.quote.lastPricePaise / 100 : 0;
        const prev = item.quote ? item.quote.previousClosePaise / 100 : ltp;
        const diff = ltp - prev;
        const pct = prev > 0 ? (diff / prev) * 100 : 0;
        return {
          id: item.instrumentId,
          symbol: item.symbol,
          name: item.name,
          exchange: (item.exchange as "NSE" | "BSE") || "NSE",
          price: ltp,
          pricePaise: item.quote?.lastPricePaise,
          percent: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
          isDown: diff < 0,
        };
      });
    }

    // Default seed fallback
    return defaultWatchlistSeed.map((stock, idx) => ({
      id: `seed-${idx}`,
      symbol: stock.name,
      name: `${stock.name} Equity`,
      exchange: "NSE" as const,
      price: stock.price,
      pricePaise: Math.round(stock.price * 100),
      percent: stock.percent,
      isDown: stock.isDown,
    }));
  }, [searchQuery, searchResults, remoteWatchlist]);

  const handleSelectItem = (item: (typeof displayItems)[0]) => {
    const selected: SelectedInstrument = {
      symbol: item.symbol,
      name: item.name,
      type: "equity",
      exchange: item.exchange,
      instrumentId: item.id.startsWith("seed-") ? undefined : item.id,
      lastPricePaise: item.pricePaise,
      changePercent: parseFloat(item.percent) || 0,
    };
    selectInstrument(selected);
  };

  return (
    <aside className="watchlist-container" aria-label="Marketwatch">
      {/* PINNED INDICES SECTION */}
      <div className="pinned-indices-header">
        <span className="section-eyebrow">INDICES</span>
        <div className="pinned-indices-grid">
          <div
            className={`pinned-index-card ${
              selectedInstrument.symbol === "NIFTY 50" ||
              selectedInstrument.symbol === "NIFTY50"
                ? "active"
                : ""
            }`}
            onClick={handleSelectNifty}
            role="button"
            tabIndex={0}
          >
            <div className="card-top">
              <span className="index-sym">NIFTY 50</span>
              <span className="index-exch">NSE</span>
            </div>
            <div className="card-bottom">
              <span className="index-val">
                {nifty
                  ? (nifty.currentValue || nifty.currentValuePaise / 100).toLocaleString(
                      "en-IN",
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    )
                  : "—"}
              </span>
              {nifty && (
                <span
                  className={`index-change ${
                    nifty.changePoints >= 0 ? "up" : "down"
                  }`}
                >
                  {nifty.changePoints >= 0 ? "+" : ""}
                  {nifty.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          <div
            className={`pinned-index-card ${
              selectedInstrument.symbol === "SENSEX" ? "active" : ""
            }`}
            onClick={handleSelectSensex}
            role="button"
            tabIndex={0}
          >
            <div className="card-top">
              <span className="index-sym">SENSEX</span>
              <span className="index-exch">BSE</span>
            </div>
            <div className="card-bottom">
              <span className="index-val">
                {sensex
                  ? (
                      sensex.currentValue || sensex.currentValuePaise / 100
                    ).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "—"}
              </span>
              {sensex && (
                <span
                  className={`index-change ${
                    sensex.changePoints >= 0 ? "up" : "down"
                  }`}
                >
                  {sensex.changePoints >= 0 ? "+" : ""}
                  {sensex.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* WATCHLIST SEARCH BAR */}
      <div className="watchlist-search-wrapper">
        <div className="watchlist-search-input-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search eg: infy, bse, nifty, reliance"
            className="watchlist-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery("")}
            >
              <Clear sx={{ fontSize: 16 }} />
            </button>
          )}
        </div>
        <span className="watchlist-count">{displayItems.length} / 50</span>
      </div>

      {/* WATCHLIST ITEMS LIST */}
      <div className="watchlist-scrollable-area">
        {isSearching && (
          <div className="watchlist-empty-state">Searching instruments...</div>
        )}

        {!isSearching && displayItems.length === 0 && (
          <div className="watchlist-empty-state">
            {searchQuery
              ? "No matching instruments found"
              : "No instruments in watchlist"}
          </div>
        )}

        <ul className="watchlist-list">
          {displayItems.map((item) => {
            const isSelected = selectedInstrument.symbol === item.symbol;
            return (
              <li
                key={item.id}
                className={`watchlist-item-row ${isSelected ? "selected-row" : ""}`}
                onClick={() => handleSelectItem(item)}
              >
                <div className="item-main">
                  <div className="item-symbol-group">
                    <span className="item-symbol">{item.symbol}</span>
                    <span className="item-exchange">{item.exchange}</span>
                  </div>
                  <div className="item-price-group">
                    <span className={`item-percent ${item.isDown ? "down" : "up"}`}>
                      {item.percent}
                    </span>
                    {item.isDown ? (
                      <TrendingDown className="trend-icon down" />
                    ) : (
                      <TrendingUp className="trend-icon up" />
                    )}
                    <span className="item-price">
                      {item.price > 0
                        ? item.price.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* HOVER ACTIONS */}
                <div className="row-hover-actions" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Buy (B)" arrow TransitionComponent={Grow}>
                    <button
                      type="button"
                      className="btn-action btn-buy"
                      onClick={() =>
                        openBuyWindow({
                          symbol: item.symbol,
                          name: item.name,
                          type: "equity",
                          exchange: item.exchange,
                          instrumentId: item.id.startsWith("seed-")
                            ? undefined
                            : item.id,
                          lastPricePaise: item.pricePaise,
                        })
                      }
                    >
                      B
                    </button>
                  </Tooltip>
                  <Tooltip title="Sell (S)" arrow TransitionComponent={Grow}>
                    <button
                      type="button"
                      className="btn-action btn-sell"
                      onClick={() =>
                        openSellWindow({
                          symbol: item.symbol,
                          name: item.name,
                          type: "equity",
                          exchange: item.exchange,
                          instrumentId: item.id.startsWith("seed-")
                            ? undefined
                            : item.id,
                          lastPricePaise: item.pricePaise,
                        })
                      }
                    >
                      S
                    </button>
                  </Tooltip>
                  <Tooltip title="View Chart" arrow TransitionComponent={Grow}>
                    <button
                      type="button"
                      className="btn-action btn-chart"
                      onClick={() => handleSelectItem(item)}
                    >
                      <ShowChart sx={{ fontSize: 16 }} />
                    </button>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* WATCHLIST PAGINATION / NUMBER TABS */}
      <div className="watchlist-pagination-footer">
        <div className="tab-pill-group">
          {[1, 2, 3, 4, 5].map((tabNum) => (
            <button
              key={tabNum}
              type="button"
              className={`tab-pill ${activeTab === tabNum ? "active-tab" : ""}`}
              onClick={() => setActiveTab(tabNum)}
            >
              {tabNum}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default WatchList;

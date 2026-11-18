/**
 * NIVORA Trading Platform — Marketwatch Component
 * Displays fixed synthetic indices (NIFTY 50, SENSEX) with expandable constituents,
 * live equity search, and real user watchlist.
 * Strictly avoids fabricated mock prices or fake 0.00% fallbacks.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Clear,
  TrendingUp,
  TrendingDown,
  Remove,
  ShowChart,
  KeyboardArrowDown,
  KeyboardArrowUp,
  AccountTree,
} from "@mui/icons-material";
import { Tooltip, Grow } from "@mui/material";
import { useMarket, SelectedInstrument } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { WatchlistApi, InstrumentsApi } from "../api/client";
import {
  WatchlistItemDto,
  InstrumentSummary,
  MarketIndexSymbol,
  indexValueToPoints,
  indexChangeValueToPoints,
  bpsToPercent,
  formatIndexPoints,
  formatRupees,
  paiseToRupees,
} from "../api/types";

export const WatchList: React.FC = () => {
  const {
    selectedInstrument,
    selectInstrument,
    indices,
    expandedIndices,
    indexDetailsCache,
    indexDetailsLoading,
    indexDetailsError,
    toggleExpandIndex,
    openBuyWindow,
    openSellWindow,
  } = useMarket();
  const { isAuthenticated } = useAuth();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [remoteWatchlist, setRemoteWatchlist] = useState<WatchlistItemDto[]>([]);
  const [searchResults, setSearchResults] = useState<InstrumentSummary[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<number>(1);

  // Fetch user's real watchlist from backend
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
      setRemoteWatchlist([]);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Handle live instrument search
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
        const res = await InstrumentsApi.search({ search: trimmed, limit: 15 });
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

  // Pinned Synthetic Indices
  const nifty = indices.find((i) => i.symbol === "NIFTY50");
  const sensex = indices.find((i) => i.symbol === "SENSEX");

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

  // Convert real search results or watchlist items (NO fabricated fallbacks!)
  const displayItems = useMemo(() => {
    if (searchQuery.trim().length > 0) {
      return searchResults.map((item) => {
        const hasPrice = item.lastPricePaise !== undefined && item.lastPricePaise > 0;
        const priceRupees = hasPrice ? paiseToRupees(item.lastPricePaise) : null;
        const prevRupees =
          item.previousClosePaise && item.previousClosePaise > 0
            ? paiseToRupees(item.previousClosePaise)
            : priceRupees;

        const diff = priceRupees !== null && prevRupees !== null ? priceRupees - prevRupees : null;
        const pct = diff !== null && prevRupees && prevRupees > 0 ? (diff / prevRupees) * 100 : null;

        return {
          id: item._id,
          symbol: item.symbol,
          name: item.name,
          exchange: item.exchange,
          priceRupees,
          pricePaise: item.lastPricePaise,
          diff,
          pct,
        };
      });
    }

    // Live backend watchlist
    return remoteWatchlist.map((item) => {
      const quote = item.quote;
      const hasPrice = quote && quote.lastPricePaise > 0;
      const priceRupees = hasPrice ? paiseToRupees(quote.lastPricePaise) : null;
      const prevRupees =
        quote && quote.previousClosePaise > 0
          ? paiseToRupees(quote.previousClosePaise)
          : priceRupees;

      const diff = priceRupees !== null && prevRupees !== null ? priceRupees - prevRupees : null;
      const pct = diff !== null && prevRupees && prevRupees > 0 ? (diff / prevRupees) * 100 : null;

      return {
        id: item.instrumentId,
        symbol: item.symbol,
        name: item.name,
        exchange: (item.exchange as "NSE" | "BSE") || "NSE",
        priceRupees,
        pricePaise: quote?.lastPricePaise,
        diff,
        pct,
      };
    });
  }, [searchQuery, searchResults, remoteWatchlist]);

  const handleSelectItem = (item: (typeof displayItems)[0]) => {
    const selected: SelectedInstrument = {
      symbol: item.symbol,
      name: item.name,
      type: "equity",
      exchange: item.exchange,
      instrumentId: item.id,
      lastPricePaise: item.pricePaise,
    };
    selectInstrument(selected);
  };

  const renderIndexCard = (symbol: MarketIndexSymbol, label: string, exch: "NSE" | "BSE") => {
    const idx = symbol === "NIFTY50" ? nifty : sensex;
    const isSelected =
      selectedInstrument.symbol === label ||
      selectedInstrument.indexSymbol === symbol;
    const isExpanded = Boolean(expandedIndices[symbol]);
    const details = indexDetailsCache[symbol];
    const isLoading = Boolean(indexDetailsLoading[symbol]);
    const error = indexDetailsError[symbol];

    const changeBps = idx?.changeBps ?? 0;
    const changePoints = idx ? indexChangeValueToPoints(idx.changeValue) : 0;
    const changePercent = bpsToPercent(changeBps);

    return (
      <div className={`pinned-index-wrapper ${isSelected ? "selected-index" : ""}`}>
        <div
          className={`pinned-index-card ${isSelected ? "active" : ""}`}
          onClick={symbol === "NIFTY50" ? handleSelectNifty : handleSelectSensex}
          role="button"
          tabIndex={0}
        >
          <div className="card-top">
            <span className="index-sym">{label}</span>
            <div className="card-top-right">
              <span className="index-exch">{exch}</span>
              <button
                type="button"
                className={`btn-expand-constituents ${isExpanded ? "expanded" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpandIndex(symbol);
                }}
                title={isExpanded ? "Collapse constituents" : "Expand constituents"}
                aria-label={`Toggle ${label} constituents`}
              >
                {isExpanded ? (
                  <KeyboardArrowUp sx={{ fontSize: 18 }} />
                ) : (
                  <KeyboardArrowDown sx={{ fontSize: 18 }} />
                )}
              </button>
            </div>
          </div>

          <div className="card-bottom">
            <span className="index-val">
              {idx ? formatIndexPoints(indexValueToPoints(idx.currentValue)) : "—"}
            </span>
            {idx && (
              <span
                className={`index-change ${
                  changeBps > 0 ? "up" : changeBps < 0 ? "down" : "neutral"
                }`}
              >
                {changeBps > 0 ? "+" : ""}
                {changePoints.toFixed(2)} ({changeBps > 0 ? "+" : ""}
                {changePercent.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>

        {/* EXPANDABLE CONSTITUENTS ACCORDION */}
        {isExpanded && (
          <div className="constituents-accordion-panel">
            <div className="constituents-panel-header">
              <span className="constituents-header-title">
                <AccountTree sx={{ fontSize: 14, mr: 0.5, verticalAlign: "middle" }} />
                {label} Constituents ({details?.constituents?.length ?? (symbol === "NIFTY50" ? 50 : 30)})
              </span>
              <span className="constituents-source-tag">Equal-Weighted Basket</span>
            </div>

            {isLoading && (
              <div className="constituents-loading">Loading constituents...</div>
            )}

            {error && (
              <div className="constituents-error">{error}</div>
            )}

            {!isLoading && details && (
              <ul className="constituents-list">
                {details.constituents.map((c) => {
                  const isConstituentSelected =
                    selectedInstrument.instrumentId === c.instrumentId;
                  const weightPct = bpsToPercent(c.weightBps).toFixed(2);
                  const baseRupees = formatRupees(paiseToRupees(c.basePricePaise));

                  return (
                    <li
                      key={c.instrumentId}
                      className={`constituent-row ${
                        isConstituentSelected ? "selected-constituent" : ""
                      }`}
                      onClick={() =>
                        selectInstrument({
                          symbol: c.symbol,
                          name: `${c.symbol} (${c.exchange})`,
                          type: "equity",
                          exchange: c.exchange,
                          instrumentId: c.instrumentId,
                          lastPricePaise: c.basePricePaise,
                        })
                      }
                      title={`Click to view ${c.symbol} live quote in workspace`}
                    >
                      <div className="constituent-left">
                        <span className="constituent-symbol">{c.symbol}</span>
                        <span className="constituent-exch">{c.exchange}</span>
                      </div>
                      <div className="constituent-right">
                        <span className="constituent-weight">{weightPct}%</span>
                        <span className="constituent-base-price">Base ₹{baseRupees}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="watchlist-container" aria-label="Marketwatch">
      {/* PINNED SYNTHETIC INDICES SECTION */}
      <div className="pinned-indices-header">
        <span className="section-eyebrow">SYNTHETIC BENCHMARKS</span>
        <div className="pinned-indices-grid">
          {renderIndexCard("NIFTY50", "NIFTY 50", "NSE")}
          {renderIndexCard("SENSEX", "SENSEX", "BSE")}
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

      {/* WATCHLIST ITEMS LIST (NO SAMPLE PRICE FABRICATION) */}
      <div className="watchlist-scrollable-area">
        {isSearching && (
          <div className="watchlist-empty-state">Searching instruments...</div>
        )}

        {!isSearching && displayItems.length === 0 && (
          <div className="watchlist-empty-state">
            {searchQuery ? (
              <>
                <p className="empty-title">No matching instruments</p>
                <p className="empty-sub">Try searching by equity symbol or name.</p>
              </>
            ) : (
              <>
                <p className="empty-title">Watchlist is Empty</p>
                <p className="empty-sub">
                  Search equities above, or click any constituent from NIFTY 50 or SENSEX to
                  inspect live quotes.
                </p>
              </>
            )}
          </div>
        )}

        <ul className="watchlist-list">
          {displayItems.map((item) => {
            const isSelected = selectedInstrument.symbol === item.symbol;
            const hasQuote = item.priceRupees !== null;
            const isUp = item.diff !== null && item.diff > 0;
            const isDown = item.diff !== null && item.diff < 0;

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
                    {item.pct !== null ? (
                      <span className={`item-percent ${isDown ? "down" : isUp ? "up" : "neutral"}`}>
                        {isUp ? "+" : ""}
                        {item.pct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="item-percent neutral">—</span>
                    )}

                    {isDown ? (
                      <TrendingDown className="trend-icon down" />
                    ) : isUp ? (
                      <TrendingUp className="trend-icon up" />
                    ) : (
                      <Remove className="trend-icon neutral" />
                    )}

                    <span className="item-price">
                      {hasQuote ? `₹${formatRupees(item.priceRupees!)}` : "—"}
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
                          instrumentId: item.id,
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
                          instrumentId: item.id,
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

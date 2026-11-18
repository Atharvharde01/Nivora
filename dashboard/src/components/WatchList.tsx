/**
 * NIVORA Trading Platform — Marketwatch Component
 * Displays fixed synthetic indices (NIFTY 50, SENSEX) with expandable constituents,
 * backend-connected live instrument search with dedicated results panel,
 * authenticated user's watchlist with 5-tab client-side pagination (10 items/page, max 50),
 * add/remove actions, and full-list reordering.
 * Strictly avoids fabricated mock prices or fake 0.00% fallbacks.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Add,
  Check,
  DeleteOutline,
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

export const PAGE_SIZE = 10;
export const MAX_WATCHLIST_CAPACITY = 50;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message || fallback);
  }
  return fallback;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
};

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

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<InstrumentSummary[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Watchlist & pagination state
  const [remoteWatchlist, setRemoteWatchlist] = useState<WatchlistItemDto[]>([]);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef<number>(0);

  // Auto-dismiss feedback banner after 4 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

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
      // Keep previous valid items during transient errors
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Handle live instrument search with debouncing (250ms), signal cancellation, and stale protection
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
        searchAbortControllerRef.current = null;
      }
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    const currentReqId = ++searchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await InstrumentsApi.search(
          { search: trimmed, isTradable: true, page: 1, limit: 15 },
          { signal: controller.signal }
        );
        if (currentReqId === searchRequestIdRef.current && res.success && res.data?.items) {
          setSearchResults(res.data.items);
          setSearchError(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || currentReqId !== searchRequestIdRef.current) {
          return; // Ignore stale or aborted requests
        }
        setSearchResults([]);
        setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (currentReqId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Cleanup in-flight search on unmount
  useEffect(() => {
    return () => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, []);

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

  // Add instrument to watchlist
  const handleAddToWatchlist = async (item: InstrumentSummary) => {
    if (!isAuthenticated) {
      setFeedback({ type: "error", message: "Please sign in to manage your watchlist." });
      return;
    }

    if (remoteWatchlist.some((w) => w.instrumentId === item._id)) {
      setFeedback({ type: "error", message: "Instrument is already in your watchlist." });
      return;
    }

    if (remoteWatchlist.length >= MAX_WATCHLIST_CAPACITY) {
      setFeedback({
        type: "error",
        message: "Watchlist is full (max 50 instruments).",
      });
      return;
    }

    setMutatingItemId(item._id);
    try {
      const res = await WatchlistApi.addItem(item._id);
      if (res.success && res.data?.item) {
        const newItem = res.data.item;
        setRemoteWatchlist((prev) => [...prev, newItem]);
        // Make newly added item discoverable by navigating to its page
        const newTotal = remoteWatchlist.length + 1;
        const targetPage = Math.ceil(newTotal / PAGE_SIZE);
        if (targetPage !== activeTab) {
          setActiveTab(targetPage);
        }
        setFeedback({
          type: "success",
          message: `Added ${item.symbol} to watchlist.`,
        });
      } else {
        const errCode = getErrorCode(res.error);
        const errorMsg =
          errCode === "WATCHLIST_ITEM_ALREADY_EXISTS"
            ? "Instrument is already in your watchlist."
            : errCode === "WATCHLIST_CAPACITY_EXCEEDED"
            ? "Watchlist is full (max 50 instruments)."
            : errCode === "INSTRUMENT_NOT_FOUND"
            ? "Instrument not found."
            : getErrorMessage(res.error, "Failed to add instrument to watchlist.");
        setFeedback({ type: "error", message: errorMsg });
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to add instrument to watchlist.",
      });
    } finally {
      setMutatingItemId(null);
    }
  };

  // Remove instrument from watchlist (preserves workspace selected instrument!)
  const handleRemoveFromWatchlist = async (instrumentId: string, symbol: string) => {
    if (!isAuthenticated) return;

    setMutatingItemId(instrumentId);
    try {
      const res = await WatchlistApi.removeItem(instrumentId);
      if (res.success) {
        const updated = remoteWatchlist.filter((w) => w.instrumentId !== instrumentId);
        setRemoteWatchlist(updated);

        // Auto-decrement page if current page became empty
        const maxValidPage = Math.max(1, Math.ceil(updated.length / PAGE_SIZE));
        if (activeTab > maxValidPage) {
          setActiveTab(maxValidPage);
        }

        setFeedback({
          type: "success",
          message: `Removed ${symbol} from watchlist.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: getErrorMessage(res.error, "Failed to remove instrument from watchlist."),
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to remove instrument from watchlist.",
      });
    } finally {
      setMutatingItemId(null);
    }
  };

  // Reorder watchlist (sends complete ordered array of all instrument IDs)
  const handleReorder = async (fromFullIndex: number, toFullIndex: number) => {
    if (
      !isAuthenticated ||
      fromFullIndex < 0 ||
      fromFullIndex >= remoteWatchlist.length ||
      toFullIndex < 0 ||
      toFullIndex >= remoteWatchlist.length ||
      fromFullIndex === toFullIndex ||
      remoteWatchlist.length < 2
    ) {
      return;
    }

    const previousList = [...remoteWatchlist];
    const reorderedList = [...remoteWatchlist];
    const [moved] = reorderedList.splice(fromFullIndex, 1);
    reorderedList.splice(toFullIndex, 0, moved);

    // If moving across page boundary, update activeTab to follow the moved item
    const targetPage = Math.floor(toFullIndex / PAGE_SIZE) + 1;
    if (targetPage !== activeTab) {
      setActiveTab(targetPage);
    }

    // Optimistically update
    setRemoteWatchlist(reorderedList);
    setMutatingItemId(moved.instrumentId);

    try {
      const instrumentIds = reorderedList.map((i) => i.instrumentId);
      const res = await WatchlistApi.reorder(instrumentIds);
      if (!res.success) {
        // Rollback on API error
        setRemoteWatchlist(previousList);
        setFeedback({
          type: "error",
          message: getErrorMessage(res.error, "Failed to reorder watchlist."),
        });
      }
    } catch {
      // Rollback on network exception
      setRemoteWatchlist(previousList);
      setFeedback({
        type: "error",
        message: "Failed to reorder watchlist.",
      });
    } finally {
      setMutatingItemId(null);
    }
  };

  // Sliced items for client-side pagination (10 per page)
  const pageStartIndex = (activeTab - 1) * PAGE_SIZE;
  const visibleWatchlistItems = useMemo(() => {
    return remoteWatchlist.slice(pageStartIndex, pageStartIndex + PAGE_SIZE);
  }, [remoteWatchlist, pageStartIndex]);

  // Select equity instrument into workspace
  const handleSelectEquity = (
    instrumentId: string,
    symbol: string,
    name: string,
    exchange: "NSE" | "BSE",
    pricePaise?: number
  ) => {
    const selected: SelectedInstrument = {
      symbol,
      name,
      type: "equity",
      exchange,
      instrumentId,
      lastPricePaise: pricePaise,
    };
    selectInstrument(selected);
  };

  // Render pinned index benchmark card
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

  const isSearchPanelOpen = searchQuery.trim().length > 0;

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

      {/* WATCHLIST SEARCH BAR & DEDICATED RESULTS OVERLAY */}
      <div className="watchlist-search-wrapper">
        <div className="watchlist-search-input-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search eg: infy, bse, nifty, reliance"
            className="watchlist-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search instruments"
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery("")}
              title="Clear search"
              aria-label="Clear search"
            >
              <Clear sx={{ fontSize: 16 }} />
            </button>
          )}
        </div>
        <span className="watchlist-count">{remoteWatchlist.length} / {MAX_WATCHLIST_CAPACITY}</span>

        {/* DEDICATED SEARCH RESULTS PANEL */}
        {isSearchPanelOpen && (
          <div className="watchlist-search-results-panel" role="region" aria-label="Search results">
            <div className="search-panel-header">
              <span className="search-panel-title">
                CATALOGUE SEARCH {searchResults.length > 0 && `(${searchResults.length})`}
              </span>
              <button
                type="button"
                className="search-panel-close-btn"
                onClick={() => setSearchQuery("")}
                title="Close search results"
                aria-label="Close search results"
              >
                Close
              </button>
            </div>

            {isSearching && (
              <div className="search-status-message">Searching instruments...</div>
            )}

            {searchError && (
              <div className="search-status-error">{searchError}</div>
            )}

            {!isSearching && !searchError && searchResults.length === 0 && (
              <div className="search-status-empty">
                <p className="empty-title">No instruments found</p>
                <p className="empty-sub">
                  No tradable instrument matches "{searchQuery}".
                </p>
              </div>
            )}

            {!isSearching && searchResults.length > 0 && (
              <ul className="search-results-list">
                {searchResults.map((item) => {
                  const isAdded = remoteWatchlist.some(
                    (w) => w.instrumentId === item._id
                  );
                  const isCurrentSelection =
                    selectedInstrument.symbol === item.symbol;
                  const hasPrice =
                    item.lastPricePaise !== undefined && item.lastPricePaise > 0;
                  const priceRupees = hasPrice ? paiseToRupees(item.lastPricePaise) : null;
                  const prevRupees =
                    item.previousClosePaise && item.previousClosePaise > 0
                      ? paiseToRupees(item.previousClosePaise)
                      : priceRupees;
                  const diff =
                    priceRupees !== null && prevRupees !== null
                      ? priceRupees - prevRupees
                      : null;
                  const pct =
                    diff !== null && prevRupees && prevRupees > 0
                      ? (diff / prevRupees) * 100
                      : null;

                  return (
                    <li
                      key={item._id}
                      className={`search-result-row ${
                        isCurrentSelection ? "selected-result" : ""
                      }`}
                      onClick={() =>
                        handleSelectEquity(
                          item._id,
                          item.symbol,
                          item.name,
                          item.exchange,
                          item.lastPricePaise
                        )
                      }
                      title={`Click to inspect ${item.symbol} in workspace`}
                    >
                      <div className="search-row-left">
                        <div className="search-row-sym-group">
                          <span className="search-item-symbol">{item.symbol}</span>
                          <span className="search-item-exch">{item.exchange}</span>
                        </div>
                        <span className="search-item-name">{item.name}</span>
                      </div>

                      <div className="search-row-right" onClick={(e) => e.stopPropagation()}>
                        {hasPrice && (
                          <div className="search-row-pricing">
                            <span className="search-item-price">
                              ₹{formatRupees(priceRupees!)}
                            </span>
                            {pct !== null ? (
                              <span
                                className={`search-item-pct ${
                                  pct > 0 ? "up" : pct < 0 ? "down" : "neutral"
                                }`}
                              >
                                {pct > 0 ? "+" : ""}
                                {pct.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="search-item-pct neutral">—</span>
                            )}
                          </div>
                        )}

                        <Tooltip title="View Chart in Workspace" arrow>
                          <button
                            type="button"
                            className="btn-search-chart"
                            onClick={() =>
                              handleSelectEquity(
                                item._id,
                                item.symbol,
                                item.name,
                                item.exchange,
                                item.lastPricePaise
                              )
                            }
                            aria-label={`View ${item.symbol} chart`}
                          >
                            <ShowChart sx={{ fontSize: 16 }} />
                          </button>
                        </Tooltip>

                        {isAdded ? (
                          <button
                            type="button"
                            className="btn-add-watchlist added"
                            disabled
                            title="Already in watchlist"
                            aria-label={`${item.symbol} already in watchlist`}
                          >
                            <Check sx={{ fontSize: 14 }} />
                            <span>Added</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-add-watchlist"
                            disabled={mutatingItemId === item._id}
                            onClick={() => handleAddToWatchlist(item)}
                            title="Add to watchlist"
                            aria-label={`Add ${item.symbol} to watchlist`}
                          >
                            <Add sx={{ fontSize: 14 }} />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* FEEDBACK BANNER */}
      {feedback && (
        <div
          className={`watchlist-feedback-banner ${feedback.type}`}
          role="alert"
        >
          <span className="feedback-text">{feedback.message}</span>
          <button
            type="button"
            className="btn-close-feedback"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss feedback"
          >
            ×
          </button>
        </div>
      )}

      {/* WATCHLIST ITEMS LIST (NO SAMPLE PRICE FABRICATION) */}
      <div className="watchlist-scrollable-area">
        {remoteWatchlist.length === 0 ? (
          <div className="watchlist-empty-state">
            <p className="empty-title">Watchlist is Empty</p>
            <p className="empty-sub">
              Search instruments above to add equities to your watchlist, or click
              any constituent from NIFTY 50 or SENSEX.
            </p>
          </div>
        ) : (
          <ul className="watchlist-list">
            {visibleWatchlistItems.map((item, indexOnPage) => {
              const fullIndex = pageStartIndex + indexOnPage;
              const isSelected = selectedInstrument.symbol === item.symbol;
              const quote = item.quote;
              const hasQuote = quote !== null && quote !== undefined && quote.lastPricePaise > 0;
              const priceRupees = hasQuote ? paiseToRupees(quote.lastPricePaise) : null;
              const prevRupees =
                quote && quote.previousClosePaise > 0
                  ? paiseToRupees(quote.previousClosePaise)
                  : priceRupees;

              const diff =
                priceRupees !== null && prevRupees !== null ? priceRupees - prevRupees : null;
              const pct =
                diff !== null && prevRupees && prevRupees > 0
                  ? (diff / prevRupees) * 100
                  : null;

              const isUp = diff !== null && diff > 0;
              const isDown = diff !== null && diff < 0;

              const isFirst = fullIndex === 0;
              const isLast = fullIndex === remoteWatchlist.length - 1;
              const isMutating = mutatingItemId === item.instrumentId;

              return (
                <li
                  key={item.id || item.instrumentId}
                  className={`watchlist-item-row ${isSelected ? "selected-row" : ""}`}
                  onClick={() =>
                    handleSelectEquity(
                      item.instrumentId,
                      item.symbol,
                      item.name,
                      (item.exchange as "NSE" | "BSE") || "NSE",
                      quote?.lastPricePaise
                    )
                  }
                >
                  <div className="item-main">
                    <div className="item-symbol-group">
                      <span className="item-symbol">{item.symbol}</span>
                      <span className="item-exchange">{item.exchange}</span>
                    </div>

                    <div className="item-price-group">
                      {pct !== null ? (
                        <span
                          className={`item-percent ${isDown ? "down" : isUp ? "up" : "neutral"}`}
                        >
                          {isUp ? "+" : ""}
                          {pct.toFixed(2)}%
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
                        {hasQuote ? `₹${formatRupees(priceRupees!)}` : "—"}
                      </span>
                    </div>
                  </div>

                  {/* HOVER & REORDER ACTIONS */}
                  <div className="row-hover-actions" onClick={(e) => e.stopPropagation()}>
                    {/* Reorder controls */}
                    <div className="reorder-action-group">
                      <Tooltip title="Move up" arrow TransitionComponent={Grow}>
                        <span>
                          <button
                            type="button"
                            className="btn-reorder"
                            disabled={isFirst || remoteWatchlist.length < 2 || isMutating}
                            onClick={() => handleReorder(fullIndex, fullIndex - 1)}
                            aria-label={`Move ${item.symbol} up`}
                          >
                            <KeyboardArrowUp sx={{ fontSize: 16 }} />
                          </button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down" arrow TransitionComponent={Grow}>
                        <span>
                          <button
                            type="button"
                            className="btn-reorder"
                            disabled={isLast || remoteWatchlist.length < 2 || isMutating}
                            onClick={() => handleReorder(fullIndex, fullIndex + 1)}
                            aria-label={`Move ${item.symbol} down`}
                          >
                            <KeyboardArrowDown sx={{ fontSize: 16 }} />
                          </button>
                        </span>
                      </Tooltip>
                    </div>

                    <Tooltip title="Buy (B)" arrow TransitionComponent={Grow}>
                      <button
                        type="button"
                        className="btn-action btn-buy"
                        onClick={() =>
                          openBuyWindow({
                            symbol: item.symbol,
                            name: item.name,
                            type: "equity",
                            exchange: (item.exchange as "NSE" | "BSE") || "NSE",
                            instrumentId: item.instrumentId,
                            lastPricePaise: quote?.lastPricePaise,
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
                            exchange: (item.exchange as "NSE" | "BSE") || "NSE",
                            instrumentId: item.instrumentId,
                            lastPricePaise: quote?.lastPricePaise,
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
                        onClick={() =>
                          handleSelectEquity(
                            item.instrumentId,
                            item.symbol,
                            item.name,
                            (item.exchange as "NSE" | "BSE") || "NSE",
                            quote?.lastPricePaise
                          )
                        }
                        aria-label={`View ${item.symbol} chart`}
                      >
                        <ShowChart sx={{ fontSize: 16 }} />
                      </button>
                    </Tooltip>

                    <Tooltip title="Remove from Watchlist" arrow TransitionComponent={Grow}>
                      <button
                        type="button"
                        className="btn-remove-watchlist"
                        disabled={isMutating}
                        onClick={() =>
                          handleRemoveFromWatchlist(item.instrumentId, item.symbol)
                        }
                        aria-label={`Remove ${item.symbol} from watchlist`}
                      >
                        <DeleteOutline sx={{ fontSize: 16 }} />
                      </button>
                    </Tooltip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* WATCHLIST PAGINATION / NUMBER TABS 1 TO 5 */}
      <div className="watchlist-pagination-footer">
        <div className="tab-pill-group">
          {[1, 2, 3, 4, 5].map((tabNum) => {
            const isTabDisabled =
              tabNum > 1 && remoteWatchlist.length <= (tabNum - 1) * PAGE_SIZE;
            const isActive = activeTab === tabNum;

            return (
              <button
                key={tabNum}
                type="button"
                className={`tab-pill ${isActive ? "active-tab" : ""}`}
                disabled={isTabDisabled}
                onClick={() => {
                  if (!isTabDisabled) {
                    setActiveTab(tabNum);
                  }
                }}
                title={
                  isTabDisabled
                    ? `Page ${tabNum} (requires > ${(tabNum - 1) * PAGE_SIZE} items)`
                    : `Page ${tabNum}`
                }
                aria-label={`Watchlist page ${tabNum}`}
              >
                {tabNum}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default WatchList;

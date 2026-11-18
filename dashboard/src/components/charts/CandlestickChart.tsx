/**
 * NIVORA Trading Platform — Interactive Candlestick Chart
 * Powered by TradingView Lightweight Charts v5.3.0.
 *
 * Supports:
 * - Synthetic Market Indices: NIFTY 50 and SENSEX (/api/v1/market/indices/:symbol/candles)
 * - Tradable Equities: RELIANCE, TCS, INFY, etc. (/api/v1/market/instruments/:instrumentId/candles)
 * - Timeframes: 1m, 5m, 15m, 1h, 1d
 * - Fixed-point index points & integer paise conversions
 * - Asia/Kolkata timezone formatting for crosshair & time scale
 * - 15-second background polling with concurrency guards
 * - Clean responsive ResizeObserver lifecycle management
 * - Prominent simulated data disclaimer & TradingView license attribution
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
} from "lightweight-charts";
import {
  FitScreen,
  Refresh,
  Timeline,
  WarningAmber,
} from "@mui/icons-material";
import {
  CandleInterval,
  INITIAL_CANDLE_LIMITS,
  MarketIndexSymbol,
} from "../../api/types";
import { MarketApi } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { SelectedInstrument } from "../../context/MarketContext";
import {
  formatChartPrice,
  formatUnixTimestampToIST,
  transformEquityCandles,
  transformIndexCandles,
} from "./chart.utils";

export const CHART_POLL_INTERVAL_MS = 15000;
const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

export interface CandlestickChartProps {
  instrument: SelectedInstrument;
  interval: CandleInterval;
  onIntervalChange: (interval: CandleInterval) => void;
  className?: string;
}

interface LegendData {
  timeStr: string;
  openStr: string;
  highStr: string;
  lowStr: string;
  closeStr: string;
  diffStr: string;
  pctStr: string;
  isPositive: boolean;
  isNegative: boolean;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  instrument,
  interval,
  onIntervalChange,
  className = "",
}) => {
  const { isAuthenticated } = useAuth();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Guard against concurrent overlapping fetch requests
  const isFetchingRef = useRef<boolean>(false);
  // Track currently loaded candles to avoid redundant full setData re-renders
  const lastCandlesRef = useRef<CandlestickData<Time>[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);
  const [legend, setLegend] = useState<LegendData | null>(null);

  const isIndex = instrument.type === "index";

  // Resolve canonical symbol for synthetic market index endpoints
  const getIndexCanonicalSymbol = useCallback((): MarketIndexSymbol => {
    if (instrument.indexSymbol) {
      return instrument.indexSymbol;
    }
    if (instrument.symbol === "NIFTY 50" || instrument.symbol === "NIFTY50") {
      return "NIFTY50";
    }
    return "SENSEX";
  }, [instrument]);

  // ==================== CHART DATA FETCHING ====================

  const fetchCandles = useCallback(
    async (isPolling: boolean = false) => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }

      if (isFetchingRef.current) {
        return; // Prevent overlapping requests
      }

      isFetchingRef.current = true;

      if (!isPolling) {
        setLoading(true);
        setError(null);
        setPollError(null);
      }

      const limit = INITIAL_CANDLE_LIMITS[interval];

      try {
        let transformed: CandlestickData<Time>[] = [];

        if (isIndex) {
          const symbol = getIndexCanonicalSymbol();
          const response = await MarketApi.getIndexCandles(symbol, {
            interval,
            limit,
          });

          if (response.success && response.data && Array.isArray(response.data.candles)) {
            transformed = transformIndexCandles(response.data.candles);
          } else {
            throw new Error(response.message || "Failed to load index candle data");
          }
        } else {
          if (!instrument.instrumentId) {
            throw new Error(`Instrument ID is missing for ${instrument.symbol}`);
          }

          const response = await MarketApi.getInstrumentCandles(
            instrument.instrumentId,
            {
              interval,
              limit,
            }
          );

          if (response.success && response.data && Array.isArray(response.data.candles)) {
            transformed = transformEquityCandles(response.data.candles);
          } else {
            throw new Error(response.message || "Failed to load equity candle data");
          }
        }

        if (transformed.length === 0) {
          setIsEmpty(true);
          lastCandlesRef.current = [];
          if (seriesRef.current) {
            seriesRef.current.setData([]);
          }
        } else {
          setIsEmpty(false);

          // Update chart series
          if (seriesRef.current) {
            const prev = lastCandlesRef.current;
            // Check if we can do an incremental update (last candle only)
            const canIncrementalUpdate =
              isPolling &&
              prev.length > 0 &&
              prev.length === transformed.length &&
              prev[prev.length - 1].time === transformed[transformed.length - 1].time;

            if (canIncrementalUpdate) {
              const lastCandle = transformed[transformed.length - 1];
              seriesRef.current.update(lastCandle);
            } else {
              seriesRef.current.setData(transformed);
              if (!isPolling) {
                chartRef.current?.timeScale().fitContent();
              }
            }
          }

          lastCandlesRef.current = transformed;

          // Update legend with latest candle if no crosshair hover is active
          const latest = transformed[transformed.length - 1];
          const diff = latest.close - latest.open;
          const pct = latest.open > 0 ? (diff / latest.open) * 100 : 0;
          setLegend({
            timeStr: formatUnixTimestampToIST(latest.time as number, interval),
            openStr: formatChartPrice(latest.open, isIndex),
            highStr: formatChartPrice(latest.high, isIndex),
            lowStr: formatChartPrice(latest.low, isIndex),
            closeStr: formatChartPrice(latest.close, isIndex),
            diffStr: (diff >= 0 ? "+" : "") + formatChartPrice(diff, isIndex),
            pctStr: (diff >= 0 ? "+" : "") + pct.toFixed(2) + "%",
            isPositive: diff > 0,
            isNegative: diff < 0,
          });
        }

        setError(null);
        setPollError(null);
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error ? err.message : "Failed to fetch market candles";
        if (isPolling) {
          // On polling error, keep existing chart data visible but surface transient warning
          setPollError(errorMsg);
        } else {
          setError(errorMsg);
        }
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    },
    [isAuthenticated, interval, isIndex, instrument, getIndexCanonicalSymbol]
  );

  // ==================== LIGHTWEIGHT CHARTS LIFECYCLE ====================

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;

    // Create Lightweight Chart instance using v5 API
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#555555",
        attributionLogo: true, // Required by TradingView license
      },
      grid: {
        vertLines: { color: "#f0f3f8" },
        horzLines: { color: "#f0f3f8" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#e0e3eb",
      },
      timeScale: {
        borderColor: "#e0e3eb",
        timeVisible: interval !== "1d",
        secondsVisible: false,
      },
      localization: {
        locale: "en-IN",
        timeFormatter: (time: number) => formatUnixTimestampToIST(time, interval),
        priceFormatter: (price: number) => formatChartPrice(price, isIndex),
      },
    });

    if (!chart) {
      return;
    }

    // Add CandlestickSeries using official v5 API (chart.addSeries(CandlestickSeries, options))
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#f23645",
      borderVisible: false,
      wickUpColor: "#089981",
      wickDownColor: "#f23645",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => formatChartPrice(price, isIndex),
        minMove: 0.05,
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Crosshair hover legend listener
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param || !param.time || !param.seriesData || !seriesRef.current) {
        // Fall back to latest candle in cache
        const candles = lastCandlesRef.current;
        if (candles.length > 0) {
          const latest = candles[candles.length - 1];
          const diff = latest.close - latest.open;
          const pct = latest.open > 0 ? (diff / latest.open) * 100 : 0;
          setLegend({
            timeStr: formatUnixTimestampToIST(latest.time as number, interval),
            openStr: formatChartPrice(latest.open, isIndex),
            highStr: formatChartPrice(latest.high, isIndex),
            lowStr: formatChartPrice(latest.low, isIndex),
            closeStr: formatChartPrice(latest.close, isIndex),
            diffStr: (diff >= 0 ? "+" : "") + formatChartPrice(diff, isIndex),
            pctStr: (diff >= 0 ? "+" : "") + pct.toFixed(2) + "%",
            isPositive: diff > 0,
            isNegative: diff < 0,
          });
        }
        return;
      }

      const bar = param.seriesData.get(seriesRef.current) as CandlestickData<Time> | undefined;
      if (bar) {
        const diff = bar.close - bar.open;
        const pct = bar.open > 0 ? (diff / bar.open) * 100 : 0;
        setLegend({
          timeStr: formatUnixTimestampToIST(bar.time as number, interval),
          openStr: formatChartPrice(bar.open, isIndex),
          highStr: formatChartPrice(bar.high, isIndex),
          lowStr: formatChartPrice(bar.low, isIndex),
          closeStr: formatChartPrice(bar.close, isIndex),
          diffStr: (diff >= 0 ? "+" : "") + formatChartPrice(diff, isIndex),
          pctStr: (diff >= 0 ? "+" : "") + pct.toFixed(2) + "%",
          isPositive: diff > 0,
          isNegative: diff < 0,
        });
      }
    });

    // ResizeObserver for clean responsive width/height tracking
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chartRef.current) {
        return;
      }
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chartRef.current.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(container);

    // Initial fetch on mount or instrument/interval change
    fetchCandles(false);

    // 15-second background polling
    const pollTimerId = setInterval(() => {
      fetchCandles(true);
    }, CHART_POLL_INTERVAL_MS);

    // Teardown observer, polling timer, and chart instance
    return () => {
      clearInterval(pollTimerId);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [fetchCandles, interval, isIndex]);

  // Fit content helper
  const handleFitContent = () => {
    chartRef.current?.timeScale().fitContent();
  };

  return (
    <div className={`candlestick-chart-wrapper ${className}`}>
      {/* TIMEFRAME TOOLBAR & METADATA BAR */}
      <div className="chart-top-toolbar">
        <div className="toolbar-left-group">
          <span className="toolbar-label">
            <Timeline sx={{ fontSize: 18, mr: 0.5, verticalAlign: "middle" }} />
            Timeframe:
          </span>
          <div className="interval-pills" role="toolbar" aria-label="Timeframe intervals">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`interval-pill ${interval === tf ? "active" : ""}`}
                onClick={() => onIntervalChange(tf)}
                aria-label={`Timeframe ${tf}`}
                aria-pressed={interval === tf}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn-fit-chart"
            onClick={handleFitContent}
            title="Reset chart zoom and fit to window"
            aria-label="Fit Chart"
          >
            <FitScreen sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />
            Fit
          </button>
        </div>

        <div className="toolbar-right-group">
          {pollError && (
            <span
              className="transient-warning-chip"
              title={`Live candle refresh warning: ${pollError}. Showing cached data.`}
            >
              <WarningAmber sx={{ fontSize: 13 }} /> Refresh glitch
            </span>
          )}
          <span className="simulated-badge-tag">
            SIMULATED MARKET DATA — NOT LIVE EXCHANGE DATA
          </span>
        </div>
      </div>

      {/* OHLC HOVER LEGEND OVERLAY */}
      {legend && (
        <div className="chart-legend-row" aria-label="Candlestick OHLC details">
          <span className="legend-item legend-time">{legend.timeStr}</span>
          <span className="legend-item">
            O: <strong className="legend-val">{legend.openStr}</strong>
          </span>
          <span className="legend-item">
            H: <strong className="legend-val">{legend.highStr}</strong>
          </span>
          <span className="legend-item">
            L: <strong className="legend-val">{legend.lowStr}</strong>
          </span>
          <span className="legend-item">
            C: <strong className="legend-val">{legend.closeStr}</strong>
          </span>
          <span
            className={`legend-item legend-chg ${
              legend.isPositive ? "up" : legend.isNegative ? "down" : "neutral"
            }`}
          >
            {legend.diffStr} ({legend.pctStr})
          </span>
        </div>
      )}

      {/* CHART CANVAS CONTAINER */}
      <div className="chart-canvas-viewport">
        <div
          ref={containerRef}
          className="chart-canvas-node"
          data-testid="candlestick-canvas-container"
        />

        {/* LOADING OVERLAY */}
        {loading && (
          <div className="chart-status-overlay loading-overlay" data-testid="chart-loading">
            <div className="spinner-ring" />
            <p>Loading {instrument.symbol} {interval} simulated candles...</p>
          </div>
        )}

        {/* EMPTY DATA OVERLAY */}
        {!loading && isEmpty && (
          <div className="chart-status-overlay empty-overlay" data-testid="chart-empty">
            <p className="empty-title">No candle data available for this interval yet.</p>
            <p className="empty-sub">
              Wait for simulated market scheduler or select another interval.
            </p>
          </div>
        )}

        {/* ERROR OVERLAY */}
        {!loading && error && (
          <div className="chart-status-overlay error-overlay" data-testid="chart-error">
            <WarningAmber sx={{ fontSize: 32, color: "#f23645", mb: 1 }} />
            <p className="error-title">Failed to load chart data</p>
            <p className="error-message">{error}</p>
            <button
              type="button"
              className="btn-chart-retry"
              onClick={() => fetchCandles(false)}
            >
              <Refresh sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />
              Retry
            </button>
          </div>
        )}

        {/* UNAUTHENTICATED OVERLAY */}
        {!isAuthenticated && (
          <div className="chart-status-overlay unauth-overlay" data-testid="chart-unauth">
            <p className="unauth-title">Authentication Required</p>
            <p className="unauth-sub">
              Sign in to view real-time candlestick charts and simulated trading feeds.
            </p>
          </div>
        )}
      </div>

      {/* FOOTER & TRADINGVIEW ATTRIBUTION */}
      <div className="chart-footer-row">
        <div className="footer-left">
          <span className="footer-session-text">
            Session: 09:15 - 15:30 IST • 24x7 Continuous Simulation
          </span>
        </div>
        <div className="footer-right chart-tv-attribution">
          <span>
            Simulated market data by NIVORA engine. Chart rendering by{" "}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="tv-attribution-link"
            >
              TradingView Lightweight Charts™
            </a>
          </span>
        </div>
      </div>
    </div>
  );
};

export default CandlestickChart;

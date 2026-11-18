import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import { AuthProvider, useAuth } from "../../../context/AuthContext";
import { MarketApi } from "../../../api/client";
import {
  CandleInterval,
  InstrumentCandlesResult,
  MarketIndexCandlesResult,
} from "../../../api/types";
import { SelectedInstrument } from "../../../context/MarketContext";
import CandlestickChart, { CHART_POLL_INTERVAL_MS } from "../CandlestickChart";

// Mock Lightweight Charts
const mockSeries = {
  setData: jest.fn(),
  update: jest.fn(),
  applyOptions: jest.fn(),
};

const mockTimeScale = {
  fitContent: jest.fn(),
  applyOptions: jest.fn(),
};

const mockChart = {
  addSeries: jest.fn(() => mockSeries),
  removeSeries: jest.fn(),
  applyOptions: jest.fn(),
  remove: jest.fn(),
  timeScale: jest.fn(() => mockTimeScale),
  subscribeCrosshairMove: jest.fn(),
  unsubscribeCrosshairMove: jest.fn(),
};

jest.mock("lightweight-charts", () => {
  return {
    __esModule: true,
    createChart: jest.fn(() => mockChart),
    CandlestickSeries: { type: "Candlestick" },
    ColorType: { Solid: "solid" },
    CrosshairMode: { Normal: 0 },
  };
});

const mockIndexInstrument: SelectedInstrument = {
  symbol: "NIFTY 50",
  name: "NIFTY 50 Synthetic Index",
  type: "index",
  exchange: "NSE",
  indexSymbol: "NIFTY50",
};

const mockEquityInstrument: SelectedInstrument = {
  symbol: "RELIANCE",
  name: "Reliance Industries Limited",
  type: "equity",
  exchange: "NSE",
  instrumentId: "664000000000000000000010",
};

const mockIndexCandlesResponse: MarketIndexCandlesResult = {
  index: {
    _id: "idx-1",
    symbol: "NIFTY50",
    name: "NIFTY 50",
    description: "Benchmark",
    currentValue: 2412050,
    baseValue: 2400000,
    previousCloseValue: 2400000,
    changeValue: 12050,
    changeBps: 50,
    constituentCount: 50,
    methodology: "EQUAL_WEIGHTED_CONSTITUENT_BASKET",
    source: "SIMULATED",
    valueUpdatedAt: "2026-11-18T10:00:00.000Z",
  },
  interval: "1m",
  candles: [
    {
      indexId: "idx-1",
      interval: "1m",
      openTime: "2026-11-18T03:45:00.000Z",
      closeTime: "2026-11-18T03:46:00.000Z",
      openValue: 2400000,
      highValue: 2405000,
      lowValue: 2399000,
      closeValue: 2402500,
      source: "SIMULATED",
    },
    {
      indexId: "idx-1",
      interval: "1m",
      openTime: "2026-11-18T03:46:00.000Z",
      closeTime: "2026-11-18T03:47:00.000Z",
      openValue: 2402500,
      highValue: 2406000,
      lowValue: 2401000,
      closeValue: 2405000,
      source: "SIMULATED",
    },
  ],
};

const mockEquityCandlesResponse: InstrumentCandlesResult = {
  instrument: {
    _id: "664000000000000000000010",
    symbol: "RELIANCE",
    name: "Reliance Industries Limited",
    exchange: "NSE",
  },
  interval: "1m",
  candles: [
    {
      instrumentId: "664000000000000000000010",
      interval: "1m",
      openTime: "2026-11-18T03:45:00.000Z",
      closeTime: "2026-11-18T03:46:00.000Z",
      openPaise: 250000,
      highPaise: 251500,
      lowPaise: 249500,
      closePaise: 251000,
      source: "SIMULATED",
    },
  ],
};

const AuthenticatedWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { setToken, isAuthenticated } = useAuth();
  React.useEffect(() => {
    setToken("test-jwt-token");
  }, [setToken]);
  if (!isAuthenticated) {
    return null;
  }
  return <>{children}</>;
};

describe("CandlestickChart Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createChart as jest.Mock).mockReturnValue(mockChart);
    mockChart.addSeries.mockReturnValue(mockSeries);
    mockChart.timeScale.mockReturnValue(mockTimeScale);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders timeframe pills, simulated disclaimer badge, and TradingView attribution", async () => {
    jest.spyOn(MarketApi, "getIndexCandles").mockResolvedValue({
      success: true,
      data: mockIndexCandlesResponse,
    });

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    expect(
      screen.getByText("SIMULATED MARKET DATA — NOT LIVE EXCHANGE DATA")
    ).toBeInTheDocument();
    expect(screen.getByText("TradingView Lightweight Charts™")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit Chart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 1m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 5m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 15m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 1h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 1d" })).toBeInTheDocument();
  });

  test("fetches index candles with canonical symbol and initial limit (375 for 1m)", async () => {
    const getIndexCandlesSpy = jest
      .spyOn(MarketApi, "getIndexCandles")
      .mockResolvedValue({
        success: true,
        data: mockIndexCandlesResponse,
      });

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getIndexCandlesSpy).toHaveBeenCalledWith("NIFTY50", {
        interval: "1m",
        limit: 375,
      });
    });

    await waitFor(() => {
      expect(mockSeries.setData).toHaveBeenCalledWith([
        {
          time: 1794973500,
          open: 24000.0,
          high: 24050.0,
          low: 23990.0,
          close: 24025.0,
        },
        {
          time: 1794973560,
          open: 24025.0,
          high: 24060.0,
          low: 24010.0,
          close: 24050.0,
        },
      ]);
    });
  });

  test("fetches equity candles with instrumentId and initial limit (375 for 1m)", async () => {
    const getInstrumentCandlesSpy = jest
      .spyOn(MarketApi, "getInstrumentCandles")
      .mockResolvedValue({
        success: true,
        data: mockEquityCandlesResponse,
      });

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockEquityInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getInstrumentCandlesSpy).toHaveBeenCalledWith(
        "664000000000000000000010",
        {
          interval: "1m",
          limit: 375,
        }
      );
    });

    await waitFor(() => {
      expect(mockSeries.setData).toHaveBeenCalledWith([
        {
          time: 1794973500,
          open: 2500.0,
          high: 2515.0,
          low: 2495.0,
          close: 2510.0,
        },
      ]);
    });
  });

  test("triggers onIntervalChange when a timeframe button is clicked", async () => {
    jest.spyOn(MarketApi, "getIndexCandles").mockResolvedValue({
      success: true,
      data: mockIndexCandlesResponse,
    });

    const onIntervalChange = jest.fn();

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={onIntervalChange}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Timeframe 5m" }));
    });

    expect(onIntervalChange).toHaveBeenCalledWith("5m");
  });

  test("displays empty state when backend returns 0 candles", async () => {
    jest.spyOn(MarketApi, "getIndexCandles").mockResolvedValue({
      success: true,
      data: {
        index: mockIndexCandlesResponse.index,
        interval: "1m",
        candles: [],
      },
    });

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText("No candle data available for this interval yet.")
      ).toBeInTheDocument();
    });
  });

  test("displays error state and retries on clicking Retry button", async () => {
    const getIndexCandlesSpy = jest
      .spyOn(MarketApi, "getIndexCandles")
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({
        success: true,
        data: mockIndexCandlesResponse,
      });

    render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load chart data")).toBeInTheDocument();
      expect(screen.getByText("Network timeout")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => {
      expect(getIndexCandlesSpy).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Failed to load chart data")).not.toBeInTheDocument();
    });
  });

  test("cleans up chart instance on unmount", () => {
    jest.spyOn(MarketApi, "getIndexCandles").mockResolvedValue({
      success: true,
      data: mockIndexCandlesResponse,
    });

    const { unmount } = render(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    unmount();
    expect(mockChart.remove).toHaveBeenCalled();
  });
});

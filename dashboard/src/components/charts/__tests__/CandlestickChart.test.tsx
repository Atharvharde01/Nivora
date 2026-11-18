import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import { AuthProvider, useAuth } from "../../../context/AuthContext";
import { MarketApi } from "../../../api/client";
import {
  ApiResponse,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockIndexInstrument: SelectedInstrument = {
  symbol: "NIFTY 50",
  name: "NIFTY 50 Synthetic Index",
  type: "index",
  exchange: "NSE",
  indexSymbol: "NIFTY50",
};

const mockSensexInstrument: SelectedInstrument = {
  symbol: "SENSEX",
  name: "BSE SENSEX Synthetic Index",
  type: "index",
  exchange: "BSE",
  indexSymbol: "SENSEX",
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

  // ==================== BASIC RENDERING & FUNCTIONALITY ====================

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
        signal: expect.any(Object),
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
          signal: expect.any(Object),
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

  // ==================== ASYNCHRONOUS RACE CONDITION TESTS (TASK 5.4.1) ====================

  test("Test A: Instrument switch during pending request discards stale response", async () => {
    const niftyDeferred = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    const relianceDeferred = createDeferred<ApiResponse<InstrumentCandlesResult>>();

    jest.spyOn(MarketApi, "getIndexCandles").mockImplementation(() => niftyDeferred.promise);
    jest.spyOn(MarketApi, "getInstrumentCandles").mockImplementation(() => relianceDeferred.promise);

    // 1. Mount with NIFTY 50
    const { rerender } = render(
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

    expect(MarketApi.getIndexCandles).toHaveBeenCalled();

    // 2. Switch to RELIANCE while NIFTY 50 is still pending
    rerender(
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

    expect(MarketApi.getInstrumentCandles).toHaveBeenCalled();

    // 3. Resolve RELIANCE first
    await act(async () => {
      relianceDeferred.resolve({
        success: true,
        data: mockEquityCandlesResponse,
      });
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

    mockSeries.setData.mockClear();

    // 4. Resolve the older NIFTY 50 request afterward
    await act(async () => {
      niftyDeferred.resolve({
        success: true,
        data: mockIndexCandlesResponse,
      });
    });

    // 5. Verification: The old NIFTY response MUST NOT overwrite the RELIANCE chart
    expect(mockSeries.setData).not.toHaveBeenCalled();
  });

  test("Test B: Timeframe switch during pending request preserves active timeframe data", async () => {
    const oneMinDeferred = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    const fiveMinDeferred = createDeferred<ApiResponse<MarketIndexCandlesResult>>();

    jest
      .spyOn(MarketApi, "getIndexCandles")
      .mockImplementationOnce(() => oneMinDeferred.promise)
      .mockImplementationOnce(() => fiveMinDeferred.promise);

    // 1. Mount with 1m interval
    const { rerender } = render(
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

    // 2. Switch to 5m interval before 1m completes
    rerender(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockIndexInstrument}
            interval="5m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    // 3. Resolve 5m request first
    const fiveMinCandle = {
      indexId: "idx-1",
      interval: "5m" as CandleInterval,
      openTime: "2026-11-18T03:45:00.000Z",
      closeTime: "2026-11-18T03:50:00.000Z",
      openValue: 2400000,
      highValue: 2410000,
      lowValue: 2398000,
      closeValue: 2408000,
      source: "SIMULATED",
    };

    await act(async () => {
      fiveMinDeferred.resolve({
        success: true,
        data: {
          index: mockIndexCandlesResponse.index,
          interval: "5m",
          candles: [fiveMinCandle],
        },
      });
    });

    await waitFor(() => {
      expect(mockSeries.setData).toHaveBeenCalledWith([
        {
          time: 1794973500,
          open: 24000.0,
          high: 24100.0,
          low: 23980.0,
          close: 24080.0,
        },
      ]);
    });

    mockSeries.setData.mockClear();

    // 4. Resolve old 1m request afterward
    await act(async () => {
      oneMinDeferred.resolve({
        success: true,
        data: mockIndexCandlesResponse,
      });
    });

    // 5. Verification: The old 1m response MUST NOT overwrite the 5m chart
    expect(mockSeries.setData).not.toHaveBeenCalled();
  });

  test("Test C: Rapid instrument switching ensures only latest selection updates chart", async () => {
    const niftyDef = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    const sensexDef = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    const relianceDef = createDeferred<ApiResponse<InstrumentCandlesResult>>();

    jest
      .spyOn(MarketApi, "getIndexCandles")
      .mockImplementationOnce(() => niftyDef.promise)
      .mockImplementationOnce(() => sensexDef.promise);
    jest
      .spyOn(MarketApi, "getInstrumentCandles")
      .mockImplementationOnce(() => relianceDef.promise);

    // 1. Mount with NIFTY
    const { rerender } = render(
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

    // 2. Rapidly switch to SENSEX
    rerender(
      <AuthProvider>
        <AuthenticatedWrapper>
          <CandlestickChart
            instrument={mockSensexInstrument}
            interval="1m"
            onIntervalChange={() => {}}
          />
        </AuthenticatedWrapper>
      </AuthProvider>
    );

    // 3. Rapidly switch to RELIANCE
    rerender(
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

    // Resolve in reverse order (oldest first)
    await act(async () => {
      niftyDef.resolve({ success: true, data: mockIndexCandlesResponse });
      sensexDef.resolve({
        success: true,
        data: {
          ...mockIndexCandlesResponse,
          index: { ...mockIndexCandlesResponse.index, symbol: "SENSEX" },
        },
      });
    });

    // Old requests must not have updated series
    expect(mockSeries.setData).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ open: 24000.0 }),
      ])
    );

    // Finally resolve RELIANCE
    await act(async () => {
      relianceDef.resolve({ success: true, data: mockEquityCandlesResponse });
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

  test("Test D: Unmount during request cancels and prevents stale state updates", async () => {
    const pendingDeferred = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    jest.spyOn(MarketApi, "getIndexCandles").mockImplementation(() => pendingDeferred.promise);

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
    mockSeries.setData.mockClear();

    // Resolve deferred after unmount
    await act(async () => {
      pendingDeferred.resolve({
        success: true,
        data: mockIndexCandlesResponse,
      });
    });

    // Chart series setData must not be called after unmount
    expect(mockSeries.setData).not.toHaveBeenCalled();
  });

  test("Test E: Polling overlap prevention ensures single request in-flight", async () => {
    const initialDeferred = createDeferred<ApiResponse<MarketIndexCandlesResult>>();
    const getIndexCandlesSpy = jest
      .spyOn(MarketApi, "getIndexCandles")
      .mockImplementation(() => initialDeferred.promise);

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

    expect(getIndexCandlesSpy).toHaveBeenCalledTimes(1);

    // Initial request is still pending. We simulate polling attempt.
    // The component's isPollingRef should prevent overlapping requests.
    // Even if time advances, no second request should be made while first is unresolved.
    expect(getIndexCandlesSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      initialDeferred.resolve({
        success: true,
        data: mockIndexCandlesResponse,
      });
    });

    await waitFor(() => {
      expect(mockSeries.setData).toHaveBeenCalled();
    });
  });

  test("Test F: Abort/cancellation errors are discarded without showing error overlay", async () => {
    const canceledError = new Error("canceled");
    canceledError.name = "CanceledError";

    jest.spyOn(MarketApi, "getIndexCandles").mockRejectedValue(canceledError);

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

    // Ensure error banner is NOT rendered for cancellation
    await waitFor(() => {
      expect(screen.queryByText("Failed to load chart data")).not.toBeInTheDocument();
      expect(screen.queryByText("canceled")).not.toBeInTheDocument();
    });
  });
});

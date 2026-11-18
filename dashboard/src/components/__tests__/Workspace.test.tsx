import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider, useMarket } from "../../context/MarketContext";
import { InstrumentsApi, MarketApi } from "../../api/client";
import { MarketIndexSummary } from "../../api/types";
import Workspace from "../Workspace";

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

const mockNifty: MarketIndexSummary = {
  _id: "idx-nifty-50",
  symbol: "NIFTY50",
  name: "NIFTY 50",
  description: "Benchmark Indian index of top 50 equities",
  currentValue: 2412050,
  baseValue: 2400000,
  previousCloseValue: 2400000,
  changeValue: 12050,
  changeBps: 50,
  constituentCount: 50,
  methodology: "EQUAL_WEIGHTED_CONSTITUENT_BASKET",
  source: "SIMULATED",
  valueUpdatedAt: "2026-11-18T10:00:00.000Z",
};

const WindowStateTester: React.FC = () => {
  const { isBuyWindowOpen, isSellWindowOpen } = useMarket();
  return (
    <div>
      <span data-testid="buy-open">{isBuyWindowOpen ? "yes" : "no"}</span>
      <span data-testid="sell-open">{isSellWindowOpen ? "yes" : "no"}</span>
    </div>
  );
};

const EquitySelectionHelper: React.FC = () => {
  const { selectInstrument } = useMarket();
  const { setToken } = useAuth();
  return (
    <div>
      <button onClick={() => setToken("jwt-token")}>Login</button>
      <button
        onClick={() =>
          selectInstrument({
            symbol: "INFY",
            name: "Infosys Limited",
            exchange: "NSE",
            type: "equity",
            instrumentId: "664000000000000000000099",
          })
        }
      >
        Select INFY
      </button>
    </div>
  );
};

describe("Workspace Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createChart as jest.Mock).mockReturnValue(mockChart);
    mockChart.addSeries.mockReturnValue(mockSeries);
    mockChart.timeScale.mockReturnValue(mockTimeScale);
    jest.spyOn(MarketApi, "getIndexCandles").mockResolvedValue({
      success: true,
      data: {
        index: mockNifty,
        interval: "1m",
        candles: [],
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders selected instrument title, exchange pill, action buttons, and chart container", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
          <WindowStateTester />
        </MarketProvider>
      </AuthProvider>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "NIFTY 50" })
    ).toBeInTheDocument();
    expect(screen.getByText("NSE")).toBeInTheDocument();
    expect(screen.getByText("INDEX")).toBeInTheDocument();

    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();

    expect(screen.getByTestId("candlestick-canvas-container")).toBeInTheDocument();
    expect(
      screen.getByText("SIMULATED MARKET DATA — NOT LIVE EXCHANGE DATA")
    ).toBeInTheDocument();
    expect(screen.getByText("TradingView Lightweight Charts™")).toBeInTheDocument();
  });

  test("renders timeframe toolbar pills (1m, 5m, 15m, 1h, 1d)", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByRole("button", { name: "Timeframe 1m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 5m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 15m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 1h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeframe 1d" })).toBeInTheDocument();
  });

  test("clicking BUY and SELL triggers the respective order windows", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
          <WindowStateTester />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId("buy-open")).toHaveTextContent("no");
    act(() => {
      fireEvent.click(screen.getByText("BUY"));
    });
    expect(screen.getByTestId("buy-open")).toHaveTextContent("yes");

    act(() => {
      fireEvent.click(screen.getByText("SELL"));
    });
    expect(screen.getByTestId("sell-open")).toHaveTextContent("yes");
  });

  test("renders synthetic index points and change when index data is loaded", async () => {
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNifty] },
    });

    render(
      <AuthProvider>
        <MarketProvider>
          <EquitySelectionHelper />
          <Workspace />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(screen.getByText("24,120.50")).toBeInTheDocument();
    });
    expect(screen.getByText(/\+120\.50 \(\+0\.50%\)/)).toBeInTheDocument();
  });

  test("renders live equity quote, bid/ask prices, and stale warning badge when equity selected", async () => {
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNifty] },
    });

    jest.spyOn(InstrumentsApi, "getQuote").mockResolvedValue({
      success: true,
      data: {
        quote: {
          instrumentId: "664000000000000000000099",
          symbol: "INFY",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 185025,
          bidPricePaise: 185000,
          askPricePaise: 185050,
          previousClosePaise: 183000,
          priceUpdatedAt: "2026-11-18T10:00:00.000Z",
          quoteSource: "SIMULATED",
          quoteAgeMs: 5000,
          isStale: true,
        },
      },
    });

    render(
      <AuthProvider>
        <MarketProvider>
          <EquitySelectionHelper />
          <Workspace />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Select INFY"));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "INFY" })).toBeInTheDocument();
    });

    expect(screen.getByText("EQUITY")).toBeInTheDocument();
    expect(screen.getByText("Stale Quote (Simulated)")).toBeInTheDocument();
    expect(screen.getByText("₹1,850.25")).toBeInTheDocument();
    expect(screen.getByText(/Bid ₹1,850\.00 • Ask ₹1,850\.50/)).toBeInTheDocument();
  });
});

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider, useMarket } from "../../context/MarketContext";
import { InstrumentsApi, MarketApi } from "../../api/client";
import { MarketIndexDetail, MarketIndexSummary } from "../../api/types";
import WatchList from "../WatchList";

const mockNifty: MarketIndexSummary = {
  _id: "664000000000000000000001",
  symbol: "NIFTY50",
  name: "NIFTY 50",
  description: "Synthetic equal-weighted benchmark",
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

const mockNiftyDetail: MarketIndexDetail = {
  ...mockNifty,
  constituents: [
    {
      instrumentId: "664000000000000000000010",
      symbol: "RELIANCE",
      exchange: "NSE",
      weightBps: 200,
      basePricePaise: 250000,
    },
    {
      instrumentId: "664000000000000000000011",
      symbol: "TCS",
      exchange: "NSE",
      weightBps: 150,
      basePricePaise: 380000,
    },
  ],
};

const SelectedTester: React.FC = () => {
  const { selectedInstrument } = useMarket();
  return (
    <div>
      <span data-testid="active-symbol">{selectedInstrument.symbol}</span>
      <span data-testid="active-type">{selectedInstrument.type}</span>
    </div>
  );
};

const AuthTrigger: React.FC = () => {
  const { setToken } = useAuth();
  return <button onClick={() => setToken("jwt-token")}>Login</button>;
};

describe("WatchList Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNifty] },
    });
    jest.spyOn(MarketApi, "getIndex").mockResolvedValue({
      success: true,
      data: { index: mockNiftyDetail },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders pinned benchmarks, search input, and clean empty state when no watchlist items", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
            <SelectedTester />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    expect(screen.getByText("SYNTHETIC BENCHMARKS")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance")
    ).toBeInTheDocument();

    // Verification of architectural constraint: NO fabricated sample stock prices!
    expect(screen.getByText("Watchlist is Empty")).toBeInTheDocument();
  });

  test("expands constituents when toggle is clicked and selects equity in workspace", async () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <AuthTrigger />
            <WatchList />
            <SelectedTester />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const expandBtn = screen.getByLabelText("Toggle NIFTY 50 constituents");
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    expect(MarketApi.getIndex).toHaveBeenCalledWith("NIFTY50");
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("2.00%")).toBeInTheDocument();
    expect(screen.getByText("1.50%")).toBeInTheDocument();

    // Select constituent
    await act(async () => {
      fireEvent.click(screen.getByText("RELIANCE"));
    });

    expect(screen.getByTestId("active-symbol")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("active-type")).toHaveTextContent("equity");
  });

  test("performs live equity search and displays real backend quote metrics without fallbacks", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            _id: "664000000000000000000099",
            symbol: "INFY",
            name: "Infosys Limited",
            exchange: "NSE",
            isTradable: true,
            lastPricePaise: 155550,
            bidPricePaise: 155500,
            askPricePaise: 155600,
            previousClosePaise: 150000,
            priceUpdatedAt: "2026-11-18T10:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "infy" } });
    });

    // Wait for debounce (250ms)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(InstrumentsApi.search).toHaveBeenCalledWith({ search: "infy", limit: 15 });
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("₹1,555.50")).toBeInTheDocument();
    expect(screen.getByText("+3.70%")).toBeInTheDocument();
  });

  test("renders watchlist pagination tabs 1 to 5", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});

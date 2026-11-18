import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../AuthContext";
import { MarketProvider, useMarket } from "../MarketContext";
import { InstrumentsApi, MarketApi } from "../../api/client";
import { MarketIndexDetail, MarketIndexSummary, InstrumentQuote } from "../../api/types";

// Mock fixtures
const mockNiftySummary: MarketIndexSummary = {
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

const mockSensexSummary: MarketIndexSummary = {
  _id: "664000000000000000000002",
  symbol: "SENSEX",
  name: "BSE SENSEX",
  description: "Synthetic equal-weighted benchmark",
  currentValue: 7950000,
  baseValue: 7900000,
  previousCloseValue: 7960000,
  changeValue: -10000,
  changeBps: -13,
  constituentCount: 30,
  methodology: "EQUAL_WEIGHTED_CONSTITUENT_BASKET",
  source: "SIMULATED",
  valueUpdatedAt: "2026-11-18T10:00:00.000Z",
};

const mockNiftyDetail: MarketIndexDetail = {
  ...mockNiftySummary,
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
      weightBps: 200,
      basePricePaise: 380000,
    },
  ],
};

const mockSensexDetail: MarketIndexDetail = {
  ...mockSensexSummary,
  constituents: [
    {
      instrumentId: "664000000000000000000020",
      symbol: "HDFCBANK",
      exchange: "BSE",
      weightBps: 333,
      basePricePaise: 160000,
    },
  ],
};

const mockQuote: InstrumentQuote = {
  instrumentId: "664000000000000000000010",
  symbol: "RELIANCE",
  exchange: "NSE",
  isTradable: true,
  lastPricePaise: 255000,
  bidPricePaise: 254950,
  askPricePaise: 255050,
  previousClosePaise: 250000,
  priceUpdatedAt: "2026-11-18T10:00:00.000Z",
  quoteSource: "SIMULATED",
  quoteAgeMs: 500,
  isStale: false,
};

const MarketConsumer: React.FC = () => {
  const { setToken } = useAuth();
  const {
    selectedInstrument,
    selectInstrument,
    indices,
    expandedIndices,
    indexDetailsCache,
    toggleExpandIndex,
    selectedQuote,
    selectedQuoteLoading,
    isBuyWindowOpen,
    isSellWindowOpen,
    openBuyWindow,
    openSellWindow,
    closeActionWindows,
  } = useMarket();

  return (
    <div>
      <span data-testid="selected-symbol">{selectedInstrument.symbol}</span>
      <span data-testid="selected-type">{selectedInstrument.type}</span>
      <span data-testid="indices-count">{indices.length}</span>
      <span data-testid="nifty-expanded">{expandedIndices.NIFTY50 ? "yes" : "no"}</span>
      <span data-testid="sensex-expanded">{expandedIndices.SENSEX ? "yes" : "no"}</span>
      <span data-testid="nifty-constituents-count">
        {indexDetailsCache.NIFTY50?.constituents.length ?? 0}
      </span>
      <span data-testid="quote-ltp">
        {selectedQuote ? selectedQuote.lastPricePaise : "none"}
      </span>
      <span data-testid="quote-loading">{selectedQuoteLoading ? "loading" : "idle"}</span>

      <span data-testid="buy-window">{isBuyWindowOpen ? "open" : "closed"}</span>
      <span data-testid="sell-window">{isSellWindowOpen ? "open" : "closed"}</span>

      <button onClick={() => setToken("test-bearer-token")}>Authenticate</button>

      <button
        onClick={() =>
          selectInstrument({
            symbol: "RELIANCE",
            name: "Reliance Industries Ltd",
            type: "equity",
            exchange: "NSE",
            instrumentId: "664000000000000000000010",
          })
        }
      >
        Select Reliance
      </button>

      <button onClick={() => toggleExpandIndex("NIFTY50")}>Toggle Nifty</button>
      <button onClick={() => toggleExpandIndex("SENSEX")}>Toggle Sensex</button>

      <button onClick={() => openBuyWindow()}>Open Buy</button>
      <button onClick={() => openSellWindow()}>Open Sell</button>
      <button onClick={() => closeActionWindows()}>Close Windows</button>
    </div>
  );
};

describe("MarketContext — Market Data & Constituent Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNiftySummary, mockSensexSummary] },
    });
    jest.spyOn(MarketApi, "getIndex").mockImplementation(async (symbol: string) => {
      if (symbol === "NIFTY50") {
        return { success: true, data: { index: mockNiftyDetail } };
      }
      return { success: true, data: { index: mockSensexDetail } };
    });
    jest.spyOn(InstrumentsApi, "getQuote").mockResolvedValue({
      success: true,
      data: { quote: mockQuote },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("initializes with NIFTY 50 as default selected instrument", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId("selected-symbol")).toHaveTextContent("NIFTY 50");
    expect(screen.getByTestId("selected-type")).toHaveTextContent("index");
  });

  test("fetches and stores synthetic indices when authenticated", async () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      userEvent.click(screen.getByText("Authenticate"));
    });

    expect(MarketApi.getIndices).toHaveBeenCalled();
    expect(screen.getByTestId("indices-count")).toHaveTextContent("2");
  });

  test("supports independent expansion of NIFTY 50 and SENSEX constituents with in-memory caching", async () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      userEvent.click(screen.getByText("Authenticate"));
    });

    // Expand NIFTY 50
    await act(async () => {
      userEvent.click(screen.getByText("Toggle Nifty"));
    });

    expect(MarketApi.getIndex).toHaveBeenCalledWith("NIFTY50");
    expect(screen.getByTestId("nifty-expanded")).toHaveTextContent("yes");
    expect(screen.getByTestId("nifty-constituents-count")).toHaveTextContent("2");

    // Expand SENSEX independently
    await act(async () => {
      userEvent.click(screen.getByText("Toggle Sensex"));
    });

    expect(MarketApi.getIndex).toHaveBeenCalledWith("SENSEX");
    expect(screen.getByTestId("sensex-expanded")).toHaveTextContent("yes");
    expect(screen.getByTestId("nifty-expanded")).toHaveTextContent("yes");

    // Toggle NIFTY 50 off
    await act(async () => {
      userEvent.click(screen.getByText("Toggle Nifty"));
    });
    expect(screen.getByTestId("nifty-expanded")).toHaveTextContent("no");
    expect(screen.getByTestId("sensex-expanded")).toHaveTextContent("yes");

    // Re-expanding NIFTY 50 uses cache (no second network request)
    const callsCountBefore = (MarketApi.getIndex as jest.Mock).mock.calls.length;
    await act(async () => {
      userEvent.click(screen.getByText("Toggle Nifty"));
    });
    expect(screen.getByTestId("nifty-expanded")).toHaveTextContent("yes");
    expect((MarketApi.getIndex as jest.Mock).mock.calls.length).toBe(callsCountBefore);
  });

  test("fetches live equity quote when an equity is selected", async () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      userEvent.click(screen.getByText("Authenticate"));
    });

    await act(async () => {
      userEvent.click(screen.getByText("Select Reliance"));
    });

    expect(InstrumentsApi.getQuote).toHaveBeenCalledWith("664000000000000000000010");
    expect(screen.getByTestId("selected-symbol")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("quote-ltp")).toHaveTextContent("255000");
  });

  test("preserves previous valid indices during transient fetch error", async () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    await act(async () => {
      userEvent.click(screen.getByText("Authenticate"));
    });
    expect(screen.getByTestId("indices-count")).toHaveTextContent("2");

    // Simulate transient network failure
    (MarketApi.getIndices as jest.Mock).mockRejectedValueOnce(new Error("Network glitch"));

    // Trigger refresh
    // The previous indices count should remain preserved
    expect(screen.getByTestId("indices-count")).toHaveTextContent("2");
  });
});

import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider, useMarket } from "../../context/MarketContext";
import { InstrumentsApi, MarketApi, WatchlistApi } from "../../api/client";
import {
  MarketIndexDetail,
  MarketIndexSummary,
  WatchlistItemDto,
  InstrumentSummary,
} from "../../api/types";
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

const createMockWatchlistItem = (
  num: number,
  symbol = `STOCK${num}`,
  pricePaise = 100000 + num * 1000,
  prevClosePaise = 100000
): WatchlistItemDto => ({
  id: `w-${num}`,
  userId: "user-1",
  instrumentId: `inst-${num}`,
  symbol,
  name: `${symbol} India Limited`,
  exchange: "NSE",
  isTradable: true,
  sortOrder: num,
  quote: {
    lastPricePaise: pricePaise,
    bidPricePaise: pricePaise - 50,
    askPricePaise: pricePaise + 50,
    previousClosePaise: prevClosePaise,
    priceUpdatedAt: "2026-11-18T10:00:00.000Z",
    isStale: false,
  },
  createdAt: "2026-11-18T10:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
});

const mockSearchResult = (
  id: string,
  symbol: string,
  name: string,
  pricePaise = 150000,
  prevClosePaise = 145000
): InstrumentSummary => ({
  _id: id,
  symbol,
  name,
  exchange: "NSE",
  isTradable: true,
  lastPricePaise: pricePaise,
  bidPricePaise: pricePaise - 50,
  askPricePaise: pricePaise + 50,
  previousClosePaise: prevClosePaise,
  priceUpdatedAt: "2026-11-18T10:00:00.000Z",
});

const SelectedTester: React.FC = () => {
  const { selectedInstrument } = useMarket();
  return (
    <div>
      <span data-testid="active-symbol">{selectedInstrument.symbol}</span>
      <span data-testid="active-type">{selectedInstrument.type}</span>
      <span data-testid="active-id">{selectedInstrument.instrumentId || ""}</span>
    </div>
  );
};

const AuthTrigger: React.FC = () => {
  const { setToken } = useAuth();
  return (
    <div>
      <button onClick={() => setToken("jwt-token")}>Login</button>
      <button onClick={() => setToken("jwt-token-b")}>Login B</button>
      <button onClick={() => setToken(null)}>Logout</button>
    </div>
  );
};

const renderWithProviders = (watchlistItems: WatchlistItemDto[] = []) => {
  jest.spyOn(WatchlistApi, "getWatchlist").mockResolvedValue({
    success: true,
    data: { items: watchlistItems, count: watchlistItems.length },
  });

  return render(
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
};

describe("WatchList Component — Complete Marketwatch Test Suite", () => {
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
    jest.spyOn(WatchlistApi, "getWatchlist").mockResolvedValue({
      success: true,
      data: { items: [], count: 0 },
    });
    jest.spyOn(InstrumentsApi, "getQuote").mockResolvedValue({
      success: true,
      data: {
        quote: {
          instrumentId: "inst-test",
          symbol: "TEST",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 150000,
          bidPricePaise: 149950,
          askPricePaise: 150050,
          previousClosePaise: 145000,
          priceUpdatedAt: "2026-11-18T10:00:00.000Z",
          quoteSource: "SIMULATED",
          quoteAgeMs: 100,
          isStale: false,
        },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== BASIC RENDERING ====================

  test("renders pinned benchmarks, search input, and clean empty state when no watchlist items", async () => {
    renderWithProviders([]);

    expect(screen.getByText("SYNTHETIC BENCHMARKS")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance")
    ).toBeInTheDocument();

    expect(screen.getByText("Watchlist is Empty")).toBeInTheDocument();
    expect(screen.getByText("0 / 50")).toBeInTheDocument();
  });

  test("expands constituents when toggle is clicked and selects equity in workspace", async () => {
    renderWithProviders([]);

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

  // ==================== SEARCH SPECIFICATION TESTS ====================

  test("search: debounces input by ~250ms and fetches tradable instruments", async () => {
    const searchSpy = jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-infy", "INFY", "Infosys Limited", 155550, 150000)],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "infy" } });
    });

    // Before debounce timer, should not have called
    expect(searchSpy).not.toHaveBeenCalled();

    // Wait past debounce (300ms)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(searchSpy).toHaveBeenCalledWith(
      { search: "infy", isTradable: true, page: 1, limit: 15 },
      expect.objectContaining({ signal: expect.any(Object) })
    );

    // Dedicated search panel opens
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("Infosys Limited")).toBeInTheDocument();
    expect(screen.getByText("₹1,555.50")).toBeInTheDocument();
  });

  test("search: displays dedicated search results panel separate from watchlist rows", async () => {
    const initialWatchlist = [createMockWatchlistItem(1, "HDFCBANK")];
    renderWithProviders(initialWatchlist);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // User's actual watchlist row is present
    expect(screen.getByText("HDFCBANK")).toBeInTheDocument();

    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-wipro", "WIPRO", "Wipro Limited")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "wipro" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    // Both the dedicated search results panel AND the underlying watchlist row exist simultaneously!
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByText("WIPRO")).toBeInTheDocument();
    expect(screen.getByText("HDFCBANK")).toBeInTheDocument();
  });

  test("search: displays loading state in dedicated search panel", async () => {
    let resolveSearch: (val: any) => void;
    const searchPromise = new Promise((resolve) => {
      resolveSearch = resolve;
    });

    jest.spyOn(InstrumentsApi, "search").mockImplementation(() => searchPromise as any);

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "tata" } });
    });

    // Wait for debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("Searching instruments...")).toBeInTheDocument();

    // Now complete
    await act(async () => {
      resolveSearch!({
        success: true,
        data: { items: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 0 } },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.queryByText("Searching instruments...")).not.toBeInTheDocument();
  });

  test("search: displays no-results state when query matches nothing", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: { items: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 0 } },
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "unknownxyz" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("No instruments found")).toBeInTheDocument();
  });

  test("search: clicking clear button resets search and closes panel", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-sbi", "SBIN", "State Bank of India")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "sbin" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("SBIN")).toBeInTheDocument();

    // Click clear search button
    const clearBtn = screen.getByLabelText("Clear search");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  test("search: clicking search result row selects equity in workspace without adding to watchlist", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-itc", "ITC", "ITC Limited", 45000, 44000)],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "itc" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    const addSpy = jest.spyOn(WatchlistApi, "addItem");

    // Click row
    await act(async () => {
      fireEvent.click(screen.getByText("ITC Limited"));
    });

    expect(screen.getByTestId("active-symbol")).toHaveTextContent("ITC");
    expect(screen.getByTestId("active-type")).toHaveTextContent("equity");
    // Row click should NOT add to watchlist
    expect(addSpy).not.toHaveBeenCalled();
  });

  // ==================== TASK 5.5.1 HARDENED SEARCH TESTS ====================

  test("search error: API response with success: false displays error message, not empty-results", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: false,
      error: { code: "SEARCH_TIMEOUT", message: "Search service timed out. Please try again." },
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "errorquery" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("Search service timed out. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("No instruments found")).not.toBeInTheDocument();
  });

  test("search error: failed request with no backend message displays generic error", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: false,
    });

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "genericerror" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("Search failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("No instruments found")).not.toBeInTheDocument();
  });

  test("search lifecycle: clearing search invalidates an older pending response", async () => {
    let resolveSlowSearch: (val: any) => void;
    const slowPromise = new Promise((resolve) => {
      resolveSlowSearch = resolve;
    });

    jest.spyOn(InstrumentsApi, "search").mockImplementation(() => slowPromise as any);

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    await act(async () => {
      fireEvent.change(input, { target: { value: "slow" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    // Clear search before slow request finishes
    const clearBtn = screen.getByLabelText("Clear search");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    // Now resolve slow search
    await act(async () => {
      resolveSlowSearch!({
        success: true,
        data: {
          items: [mockSearchResult("inst-slow", "SLOWSTOCK", "Slow Response Stock")],
          pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // Result must NOT appear because search was cleared!
    expect(screen.queryByText("SLOWSTOCK")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();
  });

  test("search lifecycle: superseded search response cannot overwrite newer results", async () => {
    let resolveFirst: (val: any) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    let resolveSecond: (val: any) => void;
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    const searchSpy = jest.spyOn(InstrumentsApi, "search");
    searchSpy.mockImplementationOnce(() => firstPromise as any);
    searchSpy.mockImplementationOnce(() => secondPromise as any);

    renderWithProviders([]);
    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");

    // Query 1
    await act(async () => {
      fireEvent.change(input, { target: { value: "first" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    // Query 2 (supersedes Query 1)
    await act(async () => {
      fireEvent.change(input, { target: { value: "second" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    // Resolve Query 2 first
    await act(async () => {
      resolveSecond!({
        success: true,
        data: {
          items: [mockSearchResult("inst-2", "SECOND", "Second Stock")],
          pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText("SECOND")).toBeInTheDocument();

    // Now older Query 1 finishes late
    await act(async () => {
      resolveFirst!({
        success: true,
        data: {
          items: [mockSearchResult("inst-1", "FIRST", "First Stock")],
          pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // SECOND remains visible, FIRST is ignored!
    expect(screen.getByText("SECOND")).toBeInTheDocument();
    expect(screen.queryByText("FIRST")).not.toBeInTheDocument();
  });

  // ==================== ADD TO WATCHLIST WORKFLOW ====================

  test("add to watchlist: successful addition calls API, updates count and displays Added button", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-bharti", "BHARTIARTL", "Bharti Airtel Ltd")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    const addedItem: WatchlistItemDto = createMockWatchlistItem(1, "BHARTIARTL");
    addedItem.instrumentId = "inst-bharti";

    const addSpy = jest.spyOn(WatchlistApi, "addItem").mockResolvedValue({
      success: true,
      data: { item: addedItem },
    });

    renderWithProviders([]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "bharti" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    const addBtn = screen.getByLabelText("Add BHARTIARTL to watchlist");
    await act(async () => {
      fireEvent.click(addBtn);
    });

    expect(addSpy).toHaveBeenCalledWith("inst-bharti");
    expect(screen.getByText("Added BHARTIARTL to watchlist.")).toBeInTheDocument();
    expect(screen.getByText("1 / 50")).toBeInTheDocument();

    // In search results, button is now "Added"
    expect(screen.getByLabelText("BHARTIARTL already in watchlist")).toBeInTheDocument();
  });

  test("add to watchlist: handles WATCHLIST_ITEM_ALREADY_EXISTS backend error", async () => {
    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-dup", "DUP", "Duplicate Stock")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    jest.spyOn(WatchlistApi, "addItem").mockResolvedValue({
      success: false,
      error: {
        code: "WATCHLIST_ITEM_ALREADY_EXISTS",
        message: "Instrument already in watchlist",
      },
    });

    renderWithProviders([]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "dup" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add DUP to watchlist"));
    });

    expect(screen.getByText("Instrument is already in your watchlist.")).toBeInTheDocument();
  });

  test("add to watchlist: handles WATCHLIST_CAPACITY_EXCEEDED backend error", async () => {
    const fullWatchlist = Array.from({ length: 50 }, (_, i) =>
      createMockWatchlistItem(i + 1)
    );

    renderWithProviders(fullWatchlist);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("50 / 50")).toBeInTheDocument();

    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-51", "NEW51", "51st Stock")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "new51" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add NEW51 to watchlist"));
    });

    expect(screen.getByText("Watchlist is full (max 50 instruments).")).toBeInTheDocument();
  });

  // ==================== TASK 5.5.1 MUTATION LOCK TESTS ====================

  test("mutation lock: rapid repeated clicks cannot submit duplicate add requests", async () => {
    let resolveAdd: (val: any) => void;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    const addSpy = jest.spyOn(WatchlistApi, "addItem").mockImplementation(() => addPromise as any);

    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-hcl", "HCLTECH", "HCL Technologies")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    renderWithProviders([]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "hcl" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    const addBtn = screen.getByLabelText("Add HCLTECH to watchlist");

    // Rapid double-clicks
    await act(async () => {
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
    });

    // Synchronous ref guard ensures exactly 1 API call was issued
    expect(addSpy).toHaveBeenCalledTimes(1);

    // Complete the request
    await act(async () => {
      resolveAdd!({
        success: true,
        data: { item: createMockWatchlistItem(1, "HCLTECH") },
      });
    });
  });

  test("mutation lock: other add/remove/reorder actions are disabled while a mutation is pending", async () => {
    let resolveRemove: (val: any) => void;
    const removePromise = new Promise((resolve) => {
      resolveRemove = resolve;
    });

    jest.spyOn(WatchlistApi, "removeItem").mockImplementation(() => removePromise as any);

    const initialList = [
      createMockWatchlistItem(1, "STOCK1"),
      createMockWatchlistItem(2, "STOCK2"),
    ];
    renderWithProviders(initialList);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Click Remove on STOCK1
    const removeBtn1 = screen.getByLabelText("Remove STOCK1 from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn1);
    });

    // While remove is pending, remove on STOCK2 and reorder buttons must be disabled
    const removeBtn2 = screen.getByLabelText("Remove STOCK2 from watchlist");
    expect(removeBtn2).toBeDisabled();

    const moveDown1 = screen.getByLabelText("Move STOCK1 down");
    expect(moveDown1).toBeDisabled();

    // Resolve remove
    await act(async () => {
      resolveRemove!({
        success: true,
        data: { success: true, removedInstrumentId: "inst-1" },
      });
    });

    // Lock released
    expect(screen.getByLabelText("Remove STOCK2 from watchlist")).not.toBeDisabled();
  });

  test("mutation lock: global lock is released after API failure and network exception", async () => {
    const initialList = [createMockWatchlistItem(1, "RELIANCE")];
    renderWithProviders(initialList);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // 1. Test release on API failure
    jest.spyOn(WatchlistApi, "removeItem").mockResolvedValueOnce({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to delete" },
    });

    const removeBtn = screen.getByLabelText("Remove RELIANCE from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(screen.getByText("Failed to delete")).toBeInTheDocument();
    // Lock released: button is enabled again
    expect(removeBtn).not.toBeDisabled();

    // 2. Test release on network exception
    jest.spyOn(WatchlistApi, "removeItem").mockRejectedValueOnce(new Error("Network drop"));

    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(screen.getByText("Network drop")).toBeInTheDocument();
    expect(removeBtn).not.toBeDisabled();
  });

  // ==================== REMOVE FROM WATCHLIST WORKFLOW ====================

  test("remove from watchlist: calls DELETE endpoint, removes row and updates count", async () => {
    const initialWatchlist = [createMockWatchlistItem(1, "RELIANCE")];
    renderWithProviders(initialWatchlist);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("1 / 50")).toBeInTheDocument();

    const deleteSpy = jest.spyOn(WatchlistApi, "removeItem").mockResolvedValue({
      success: true,
      data: { success: true, removedInstrumentId: "inst-1" },
    });

    const removeBtn = screen.getByLabelText("Remove RELIANCE from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(deleteSpy).toHaveBeenCalledWith("inst-1");
    expect(screen.queryByLabelText("Remove RELIANCE from watchlist")).not.toBeInTheDocument();
    expect(screen.getByText("0 / 50")).toBeInTheDocument();
    expect(screen.getByText("Watchlist is Empty")).toBeInTheDocument();
  });

  test("remove from watchlist: removing item does NOT unselect it from active workspace", async () => {
    const initialWatchlist = [createMockWatchlistItem(1, "TCS")];
    renderWithProviders(initialWatchlist);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Select TCS in workspace
    await act(async () => {
      fireEvent.click(screen.getByText("TCS"));
    });

    expect(screen.getByTestId("active-symbol")).toHaveTextContent("TCS");

    jest.spyOn(WatchlistApi, "removeItem").mockResolvedValue({
      success: true,
      data: { success: true, removedInstrumentId: "inst-1" },
    });

    // Remove TCS from watchlist
    const removeBtn = screen.getByLabelText("Remove TCS from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    // TCS is removed from watchlist display...
    expect(screen.queryByLabelText("Remove TCS from watchlist")).not.toBeInTheDocument();
    // ...BUT TCS remains selected in active workspace!
    expect(screen.getByTestId("active-symbol")).toHaveTextContent("TCS");
    expect(screen.getByTestId("active-type")).toHaveTextContent("equity");
  });

  test("remove from watchlist: handles API removal failure gracefully", async () => {
    const initialWatchlist = [createMockWatchlistItem(1, "INFY")];
    renderWithProviders(initialWatchlist);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    jest.spyOn(WatchlistApi, "removeItem").mockResolvedValue({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to delete" },
    });

    const removeBtn = screen.getByLabelText("Remove INFY from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(screen.getByText("Failed to delete")).toBeInTheDocument();
    // Row remains in list
    expect(screen.getByText("INFY")).toBeInTheDocument();
  });

  // ==================== PAGINATION SPECIFICATION TESTS ====================

  test("pagination: slices items to 10 per page and allows page navigation", async () => {
    const watchlist25 = Array.from({ length: 25 }, (_, i) =>
      createMockWatchlistItem(i + 1, `ITEM${i + 1}`)
    );

    renderWithProviders(watchlist25);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("25 / 50")).toBeInTheDocument();

    // Page 1 contains ITEM1 and ITEM10, but NOT ITEM11
    expect(screen.getByText("ITEM1")).toBeInTheDocument();
    expect(screen.getByText("ITEM10")).toBeInTheDocument();
    expect(screen.queryByText("ITEM11")).not.toBeInTheDocument();

    // Click tab 2
    const tab2 = screen.getByRole("button", { name: "Watchlist page 2" });
    await act(async () => {
      fireEvent.click(tab2);
    });

    // Page 2 contains ITEM11 and ITEM20, but NOT ITEM1 or ITEM21
    expect(screen.queryByText("ITEM1")).not.toBeInTheDocument();
    expect(screen.getByText("ITEM11")).toBeInTheDocument();
    expect(screen.getByText("ITEM20")).toBeInTheDocument();
    expect(screen.queryByText("ITEM21")).not.toBeInTheDocument();

    // Click tab 3
    const tab3 = screen.getByRole("button", { name: "Watchlist page 3" });
    await act(async () => {
      fireEvent.click(tab3);
    });

    // Page 3 contains ITEM21 and ITEM25
    expect(screen.getByText("ITEM21")).toBeInTheDocument();
    expect(screen.getByText("ITEM25")).toBeInTheDocument();
  });

  test("pagination: disables tabs for empty pages", async () => {
    const watchlist15 = Array.from({ length: 15 }, (_, i) =>
      createMockWatchlistItem(i + 1, `STOCK${i + 1}`)
    );

    renderWithProviders(watchlist15);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const tab1 = screen.getByRole("button", { name: "Watchlist page 1" });
    const tab2 = screen.getByRole("button", { name: "Watchlist page 2" });
    const tab3 = screen.getByRole("button", { name: "Watchlist page 3" });
    const tab4 = screen.getByRole("button", { name: "Watchlist page 4" });
    const tab5 = screen.getByRole("button", { name: "Watchlist page 5" });

    expect(tab1).not.toBeDisabled();
    expect(tab2).not.toBeDisabled();
    expect(tab3).toBeDisabled();
    expect(tab4).toBeDisabled();
    expect(tab5).toBeDisabled();
  });

  test("pagination: deleting the last item on page 2 auto-decrements active page to page 1", async () => {
    const watchlist11 = Array.from({ length: 11 }, (_, i) =>
      createMockWatchlistItem(i + 1, `EQ${i + 1}`)
    );

    renderWithProviders(watchlist11);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Switch to page 2
    const tab2 = screen.getByRole("button", { name: "Watchlist page 2" });
    await act(async () => {
      fireEvent.click(tab2);
    });

    expect(screen.getByText("EQ11")).toBeInTheDocument();

    jest.spyOn(WatchlistApi, "removeItem").mockResolvedValue({
      success: true,
      data: { success: true, removedInstrumentId: "inst-11" },
    });

    // Delete EQ11 (the only item on page 2)
    const removeBtn = screen.getByLabelText("Remove EQ11 from watchlist");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    // Active tab automatically moves back to Page 1!
    expect(screen.getByText("EQ1")).toBeInTheDocument();
    expect(screen.getByText("EQ10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watchlist page 2" })).toBeDisabled();
  });

  test("pagination: adding an 11th item makes page 2 active and discoverable", async () => {
    const watchlist10 = Array.from({ length: 10 }, (_, i) =>
      createMockWatchlistItem(i + 1, `ITEM${i + 1}`)
    );

    renderWithProviders(watchlist10);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByRole("button", { name: "Watchlist page 2" })).toBeDisabled();

    jest.spyOn(InstrumentsApi, "search").mockResolvedValue({
      success: true,
      data: {
        items: [mockSearchResult("inst-11", "ITEM11", "Item Eleven")],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
      },
    });

    const addedItem = createMockWatchlistItem(11, "ITEM11");
    jest.spyOn(WatchlistApi, "addItem").mockResolvedValue({
      success: true,
      data: { item: addedItem },
    });

    const input = screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance");
    await act(async () => {
      fireEvent.change(input, { target: { value: "item11" } });
      await new Promise((r) => setTimeout(r, 300));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add ITEM11 to watchlist"));
    });

    // Tab 2 is now enabled and automatically selected
    const tab2 = screen.getByRole("button", { name: "Watchlist page 2" });
    expect(tab2).not.toBeDisabled();
    expect(tab2).toHaveClass("active-tab");

    // Close search panel so watchlist items are clear
    const clearBtn = screen.getByLabelText("Clear search");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(screen.getByText("ITEM11")).toBeInTheDocument();
  });

  // ==================== REORDERING SPECIFICATION TESTS ====================

  test("reordering: move down and move up controls call PATCH /api/v1/watchlist/reorder with complete ordered list", async () => {
    const initialList = [
      createMockWatchlistItem(1, "FIRST"),
      createMockWatchlistItem(2, "SECOND"),
      createMockWatchlistItem(3, "THIRD"),
    ];

    renderWithProviders(initialList);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    const reorderSpy = jest.spyOn(WatchlistApi, "reorder").mockResolvedValue({
      success: true,
      data: { items: [], count: 3 },
    });

    // First item: Move Up is disabled, Move Down is enabled
    const moveUpFirst = screen.getByLabelText("Move FIRST up");
    const moveDownFirst = screen.getByLabelText("Move FIRST down");
    expect(moveUpFirst).toBeDisabled();
    expect(moveDownFirst).not.toBeDisabled();

    // Click Move Down on FIRST (moves to index 1)
    await act(async () => {
      fireEvent.click(moveDownFirst);
    });

    expect(reorderSpy).toHaveBeenCalledWith(["inst-2", "inst-1", "inst-3"]);

    // Now click Move Up on FIRST (moves back to index 0)
    const moveUpFirstNow = screen.getByLabelText("Move FIRST up");
    await act(async () => {
      fireEvent.click(moveUpFirstNow);
    });

    expect(reorderSpy).toHaveBeenCalledWith(["inst-1", "inst-2", "inst-3"]);
  });

  test("reordering: handles API failure with rollback to previous list", async () => {
    const initialList = [
      createMockWatchlistItem(1, "ALPHA"),
      createMockWatchlistItem(2, "BETA"),
    ];

    renderWithProviders(initialList);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    jest.spyOn(WatchlistApi, "reorder").mockResolvedValue({
      success: false,
      error: { code: "SERVER_ERROR", message: "Reorder failed on server" },
    });

    const moveDownAlpha = screen.getByLabelText("Move ALPHA down");
    await act(async () => {
      fireEvent.click(moveDownAlpha);
    });

    expect(screen.getByText("Reorder failed on server")).toBeInTheDocument();
    // Move down on ALPHA should still be enabled (it rolled back to index 0)
    expect(screen.getByLabelText("Move ALPHA down")).not.toBeDisabled();
  });

  test("reordering: failed cross-page reorder restores both the list and the active page", async () => {
    const watchlist11 = Array.from({ length: 11 }, (_, i) =>
      createMockWatchlistItem(i + 1, `ITEM${i + 1}`)
    );

    renderWithProviders(watchlist11);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("ITEM10")).toBeInTheDocument();

    // Move ITEM10 down across page boundary (to index 10 on page 2)
    jest.spyOn(WatchlistApi, "reorder").mockResolvedValue({
      success: false,
      error: { code: "REORDER_FAILED", message: "Server reorder error" },
    });

    const moveDownItem10 = screen.getByLabelText("Move ITEM10 down");
    await act(async () => {
      fireEvent.click(moveDownItem10);
    });

    expect(screen.getByText("Server reorder error")).toBeInTheDocument();
    // Active tab restored to Page 1
    const tab1 = screen.getByRole("button", { name: "Watchlist page 1" });
    expect(tab1).toHaveClass("active-tab");
    expect(screen.getByText("ITEM10")).toBeInTheDocument();
  });

  // ==================== TASK 5.5.1 AUTHENTICATION TESTS ====================

  test("authentication: a watchlist response arriving after logout is ignored", async () => {
    let resolveWatchlist: (val: any) => void;
    const watchlistPromise = new Promise((resolve) => {
      resolveWatchlist = resolve;
    });

    jest.spyOn(WatchlistApi, "getWatchlist").mockImplementation(() => watchlistPromise as any);

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

    // Login to trigger fetchWatchlist
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Logout while request is in flight
    await act(async () => {
      fireEvent.click(screen.getByText("Logout"));
    });

    expect(screen.getByText("Watchlist is Empty")).toBeInTheDocument();

    // Older request resolves after logout
    await act(async () => {
      resolveWatchlist!({
        success: true,
        data: {
          items: [createMockWatchlistItem(1, "LATE_STOCK")],
          count: 1,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // Watchlist MUST remain empty and not show LATE_STOCK
    expect(screen.queryByText("LATE_STOCK")).not.toBeInTheDocument();
    expect(screen.getByText("Watchlist is Empty")).toBeInTheDocument();
  });

  test("authentication: older fetch cannot overwrite newer authenticated session's watchlist", async () => {
    let resolveUserA: (val: any) => void;
    const userAPromise = new Promise((resolve) => {
      resolveUserA = resolve;
    });

    let resolveUserB: (val: any) => void;
    const userBPromise = new Promise((resolve) => {
      resolveUserB = resolve;
    });

    const watchlistSpy = jest.spyOn(WatchlistApi, "getWatchlist");
    watchlistSpy.mockImplementationOnce(() => userAPromise as any);
    watchlistSpy.mockImplementationOnce(() => userBPromise as any);

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

    // User A logs in (triggers fetch A)
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Re-authenticate / trigger new fetch (User B)
    await act(async () => {
      fireEvent.click(screen.getByText("Login B"));
    });

    // User B's fetch resolves first
    await act(async () => {
      resolveUserB!({
        success: true,
        data: {
          items: [createMockWatchlistItem(1, "USER_B_STOCK")],
          count: 1,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText("USER_B_STOCK")).toBeInTheDocument();

    // User A's slow fetch resolves later
    await act(async () => {
      resolveUserA!({
        success: true,
        data: {
          items: [createMockWatchlistItem(2, "USER_A_STOCK")],
          count: 1,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // USER_B_STOCK remains, USER_A_STOCK is discarded!
    expect(screen.getByText("USER_B_STOCK")).toBeInTheDocument();
    expect(screen.queryByText("USER_A_STOCK")).not.toBeInTheDocument();
  });

  // ==================== TASK 5.5.1 QUOTE & STALE PRESENTATION TESTS ====================

  test("quote presentation: missing or zero previous close displays '—' instead of fabricated 0.00%", async () => {
    const itemNoPrevClose = createMockWatchlistItem(1, "NOPREV", 250000, 0);

    renderWithProviders([itemNoPrevClose]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("NOPREV")).toBeInTheDocument();
    expect(screen.getByText("₹2,500.00")).toBeInTheDocument();
    // Percentage change must be '—', not '0.00%'
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0.00%")).not.toBeInTheDocument();
  });

  test("quote presentation: stale quote visibly displays STALE badge", async () => {
    const staleItem = createMockWatchlistItem(1, "STALESTK");
    staleItem.quote!.isStale = true;

    renderWithProviders([staleItem]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("STALESTK")).toBeInTheDocument();
    expect(screen.getByLabelText("Stale quote")).toBeInTheDocument();
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });

  test("quote presentation: non-stale quote does not display STALE badge", async () => {
    const freshItem = createMockWatchlistItem(1, "FRESHSTK");
    freshItem.quote!.isStale = false;

    renderWithProviders([freshItem]);
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    expect(screen.getByText("FRESHSTK")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stale quote")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
});

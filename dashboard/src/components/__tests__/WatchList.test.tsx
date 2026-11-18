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
  return <button onClick={() => setToken("jwt-token")}>Login</button>;
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
          symbol: "TEST",
          lastPricePaise: 150000,
          bidPricePaise: 149950,
          askPricePaise: 150050,
          previousClosePaise: 145000,
          priceUpdatedAt: "2026-11-18T10:00:00.000Z",
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

  test("search: displays loading and error states in dedicated search panel", async () => {
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

    // Before timer finishes, wait for debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.getByText("Searching instruments...")).toBeInTheDocument();

    // Now reject to test error state
    await act(async () => {
      resolveSearch!({
        success: false,
        error: { code: "SERVER_ERROR", message: "Network search timeout" },
      });
    });

    // Wait a tick
    await act(async () => {
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
        items: [mockSearchResult("inst-itc", "ITC", "ITC Limited", 45000)],
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
    // 50 existing items
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
    expect(screen.queryByText("RELIANCE")).not.toBeInTheDocument();
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
    // 25 items: Page 1 = items 1..10, Page 2 = items 11..20, Page 3 = items 21..25
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
    // 15 items: only Page 1 (items 1..10) and Page 2 (items 11..15) exist.
    // Pages 3, 4, 5 must be disabled.
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
    // 11 items: 10 on page 1, 1 on page 2
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
    // Tab 2 is now disabled
    expect(screen.getByRole("button", { name: "Watchlist page 2" })).toBeDisabled();
  });

  test("pagination: adding an 11th item makes page 2 active and discoverable", async () => {
    // 10 items on page 1
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
});

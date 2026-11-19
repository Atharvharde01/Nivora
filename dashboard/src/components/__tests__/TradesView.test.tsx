/**
 * NIVORA Trading Platform — TradesView Component Test Suite
 * Verifies trade execution history rendering, session isolation, paise-to-rupees formatting,
 * manual refresh, and asynchronous request race protection across session transitions.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { PortfolioProvider, usePortfolio } from "../../context/PortfolioContext";
import { TradesView } from "../TradesView";
import { TradesApi, PortfolioApi, AccountsApi } from "../../api/client";
import { TradeDto } from "../../api/types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockTrades: TradeDto[] = [
  {
    _id: "trade-1",
    orderId: "ord-1",
    userId: "user-1",
    practiceAccountId: "acc-1",
    instrumentId: "664000000000000000000010",
    symbol: "INFY",
    exchange: "NSE",
    side: "BUY",
    quantity: 10,
    executionPricePaise: 185000,
    totalValuePaise: 1850000,
    costBasisSoldPaise: 0,
    realizedPnlPaise: 0,
    quoteSnapshot: {
      lastPricePaise: 185000,
      bidPricePaise: 184950,
      askPricePaise: 185000,
      priceUpdatedAt: "2026-11-18T10:30:00.000Z",
    },
    executedAt: "2026-11-18T10:30:00.000Z",
    createdAt: "2026-11-18T10:30:00.000Z",
  },
  {
    _id: "trade-2",
    orderId: "ord-2",
    userId: "user-1",
    practiceAccountId: "acc-1",
    instrumentId: "664000000000000000000011",
    symbol: "TCS",
    exchange: "NSE",
    side: "SELL",
    quantity: 5,
    executionPricePaise: 392000,
    totalValuePaise: 1960000,
    costBasisSoldPaise: 1900000,
    realizedPnlPaise: 60000, // +₹600.00
    quoteSnapshot: {
      lastPricePaise: 392000,
      bidPricePaise: 392000,
      askPricePaise: 392050,
      priceUpdatedAt: "2026-11-18T11:00:00.000Z",
    },
    executedAt: "2026-11-18T11:00:00.000Z",
    createdAt: "2026-11-18T11:00:00.000Z",
  },
];

const TestAuthHelper: React.FC = () => {
  const { setToken } = useAuth();
  const { triggerOrdersRefresh } = usePortfolio();
  return (
    <div>
      <button onClick={() => setToken("jwt-token-user-1")}>Login User 1</button>
      <button onClick={() => setToken("jwt-token-user-2")}>Login User 2</button>
      <button onClick={() => setToken(null)}>Logout</button>
      <button onClick={() => triggerOrdersRefresh()}>Sync Signal</button>
    </div>
  );
};

const renderTradesView = () => {
  jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
    success: true,
    data: {
      practiceAccountId: "acc-1",
      summary: {
        practiceAccountId: "acc-1",
        accountNumber: 1001,
        cashBalancePaise: 100000000,
        totalInvestedPaise: 0,
        currentMarketValuePaise: 0,
        unrealizedPnlPaise: 0,
        realizedPnlPaise: 0,
        totalPnlPaise: 0,
        activePositionsCount: 0,
        hasStaleQuotes: false,
      },
      positions: [],
      activePositionsCount: 0,
    },
  });

  jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
    success: true,
    data: {
      account: {
        accountId: "acc-1",
        userId: "user-1",
        accountNumber: 1001,
        status: "ACTIVE",
        initialBalancePaise: 100000000,
        cashBalancePaise: 100000000,
        version: 1,
        createdAt: "2026-11-18T00:00:00.000Z",
        updatedAt: "2026-11-18T00:00:00.000Z",
      },
    },
  });

  return render(
    <AuthProvider>
      <PortfolioProvider>
        <TestAuthHelper />
        <TradesView />
      </PortfolioProvider>
    </AuthProvider>
  );
};

describe("TradesView Component — Trade Execution History Suite", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders unauthenticated empty state when user is not logged in", () => {
    renderTradesView();
    expect(screen.getByText("No Trades Recorded")).toBeInTheDocument();
    expect(
      screen.getByText(/Session token required to view trade executions/i)
    ).toBeInTheDocument();
  });

  test("fetches and renders trades list when user is authenticated", async () => {
    jest.spyOn(TradesApi, "getTrades").mockResolvedValue({
      success: true,
      data: {
        items: mockTrades,
        pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
      },
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("INFY")).toBeInTheDocument();
      expect(screen.getByText("TCS")).toBeInTheDocument();
    });

    expect(screen.getByText("₹1,850.00")).toBeInTheDocument();
    expect(screen.getByText("₹18,500.00")).toBeInTheDocument();
    expect(screen.getByText("₹3,920.00")).toBeInTheDocument();
    expect(screen.getByText("+₹600.00")).toBeInTheDocument();
  });

  test("renders empty state when authenticated user has zero trades", async () => {
    jest.spyOn(TradesApi, "getTrades").mockResolvedValue({
      success: true,
      data: {
        items: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      },
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("No Trades Recorded")).toBeInTheDocument();
      expect(
        screen.getByText(/No trades executed for this account today/i)
      ).toBeInTheDocument();
    });
  });

  test("displays error state when trade fetching fails", async () => {
    jest.spyOn(TradesApi, "getTrades").mockRejectedValue(new Error("Gateway Timeout"));

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Error loading trades:/i)).toBeInTheDocument();
      expect(screen.getByText(/Gateway Timeout/i)).toBeInTheDocument();
    });
  });

  test("clears trades immediately on logout to maintain session isolation", async () => {
    jest.spyOn(TradesApi, "getTrades").mockResolvedValue({
      success: true,
      data: {
        items: [mockTrades[0]],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("INFY")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Logout"));
    });

    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
    expect(screen.getByText("No Trades Recorded")).toBeInTheDocument();
  });

  test("refresh button re-fetches trade history", async () => {
    const getTradesSpy = jest.spyOn(TradesApi, "getTrades").mockResolvedValue({
      success: true,
      data: {
        items: [mockTrades[0]],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(getTradesSpy).toHaveBeenCalledTimes(1);
    });

    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(getTradesSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TradesView Component — Asynchronous Concurrency & Race Protection Suite", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("User A -> User B switch while trades fetch is pending executes B without waiting and discards A", async () => {
    const deferredA = createDeferred<any>();
    const deferredB = createDeferred<any>();

    let callCount = 0;
    jest.spyOn(TradesApi, "getTrades").mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? deferredA.promise : deferredB.promise;
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 2"));
    });

    expect(callCount).toBe(2);

    await act(async () => {
      deferredB.resolve({
        success: true,
        data: {
          items: [mockTrades[1]], // TCS
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("TCS")).toBeInTheDocument();
    });

    await act(async () => {
      deferredA.resolve({
        success: true,
        data: {
          items: [mockTrades[0]], // INFY
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
  });

  test("direct User A -> User B switch immediately clears old trades while new fetch is pending", async () => {
    const deferredA = createDeferred<any>();
    const deferredB = createDeferred<any>();

    let callCount = 0;
    jest.spyOn(TradesApi, "getTrades").mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? deferredA.promise : deferredB.promise;
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await act(async () => {
      deferredA.resolve({
        success: true,
        data: {
          items: [mockTrades[0]], // INFY
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("INFY")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 2"));
    });

    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
    expect(screen.getByText("Loading trades...")).toBeInTheDocument();

    await act(async () => {
      deferredB.resolve({
        success: true,
        data: {
          items: [mockTrades[1]], // TCS
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("TCS")).toBeInTheDocument();
      expect(screen.queryByText("INFY")).not.toBeInTheDocument();
    });
  });

  test("out-of-order responses within same session: older superseded request does not overwrite newer result", async () => {
    const deferred1 = createDeferred<any>();
    const deferred2 = createDeferred<any>();

    let count = 0;
    jest.spyOn(TradesApi, "getTrades").mockImplementation(() => {
      count += 1;
      return count === 1 ? deferred1.promise : deferred2.promise;
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Sync Signal"));
    });

    await act(async () => {
      deferred2.resolve({
        success: true,
        data: {
          items: [mockTrades[1]], // TCS
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("TCS")).toBeInTheDocument();
    });

    await act(async () => {
      deferred1.resolve({
        success: true,
        data: {
          items: [mockTrades[0]], // INFY
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
  });

  test("newer request loading-state protection: older request does not clear loading for active newer request", async () => {
    const deferred1 = createDeferred<any>();
    const deferred2 = createDeferred<any>();

    let count = 0;
    jest.spyOn(TradesApi, "getTrades").mockImplementation(() => {
      count += 1;
      return count === 1 ? deferred1.promise : deferred2.promise;
    });

    renderTradesView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Sync Signal"));
    });

    expect(screen.getByText("Loading trades...")).toBeInTheDocument();

    await act(async () => {
      deferred1.resolve({
        success: true,
        data: {
          items: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
        },
      });
    });

    expect(screen.getByText("Loading trades...")).toBeInTheDocument();

    await act(async () => {
      deferred2.resolve({
        success: true,
        data: {
          items: [mockTrades[1]], // TCS
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading trades...")).not.toBeInTheDocument();
      expect(screen.getByText("TCS")).toBeInTheDocument();
    });
  });
});

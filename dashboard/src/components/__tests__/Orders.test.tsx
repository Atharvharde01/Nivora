import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { PortfolioProvider } from "../../context/PortfolioContext";
import { OrdersApi, PortfolioApi, AccountsApi } from "../../api/client";
import { Orders } from "../Orders";
import { OrderDto } from "../../api/types";

const mockOrders: OrderDto[] = [
  {
    _id: "ord-1",
    userId: "usr-1",
    practiceAccountId: "acc-1",
    instrumentId: "664000000000000000000020",
    symbol: "INFY",
    exchange: "NSE",
    side: "BUY",
    orderType: "MARKET",
    quantity: 10,
    status: "EXECUTED",
    executedQuantity: 10,
    executionPricePaise: 185000,
    totalValuePaise: 1850000,
    executedAt: "2026-11-18T10:30:01.000Z",
    createdAt: "2026-11-18T10:30:00.000Z",
    updatedAt: "2026-11-18T10:30:01.000Z",
  },
  {
    _id: "ord-2",
    userId: "usr-1",
    practiceAccountId: "acc-1",
    instrumentId: "664000000000000000000021",
    symbol: "TCS",
    exchange: "NSE",
    side: "SELL",
    orderType: "MARKET",
    quantity: 5,
    status: "REJECTED",
    executedQuantity: 0,
    rejectionReason: "Insufficient shares available to execute sell order",
    rejectionCode: "INSUFFICIENT_QUANTITY",
    createdAt: "2026-11-18T11:00:00.000Z",
    updatedAt: "2026-11-18T11:00:01.000Z",
  },
  {
    _id: "ord-3",
    userId: "usr-1",
    practiceAccountId: "acc-1",
    instrumentId: "664000000000000000000022",
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    orderType: "MARKET",
    quantity: 2,
    status: "RECEIVED",
    executedQuantity: 0,
    createdAt: "2026-11-18T11:15:00.000Z",
    updatedAt: "2026-11-18T11:15:00.000Z",
  },
];

const TestAuthHelper: React.FC = () => {
  const { setToken } = useAuth();
  return (
    <div>
      <button onClick={() => setToken("jwt-token-user-1")}>Login User 1</button>
      <button onClick={() => setToken("jwt-token-user-2")}>Login User 2</button>
      <button onClick={() => setToken(null)}>Logout</button>
    </div>
  );
};

const renderOrdersView = () => {
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
        userId: "usr-1",
        accountNumber: 1001,
        status: "ACTIVE",
        initialBalancePaise: 100000000,
        cashBalancePaise: 100000000,
        version: 1,
        createdAt: "2026-11-18T10:00:00.000Z",
        updatedAt: "2026-11-18T10:00:00.000Z",
      },
    },
  });

  return render(
    <AuthProvider>
      <PortfolioProvider>
        <TestAuthHelper />
        <Orders />
      </PortfolioProvider>
    </AuthProvider>
  );
};

describe("Orders Component — Orders History Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders unauthenticated empty state when user is not logged in", () => {
    renderOrdersView();
    expect(screen.getByText("Orders (0)")).toBeInTheDocument();
    expect(screen.getByText("No Orders Recorded")).toBeInTheDocument();
    expect(
      screen.getByText(/Session token required to view order history/)
    ).toBeInTheDocument();
  });

  test("fetches and renders orders list when user is authenticated", async () => {
    const getOrdersSpy = jest.spyOn(OrdersApi, "getOrders").mockResolvedValue({
      success: true,
      data: {
        items: mockOrders,
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      },
    });

    renderOrdersView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(getOrdersSpy).toHaveBeenCalledWith({ limit: 50 });
      expect(screen.getByText("Orders (3)")).toBeInTheDocument();
    });

    // Verify Executed INFY order
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getAllByText("BUY").length).toBe(2);
    expect(screen.getByText("EXECUTED")).toBeInTheDocument();
    expect(screen.getByText("₹1,850.00")).toBeInTheDocument();

    // Verify Rejected TCS order
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
    expect(screen.getByText("REJECTED")).toBeInTheDocument();
    expect(
      screen.getByText(/Insufficient shares available to execute sell order/)
    ).toBeInTheDocument();
    expect(screen.getByText(/INSUFFICIENT_QUANTITY/)).toBeInTheDocument();

    // Verify Received RELIANCE order
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("RECEIVED")).toBeInTheDocument();
  });

  test("renders empty state when authenticated user has zero orders", async () => {
    jest.spyOn(OrdersApi, "getOrders").mockResolvedValue({
      success: true,
      data: {
        items: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      },
    });

    renderOrdersView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("No Orders Recorded")).toBeInTheDocument();
      expect(
        screen.getByText(/You haven't placed any orders yet/)
      ).toBeInTheDocument();
    });
  });

  test("displays error state when order fetching fails", async () => {
    jest.spyOn(OrdersApi, "getOrders").mockResolvedValue({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Failed to connect to order execution ledger",
      },
    });

    renderOrdersView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to connect to order execution ledger/)
      ).toBeInTheDocument();
    });
  });

  test("clears orders immediately on logout to maintain session isolation", async () => {
    jest.spyOn(OrdersApi, "getOrders").mockResolvedValue({
      success: true,
      data: {
        items: mockOrders,
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
      },
    });

    renderOrdersView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("Orders (3)")).toBeInTheDocument();
    });

    // Logout
    await act(async () => {
      fireEvent.click(screen.getByText("Logout"));
    });

    // Orders must be cleared immediately
    expect(screen.getByText("Orders (0)")).toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
  });

  test("refresh button re-fetches order history", async () => {
    const getOrdersSpy = jest.spyOn(OrdersApi, "getOrders").mockResolvedValue({
      success: true,
      data: {
        items: [mockOrders[0]],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
    });

    renderOrdersView();

    await act(async () => {
      fireEvent.click(screen.getByText("Login User 1"));
    });

    await waitFor(() => {
      expect(screen.getByText("Orders (1)")).toBeInTheDocument();
    });

    // Click refresh
    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(getOrdersSpy).toHaveBeenCalledTimes(2);
  });
});

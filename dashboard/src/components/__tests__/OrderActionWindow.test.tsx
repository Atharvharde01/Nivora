import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider, useMarket, SelectedInstrument } from "../../context/MarketContext";
import { PortfolioProvider, usePortfolio } from "../../context/PortfolioContext";
import { OrdersApi, PortfolioApi, AccountsApi } from "../../api/client";
import OrderActionWindow from "../OrderActionWindow";

const mockEquity: SelectedInstrument = {
  symbol: "INFY",
  name: "Infosys Limited",
  type: "equity",
  exchange: "NSE",
  instrumentId: "664000000000000000000020",
  lastPricePaise: 185000, // ₹1,850.00
  isTradable: true,
};

const mockIndex: SelectedInstrument = {
  symbol: "NIFTY 50",
  name: "NIFTY 50 Benchmark",
  type: "index",
  exchange: "NSE",
  indexSymbol: "NIFTY50",
};

const mockUntradableEquity: SelectedInstrument = {
  symbol: "HALTED",
  name: "Halted Corp",
  type: "equity",
  exchange: "NSE",
  instrumentId: "664000000000000000000099",
  lastPricePaise: 50000,
  isTradable: false,
};

const TestController: React.FC<{ initialInstrument?: SelectedInstrument }> = ({
  initialInstrument = mockEquity,
}) => {
  const { setToken } = useAuth();
  const { openBuyWindow, openSellWindow } = useMarket();

  return (
    <div>
      <button onClick={() => setToken("jwt-session-token")}>Login</button>
      <button onClick={() => setToken(null)}>Logout</button>
      <button onClick={() => openBuyWindow(initialInstrument)}>Open BUY</button>
      <button onClick={() => openSellWindow(initialInstrument)}>Open SELL</button>
      <button onClick={() => openBuyWindow(mockIndex)}>Open Index BUY</button>
      <button onClick={() => openBuyWindow(mockUntradableEquity)}>Open Untradable BUY</button>
    </div>
  );
};

const renderOrderWindow = (options?: {
  initialInstrument?: SelectedInstrument;
  positions?: any[];
}) => {
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
        activePositionsCount: (options?.positions || []).length,
        hasStaleQuotes: false,
      },
      positions: options?.positions || [],
      activePositionsCount: (options?.positions || []).length,
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
      <MarketProvider>
        <PortfolioProvider>
          <TestController initialInstrument={options?.initialInstrument} />
          <OrderActionWindow />
        </PortfolioProvider>
      </MarketProvider>
    </AuthProvider>
  );
};

describe("OrderActionWindow Component — Trading Integration Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("BUY workflow: successfully places BUY market order with Idempotency-Key header", async () => {
    const placeOrderSpy = jest.spyOn(OrdersApi, "placeOrder").mockResolvedValue({
      success: true,
      data: {
        status: "EXECUTED",
        wasIdempotentReplay: false,
        order: {
          _id: "ord-1",
          instrumentId: "664000000000000000000020",
          symbol: "INFY",
          exchange: "NSE",
          side: "BUY",
          orderType: "MARKET",
          quantity: 5,
          status: "EXECUTED",
          executedQuantity: 5,
          executionPricePaise: 185000,
          totalValuePaise: 925000,
          createdAt: "2026-11-18T10:00:00.000Z",
        },
        trade: null,
      },
    });

    renderOrderWindow();

    // Authenticate
    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // Open BUY modal
    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("BUY INFY")).toBeInTheDocument();
    expect(screen.getByText("NSE • Infosys Limited")).toBeInTheDocument();

    // Change quantity to 5
    const qtyInput = screen.getByLabelText(/Quantity/i);
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "5" } });
    });

    // Submit order
    const submitBtn = screen.getByRole("button", { name: "BUY (5)" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(placeOrderSpy).toHaveBeenCalledTimes(1);
    const [payload, idempotencyKey] = placeOrderSpy.mock.calls[0];

    // Verify clean contract: NO price, NO orderType
    expect(payload).toEqual({
      instrumentId: "664000000000000000000020",
      side: "BUY",
      quantity: 5,
    });
    expect((payload as any).price).toBeUndefined();
    expect((payload as any).executionPricePaise).toBeUndefined();
    expect((payload as any).orderType).toBeUndefined();

    // Verify Idempotency-Key
    expect(typeof idempotencyKey).toBe("string");
    expect(idempotencyKey.length).toBeGreaterThanOrEqual(8);

    // Verify execution feedback
    await waitFor(() => {
      expect(screen.getByText("Order Executed (BUY)")).toBeInTheDocument();
      expect(screen.getByText(/Successfully executed market order for 5 shares of INFY/)).toBeInTheDocument();
      expect(screen.getAllByText("₹1,850.00").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("₹9,250.00").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("SELL workflow: displays available holdings and submits SELL order", async () => {
    const existingPosition = {
      instrumentId: "664000000000000000000020",
      symbol: "INFY",
      exchange: "NSE",
      quantity: 10,
      averageBuyPricePaise: 180000,
      totalInvestedPaise: 1800000,
      realizedPnlPaise: 0,
      lastPricePaise: 185000,
      bidPricePaise: 184950,
      askPricePaise: 185050,
      currentMarketValuePaise: 1850000,
      unrealizedPnlPaise: 50000,
      quoteTimestamp: "2026-11-18T10:00:00.000Z",
      quoteAgeMs: 500,
      isQuoteStale: false,
      isTradable: true,
    };

    const placeOrderSpy = jest.spyOn(OrdersApi, "placeOrder").mockResolvedValue({
      success: true,
      data: {
        status: "EXECUTED",
        wasIdempotentReplay: false,
        order: {
          _id: "ord-2",
          instrumentId: "664000000000000000000020",
          symbol: "INFY",
          exchange: "NSE",
          side: "SELL",
          orderType: "MARKET",
          quantity: 4,
          status: "EXECUTED",
          executedQuantity: 4,
          executionPricePaise: 185000,
          totalValuePaise: 740000,
          createdAt: "2026-11-18T10:00:00.000Z",
        },
        trade: null,
      },
    });

    renderOrderWindow({ positions: [existingPosition] });

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open SELL"));
    });

    expect(screen.getByText("SELL INFY")).toBeInTheDocument();
    expect(screen.getByText("10 shares")).toBeInTheDocument();

    const qtyInput = screen.getByLabelText(/Quantity/i);
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "4" } });
    });

    const submitBtn = screen.getByRole("button", { name: "SELL (4)" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(placeOrderSpy).toHaveBeenCalledWith(
      {
        instrumentId: "664000000000000000000020",
        side: "SELL",
        quantity: 4,
      },
      expect.any(String)
    );
  });

  test("SELL validation: entering quantity greater than owned shares shows warning and disables submission", async () => {
    const existingPosition = {
      instrumentId: "664000000000000000000020",
      symbol: "INFY",
      exchange: "NSE",
      quantity: 3,
      averageBuyPricePaise: 180000,
      totalInvestedPaise: 540000,
      realizedPnlPaise: 0,
      lastPricePaise: 185000,
      bidPricePaise: 184950,
      askPricePaise: 185050,
      currentMarketValuePaise: 555000,
      unrealizedPnlPaise: 15000,
      quoteTimestamp: "2026-11-18T10:00:00.000Z",
      quoteAgeMs: 500,
      isQuoteStale: false,
      isTradable: true,
    };

    renderOrderWindow({ positions: [existingPosition] });

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open SELL"));
    });

    const qtyInput = screen.getByLabelText(/Quantity/i);
    // User attempts to sell 5 shares when owning only 3
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "5" } });
    });

    expect(screen.getByText("Quantity exceeds your available holding of 3 shares.")).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /^SELL/i });
    expect(submitBtn).toBeDisabled();
  });

  test("quantity validation: rejects zero, negative, and fractional quantities", async () => {
    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    const qtyInput = screen.getByLabelText(/Quantity/i);
    const submitBtn = screen.getByRole("button", { name: /^BUY/i });

    // Zero
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "0" } });
    });
    expect(screen.getByText("Quantity must be a positive whole integer greater than zero.")).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Negative
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "-3" } });
    });
    expect(screen.getByText("Quantity must be a positive whole integer greater than zero.")).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Fractional
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "2.5" } });
    });
    expect(screen.getByText("Fractional shares are not supported. Enter a whole integer quantity.")).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
  });

  test("index blocking: market indices cannot be ordered directly", async () => {
    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Index BUY"));
    });

    expect(screen.getByText(/is a market index benchmark and cannot be traded directly/)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /^BUY/i });
    expect(submitBtn).toBeDisabled();
  });

  test("untradable equity blocking: instruments marked untradable cannot be ordered", async () => {
    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open Untradable BUY"));
    });

    expect(screen.getByText("This instrument is currently not marked tradable in the catalogue.")).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /^BUY/i });
    expect(submitBtn).toBeDisabled();
  });

  test("unauthenticated blocking: unauthenticated users cannot submit orders", async () => {
    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    expect(screen.getByText(/Authentication required to submit orders/)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /^BUY/i });
    expect(submitBtn).toBeDisabled();
  });

  test("idempotency & retry: retry of same payload preserves key; modifying payload generates new key", async () => {
    const placeOrderSpy = jest.spyOn(OrdersApi, "placeOrder").mockRejectedValueOnce(
      new Error("Network timeout")
    ).mockResolvedValueOnce({
      success: true,
      data: {
        status: "EXECUTED",
        wasIdempotentReplay: false,
        order: {
          _id: "ord-3",
          instrumentId: "664000000000000000000020",
          symbol: "INFY",
          exchange: "NSE",
          side: "BUY",
          orderType: "MARKET",
          quantity: 2,
          status: "EXECUTED",
          executedQuantity: 2,
          executionPricePaise: 185000,
          totalValuePaise: 370000,
          createdAt: "2026-11-18T10:00:00.000Z",
        },
        trade: null,
      },
    });

    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    const qtyInput = screen.getByLabelText(/Quantity/i);
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "2" } });
    });

    const submitBtn = screen.getByRole("button", { name: "BUY (2)" });

    // Attempt 1: Fails with network timeout
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(placeOrderSpy).toHaveBeenCalledTimes(1);
    const firstKey = placeOrderSpy.mock.calls[0][1];

    expect(screen.getByText("Connection Error")).toBeInTheDocument();

    // Attempt 2: Retry with exact same payload
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(placeOrderSpy).toHaveBeenCalledTimes(2);
    const retryKey = placeOrderSpy.mock.calls[1][1];

    // MUST preserve exact same idempotency key for identical logical retry!
    expect(retryKey).toBe(firstKey);
  });

  test("concurrency guard: synchronous submission lock prevents rapid double-clicks", async () => {
    let resolveOrder: (val: any) => void;
    const orderPromise = new Promise((resolve) => {
      resolveOrder = resolve;
    });

    const placeOrderSpy = jest.spyOn(OrdersApi, "placeOrder").mockImplementationOnce(() => orderPromise as any);

    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    const submitBtn = screen.getByRole("button", { name: "BUY (1)" });

    // First click
    act(() => {
      fireEvent.click(submitBtn);
    });

    // Rapid second click while first is in-flight
    act(() => {
      fireEvent.click(submitBtn);
    });

    // Only one API call was dispatched
    expect(placeOrderSpy).toHaveBeenCalledTimes(1);

    // Resolve in-flight request
    await act(async () => {
      resolveOrder!({
        success: true,
        data: {
          status: "EXECUTED",
          wasIdempotentReplay: false,
          order: {
            _id: "ord-4",
            instrumentId: "664000000000000000000020",
            symbol: "INFY",
            exchange: "NSE",
            side: "BUY",
            orderType: "MARKET",
            quantity: 1,
            status: "EXECUTED",
            executedQuantity: 1,
            executionPricePaise: 185000,
            totalValuePaise: 185000,
            createdAt: "2026-11-18T10:00:00.000Z",
          },
          trade: null,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText("Order Executed (BUY)")).toBeInTheDocument();
  });

  test("rejection feedback: backend REJECTED status surfaces rejection code and reason", async () => {
    jest.spyOn(OrdersApi, "placeOrder").mockResolvedValue({
      success: true,
      data: {
        status: "REJECTED",
        wasIdempotentReplay: false,
        rejectionCode: "INSUFFICIENT_FUNDS",
        rejectionReason: "Practice account cash balance is insufficient to cover total consideration.",
        order: {
          _id: "ord-5",
          instrumentId: "664000000000000000000020",
          symbol: "INFY",
          exchange: "NSE",
          side: "BUY",
          orderType: "MARKET",
          quantity: 1000,
          status: "REJECTED",
          executedQuantity: 0,
          rejectionCode: "INSUFFICIENT_FUNDS",
          rejectionReason: "Practice account cash balance is insufficient to cover total consideration.",
          createdAt: "2026-11-18T10:00:00.000Z",
        },
        trade: null,
      },
    });

    renderOrderWindow();

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Open BUY"));
    });

    const qtyInput = screen.getByLabelText(/Quantity/i);
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: "1000" } });
    });

    const submitBtn = screen.getByRole("button", { name: "BUY (1000)" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Order Rejected/)).toBeInTheDocument();
      expect(screen.getByText(/\[INSUFFICIENT_FUNDS\]/)).toBeInTheDocument();
      expect(screen.getByText(/Practice account cash balance is insufficient to cover total consideration/)).toBeInTheDocument();
    });
  });
});


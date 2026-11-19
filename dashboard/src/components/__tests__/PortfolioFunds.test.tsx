import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { PortfolioProvider, usePortfolio } from "../../context/PortfolioContext";
import { PortfolioApi, AccountsApi } from "../../api/client";
import { Holdings } from "../Holdings";
import { Positions } from "../Positions";
import { Funds } from "../Funds";
import {
  PortfolioPositionDto,
  PortfolioResponseData,
  PortfolioSummaryDto,
  PracticeAccountSummaryDto,
} from "../../api/types";

const mockSummary: PortfolioSummaryDto = {
  practiceAccountId: "acc-1",
  accountNumber: 1001,
  cashBalancePaise: 81500000, // ₹8,15,000.00
  totalInvestedPaise: 18500000, // ₹1,85,000.00
  currentMarketValuePaise: 19200000, // ₹1,92,000.00
  unrealizedPnlPaise: 700000, // +₹7,000.00
  realizedPnlPaise: 250000, // +₹2,500.00
  totalPnlPaise: 950000, // +₹9,500.00
  activePositionsCount: 2,
  hasStaleQuotes: true,
};

const mockAccount: PracticeAccountSummaryDto = {
  accountId: "acc-1",
  userId: "usr-1",
  accountNumber: 1001,
  status: "ACTIVE",
  initialBalancePaise: 100000000, // ₹10,00,000.00
  cashBalancePaise: 81500000,
  version: 2,
  createdAt: "2026-11-18T10:00:00.000Z",
  updatedAt: "2026-11-18T11:00:00.000Z",
};

const mockPositions: PortfolioPositionDto[] = [
  {
    instrumentId: "664000000000000000000020",
    symbol: "INFY",
    exchange: "NSE",
    quantity: 100,
    averageBuyPricePaise: 185000, // ₹1,850.00
    totalInvestedPaise: 18500000, // ₹1,85,000.00
    lastPricePaise: 192000, // ₹1,920.00
    bidPricePaise: 191950,
    askPricePaise: 192050,
    currentMarketValuePaise: 19200000, // ₹1,92,000.00
    unrealizedPnlPaise: 700000, // +₹7,000.00
    realizedPnlPaise: 0,
    quoteTimestamp: "2026-11-18T11:00:00.000Z",
    quoteAgeMs: 50,
    isQuoteStale: false,
    isTradable: true,
  },
  {
    instrumentId: "664000000000000000000021",
    symbol: "TCS",
    exchange: "NSE",
    quantity: 0, // Fully sold position
    averageBuyPricePaise: 350000,
    totalInvestedPaise: 0,
    lastPricePaise: 360000,
    bidPricePaise: 359900,
    askPricePaise: 360100,
    currentMarketValuePaise: 0,
    unrealizedPnlPaise: 0,
    realizedPnlPaise: 250000, // +₹2,500.00 realized
    quoteTimestamp: "2026-11-18T10:30:00.000Z",
    quoteAgeMs: 25000,
    isQuoteStale: true, // Quote is marked stale
    isTradable: true,
  },
];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TestAuthHelper: React.FC = () => {
  const { setToken } = useAuth();
  return (
    <div>
      <button onClick={() => setToken("jwt-token-1")}>Login</button>
      <button onClick={() => setToken("jwt-token-user-a")}>Login User A</button>
      <button onClick={() => setToken("jwt-token-user-b")}>Login User B</button>
      <button onClick={() => setToken(null)}>Logout</button>
    </div>
  );
};

const TestActionsHelper: React.FC = () => {
  const { refreshAll, refreshPortfolio } = usePortfolio();
  return (
    <div>
      <button onClick={() => refreshAll()}>Trigger RefreshAll</button>
      <button onClick={() => refreshPortfolio()}>Trigger RefreshPortfolio</button>
    </div>
  );
};

const renderWithProviders = (component: React.ReactNode) => {
  return render(
    <AuthProvider>
      <PortfolioProvider>
        <TestAuthHelper />
        <TestActionsHelper />
        {component}
      </PortfolioProvider>
    </AuthProvider>
  );
};

describe("Holdings Component Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders unauthenticated state when user is not logged in", () => {
    renderWithProviders(<Holdings />);
    expect(screen.getByText("Holdings (0)")).toBeInTheDocument();
    expect(screen.getByText("No Holdings Found")).toBeInTheDocument();
    expect(
      screen.getByText(/Session token required to view portfolio holdings/)
    ).toBeInTheDocument();
  });

  test("filters positions with quantity > 0 and displays holding metrics", async () => {
    jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: mockSummary,
        positions: mockPositions,
        activePositionsCount: 1,
      },
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Holdings />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(screen.getByText("Holdings (1)")).toBeInTheDocument();
    });

    // INFY is present (qty = 100)
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("₹1,850.00")).toBeInTheDocument();
    expect(screen.getAllByText("₹1,85,000.00").length).toBe(2);

    // TCS is NOT in holdings because qty == 0
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
  });
});

describe("Positions Component Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders active positions and quote staleness indicators", async () => {
    jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: mockSummary,
        positions: mockPositions,
        activePositionsCount: 2,
      },
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Positions />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(screen.getByText("Positions (2)")).toBeInTheDocument();
    });

    // INFY position
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();

    // TCS position with STALE quote indicator
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });

  test("renders empty state when positions list is empty", async () => {
    jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: { ...mockSummary, activePositionsCount: 0 },
        positions: [],
        activePositionsCount: 0,
      },
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Positions />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(screen.getByText("No Open Positions")).toBeInTheDocument();
    });
  });
});

describe("Funds Component Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("displays verified practice account numbers and balances without mock fallbacks", async () => {
    jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: mockSummary,
        positions: mockPositions,
        activePositionsCount: 2,
      },
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Funds />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Practice Account #1001 • Status: ACTIVE/)
      ).toBeInTheDocument();
    });

    // Available cash balance: ₹8,15,000.00
    expect(screen.getByText("₹8,15,000.00")).toBeInTheDocument();

    // Used margin: ₹1,85,000.00
    expect(screen.getByText("₹1,85,000.00")).toBeInTheDocument();

    // Opening balance: ₹10,00,000.00
    expect(screen.getByText("₹10,00,000.00")).toBeInTheDocument();

    // Realized P&L: +₹2,500.00
    expect(screen.getByText("+₹2,500.00")).toBeInTheDocument();

    // Unrealized P&L: +₹7,000.00
    expect(screen.getByText("+₹7,000.00")).toBeInTheDocument();

    // Total P&L: +₹9,500.00
    expect(screen.getByText("+₹9,500.00")).toBeInTheDocument();

    // Verify absence of fake "Add Funds" button
    expect(
      screen.queryByRole("button", { name: /Add Funds/i })
    ).not.toBeInTheDocument();
  });

  test("clears funds data on logout immediately", async () => {
    jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: mockSummary,
        positions: mockPositions,
        activePositionsCount: 2,
      },
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Funds />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    await waitFor(() => {
      expect(screen.getByText("₹8,15,000.00")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Logout"));
    });

    // Balance values must be cleared and replaced with "—" or unauthenticated message
    expect(screen.queryByText("₹8,15,000.00")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Sign in with a session token to view active account funds/)
    ).toBeInTheDocument();
  });
});

describe("PortfolioContext — Asynchronous Authentication-Session Concurrency & Race Suites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("User A -> User B switch while portfolio request is pending executes B without waiting and discards A", async () => {
    const deferredA = createDeferred<any>();
    const deferredB = createDeferred<any>();

    let callCount = 0;
    const getPortfolioSpy = jest.spyOn(PortfolioApi, "getPortfolio").mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? deferredA.promise : deferredB.promise;
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Holdings />);

    // Step A: User A logs in
    await act(async () => {
      fireEvent.click(screen.getByText("Login User A"));
    });

    expect(getPortfolioSpy).toHaveBeenCalledTimes(1);

    // Step B: User B logs in before A's request completes
    await act(async () => {
      fireEvent.click(screen.getByText("Login User B"));
    });

    // Step C: User B's request executes without waiting for A (no global boolean lock)
    expect(getPortfolioSpy).toHaveBeenCalledTimes(2);

    // Step D: User B's request completes first
    const userBPortfolio: PortfolioResponseData = {
      practiceAccountId: "acc-user-b",
      summary: {
        practiceAccountId: "acc-user-b",
        accountNumber: 2002,
        cashBalancePaise: 50000000,
        totalInvestedPaise: 10000000,
        currentMarketValuePaise: 12000000,
        unrealizedPnlPaise: 2000000,
        realizedPnlPaise: 0,
        totalPnlPaise: 2000000,
        activePositionsCount: 1,
        hasStaleQuotes: false,
      },
      positions: [
        {
          instrumentId: "664000000000000000000030",
          symbol: "TATAMOTORS",
          exchange: "NSE",
          quantity: 50,
          averageBuyPricePaise: 100000,
          totalInvestedPaise: 5000000,
          lastPricePaise: 110000,
          bidPricePaise: 109950,
          askPricePaise: 110050,
          currentMarketValuePaise: 5500000,
          unrealizedPnlPaise: 500000,
          realizedPnlPaise: 0,
          quoteTimestamp: "2026-11-18T12:00:00.000Z",
          quoteAgeMs: 50,
          isQuoteStale: false,
          isTradable: true,
        },
      ],
      activePositionsCount: 1,
    };

    await act(async () => {
      deferredB.resolve({
        success: true,
        data: userBPortfolio,
      });
    });

    // Verify User B's data renders
    await waitFor(() => {
      expect(screen.getByText("TATAMOTORS")).toBeInTheDocument();
      expect(screen.getByText("50")).toBeInTheDocument();
    });

    // Step E: User A's delayed request finishes now
    await act(async () => {
      deferredA.resolve({
        success: true,
        data: {
          practiceAccountId: "acc-user-a",
          summary: mockSummary,
          positions: mockPositions,
          activePositionsCount: 1,
        },
      });
    });

    // User A's response must NOT overwrite User B's data
    expect(screen.getByText("TATAMOTORS")).toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
  });

  test("logout during pending portfolio fetch immediately clears data and discards delayed result", async () => {
    const deferred = createDeferred<any>();
    jest.spyOn(PortfolioApi, "getPortfolio").mockReturnValue(deferred.promise);
    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Holdings />);

    // Login User A
    await act(async () => {
      fireEvent.click(screen.getByText("Login User A"));
    });

    // Logout while request is in-flight
    await act(async () => {
      fireEvent.click(screen.getByText("Logout"));
    });

    // Must immediately be unauthenticated
    expect(screen.getByText("No Holdings Found")).toBeInTheDocument();
    expect(
      screen.getByText(/Session token required to view portfolio holdings/)
    ).toBeInTheDocument();

    // Now resolve the delayed response
    await act(async () => {
      deferred.resolve({
        success: true,
        data: {
          practiceAccountId: "acc-1",
          summary: mockSummary,
          positions: mockPositions,
          activePositionsCount: 1,
        },
      });
    });

    // Must still remain unauthenticated and empty
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
    expect(screen.getByText("No Holdings Found")).toBeInTheDocument();
  });

  test("newer request loading-state protection: older request completion does not clear loading for pending newer request", async () => {
    const deferred1 = createDeferred<any>();
    const deferred2 = createDeferred<any>();

    let count = 0;
    jest.spyOn(PortfolioApi, "getPortfolio").mockImplementation(() => {
      count += 1;
      return count === 1 ? deferred1.promise : deferred2.promise;
    });

    jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Holdings />);

    // Login starts request 1
    await act(async () => {
      fireEvent.click(screen.getByText("Login User A"));
    });

    // Trigger second request (request 2)
    await act(async () => {
      fireEvent.click(screen.getByText("Trigger RefreshPortfolio"));
    });

    expect(screen.getByText("Loading holdings...")).toBeInTheDocument();

    // Resolve older request 1
    await act(async () => {
      deferred1.resolve({
        success: true,
        data: {
          practiceAccountId: "acc-old",
          summary: mockSummary,
          positions: [],
          activePositionsCount: 0,
        },
      });
    });

    // Loading indicator must STILL be present because request 2 is still pending!
    expect(screen.getByText("Loading holdings...")).toBeInTheDocument();

    // Now resolve request 2
    await act(async () => {
      deferred2.resolve({
        success: true,
        data: {
          practiceAccountId: "acc-new",
          summary: mockSummary,
          positions: [mockPositions[0]],
          activePositionsCount: 1,
        },
      });
    });

    // Loading is gone, and newest data renders
    await waitFor(() => {
      expect(screen.queryByText("Loading holdings...")).not.toBeInTheDocument();
      expect(screen.getByText("INFY")).toBeInTheDocument();
    });
  });

  test("refreshAll triggers valid synchronized fetch for active session", async () => {
    const getPortfolioSpy = jest.spyOn(PortfolioApi, "getPortfolio").mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: mockSummary,
        positions: mockPositions,
        activePositionsCount: 1,
      },
    });

    const getAccountSpy = jest.spyOn(AccountsApi, "getActiveAccount").mockResolvedValue({
      success: true,
      data: { account: mockAccount },
    });

    renderWithProviders(<Funds />);

    await act(async () => {
      fireEvent.click(screen.getByText("Login User A"));
    });

    await waitFor(() => {
      expect(screen.getByText("₹8,15,000.00")).toBeInTheDocument();
    });

    // Trigger refreshAll
    await act(async () => {
      fireEvent.click(screen.getByText("Trigger RefreshAll"));
    });

    expect(getPortfolioSpy).toHaveBeenCalledTimes(2);
    expect(getAccountSpy).toHaveBeenCalledTimes(2);
  });
});

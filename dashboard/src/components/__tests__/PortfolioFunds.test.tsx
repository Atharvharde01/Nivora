import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { PortfolioProvider } from "../../context/PortfolioContext";
import { PortfolioApi, AccountsApi } from "../../api/client";
import { Holdings } from "../Holdings";
import { Positions } from "../Positions";
import { Funds } from "../Funds";
import { PortfolioPositionDto, PortfolioSummaryDto, PracticeAccountSummaryDto } from "../../api/types";

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

const TestAuthHelper: React.FC = () => {
  const { setToken } = useAuth();
  return (
    <div>
      <button onClick={() => setToken("jwt-token-1")}>Login</button>
      <button onClick={() => setToken(null)}>Logout</button>
    </div>
  );
};

const renderWithProviders = (component: React.ReactNode) => {
  return render(
    <AuthProvider>
      <PortfolioProvider>
        <TestAuthHelper />
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

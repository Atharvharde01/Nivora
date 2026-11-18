import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider } from "../../context/MarketContext";
import { MarketApi } from "../../api/client";
import { MarketIndexSummary } from "../../api/types";
import TopBar from "../TopBar";

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

const AuthTrigger: React.FC = () => {
  const { setToken } = useAuth();
  return <button onClick={() => setToken("jwt-token")}>Login</button>;
};

describe("TopBar Component", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders NIVORA branding and index indicator pills", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    const logo = screen.getByAltText("NIVORA Logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/nivora-logo.svg");

    expect(screen.getByText("NIFTY 50")).toBeInTheDocument();
    expect(screen.getByText("SENSEX")).toBeInTheDocument();
  });

  test("formats index points and point/percent changes from backend fixed-point response", async () => {
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNifty] },
    });

    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <AuthTrigger />
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Login"));
    });

    // 2412050 / 100 = 24,120.50
    expect(screen.getByText("24,120.50")).toBeInTheDocument();
    // 12050 / 100 = +120.50, 50 / 100 = +0.50%
    expect(screen.getByText(/\+120\.50 \(\+0\.50%\)/)).toBeInTheDocument();
  });

  test("renders navigation links and dev session badge", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Markets")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("Holdings")).toBeInTheDocument();
    expect(screen.getByText("Positions")).toBeInTheDocument();
    expect(screen.getByText("Funds")).toBeInTheDocument();
    expect(screen.getByText("Apps")).toBeInTheDocument();

    expect(screen.getByText("Dev Token")).toBeInTheDocument();
  });

  test("opens DevTokenModal when session badge is clicked", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    const badge = screen.getByText("Dev Token");
    act(() => {
      fireEvent.click(badge);
    });

    expect(screen.getByText("Developer Session Token")).toBeInTheDocument();
    expect(screen.getByLabelText(/Paste JWT Bearer Token/i)).toBeInTheDocument();
  });
});

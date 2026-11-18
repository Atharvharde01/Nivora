import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { AuthProvider } from "../../context/AuthContext";
import { MarketProvider, useMarket } from "../../context/MarketContext";
import Workspace from "../Workspace";

const WindowStateTester: React.FC = () => {
  const { isBuyWindowOpen, isSellWindowOpen } = useMarket();
  return (
    <div>
      <span data-testid="buy-open">{isBuyWindowOpen ? "yes" : "no"}</span>
      <span data-testid="sell-open">{isSellWindowOpen ? "yes" : "no"}</span>
    </div>
  );
};

describe("Workspace Component", () => {
  test("renders selected instrument title, exchange pill, and action buttons", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
          <WindowStateTester />
        </MarketProvider>
      </AuthProvider>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "NIFTY 50" })
    ).toBeInTheDocument();
    expect(screen.getByText("NSE")).toBeInTheDocument();
    expect(screen.getByText("INDEX")).toBeInTheDocument();

    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();

    expect(screen.getByText("Candlestick Chart Workspace")).toBeInTheDocument();
  });

  test("renders timeframe toolbar pills (1m, 5m, 15m, 1h, 1d)", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument();
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("1d")).toBeInTheDocument();
  });

  test("clicking BUY and SELL triggers the respective order windows", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <Workspace />
          <WindowStateTester />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId("buy-open")).toHaveTextContent("no");
    act(() => {
      fireEvent.click(screen.getByText("BUY"));
    });
    expect(screen.getByTestId("buy-open")).toHaveTextContent("yes");

    act(() => {
      fireEvent.click(screen.getByText("SELL"));
    });
    expect(screen.getByTestId("sell-open")).toHaveTextContent("yes");
  });
});

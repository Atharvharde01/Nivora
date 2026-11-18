import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../context/AuthContext";
import { MarketProvider, useMarket } from "../../context/MarketContext";
import WatchList from "../WatchList";

const SelectedTester: React.FC = () => {
  const { selectedInstrument } = useMarket();
  return <div data-testid="active-symbol">{selectedInstrument.symbol}</div>;
};

describe("WatchList Component", () => {
  test("renders pinned indices, search input, and watchlist items", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
            <SelectedTester />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    // Pinned indices header
    expect(screen.getByText("INDICES")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search eg: infy, bse, nifty, reliance")
    ).toBeInTheDocument();

    // Seed instruments should be present
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });

  test("selects an instrument on click without page reload", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
            <SelectedTester />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    const infyItem = screen.getByText("INFY");
    act(() => {
      fireEvent.click(infyItem);
    });

    expect(screen.getByTestId("active-symbol")).toHaveTextContent("INFY");
  });

  test("renders watchlist pagination tabs 1 to 5", () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <WatchList />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});

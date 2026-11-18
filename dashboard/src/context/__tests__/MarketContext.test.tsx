import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../AuthContext";
import { MarketProvider, useMarket } from "../MarketContext";

const MarketConsumer: React.FC = () => {
  const {
    selectedInstrument,
    selectInstrument,
    isBuyWindowOpen,
    isSellWindowOpen,
    openBuyWindow,
    openSellWindow,
    closeActionWindows,
  } = useMarket();

  return (
    <div>
      <span data-testid="selected-symbol">{selectedInstrument.symbol}</span>
      <span data-testid="selected-type">{selectedInstrument.type}</span>
      <span data-testid="buy-window">{isBuyWindowOpen ? "open" : "closed"}</span>
      <span data-testid="sell-window">{isSellWindowOpen ? "open" : "closed"}</span>

      <button
        onClick={() =>
          selectInstrument({
            symbol: "RELIANCE",
            name: "Reliance Industries Ltd",
            type: "equity",
            exchange: "NSE",
            lastPricePaise: 250000,
          })
        }
      >
        Select Reliance
      </button>

      <button onClick={() => openBuyWindow()}>Open Buy</button>
      <button onClick={() => openSellWindow()}>Open Sell</button>
      <button onClick={() => closeActionWindows()}>Close Windows</button>
    </div>
  );
};

describe("MarketContext — Instrument Selection & Windows", () => {
  test("initializes with NIFTY 50 as default selected instrument", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId("selected-symbol")).toHaveTextContent("NIFTY 50");
    expect(screen.getByTestId("selected-type")).toHaveTextContent("index");
  });

  test("selects new instrument without full page reload", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    act(() => {
      userEvent.click(screen.getByText("Select Reliance"));
    });

    expect(screen.getByTestId("selected-symbol")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("selected-type")).toHaveTextContent("equity");
  });

  test("controls order action window states", () => {
    render(
      <AuthProvider>
        <MarketProvider>
          <MarketConsumer />
        </MarketProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId("buy-window")).toHaveTextContent("closed");
    expect(screen.getByTestId("sell-window")).toHaveTextContent("closed");

    act(() => {
      userEvent.click(screen.getByText("Open Buy"));
    });
    expect(screen.getByTestId("buy-window")).toHaveTextContent("open");
    expect(screen.getByTestId("sell-window")).toHaveTextContent("closed");

    act(() => {
      userEvent.click(screen.getByText("Open Sell"));
    });
    expect(screen.getByTestId("buy-window")).toHaveTextContent("closed");
    expect(screen.getByTestId("sell-window")).toHaveTextContent("open");

    act(() => {
      userEvent.click(screen.getByText("Close Windows"));
    });
    expect(screen.getByTestId("buy-window")).toHaveTextContent("closed");
    expect(screen.getByTestId("sell-window")).toHaveTextContent("closed");
  });
});

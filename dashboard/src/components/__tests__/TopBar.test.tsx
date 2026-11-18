import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../context/AuthContext";
import { MarketProvider } from "../../context/MarketContext";
import TopBar from "../TopBar";

describe("TopBar Component", () => {
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

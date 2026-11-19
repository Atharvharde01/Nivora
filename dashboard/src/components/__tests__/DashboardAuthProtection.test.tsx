/**
 * NIVORA Trading Platform — Dashboard Route Protection, DisplayName & Profile Persistence Tests
 * Verifies:
 * - DevTokenModal is completely removed from the authenticated shell
 * - Unauthenticated users are blocked from all protected routes & redirected to frontend `/signup`
 * - Valid refresh cookie restores session with displayName and renders welcome banner + topbar initials
 * - Editing displayName from My Profile updates topbar, avatar initials, and welcome banner immediately
 *   and remains persisted after dashboard reload
 * - Expired/revoked refresh cookie clears state and redirects to `/signup` without rendering protected data
 * - Logout revokes session, unmounts protected user state immediately, and redirects to `/signup`
 */

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

jest.mock("lightweight-charts", () => ({
  __esModule: true,
  createChart: jest.fn(() => ({
    addSeries: jest.fn(() => ({
      setData: jest.fn(),
      update: jest.fn(),
      applyOptions: jest.fn(),
    })),
    removeSeries: jest.fn(),
    applyOptions: jest.fn(),
    remove: jest.fn(),
    timeScale: jest.fn(() => ({
      fitContent: jest.fn(),
      applyOptions: jest.fn(),
    })),
    subscribeCrosshairMove: jest.fn(),
    unsubscribeCrosshairMove: jest.fn(),
  })),
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0 },
}));

import Home from "../Home";
import {
  AccountsApi,
  AuthApi,
  getFrontendSignupUrl,
  MarketApi,
  PortfolioApi,
  resetRefreshDeduplicationForTesting,
  UserProfileApi,
  WatchlistApi,
} from "../../api/client";

function mockProtectedDataApis() {
  const indicesSpy = jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
    success: true,
    data: { items: [] },
  });
  const watchlistSpy = jest
    .spyOn(WatchlistApi, "getWatchlist")
    .mockResolvedValue({
      success: true,
      data: { items: [], count: 0 },
    });
  const portfolioSpy = jest
    .spyOn(PortfolioApi, "getPortfolio")
    .mockResolvedValue({
      success: true,
      data: {
        practiceAccountId: "acc-1",
        summary: {
          practiceAccountId: "acc-1",
          accountNumber: 1,
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
  const accountSpy = jest
    .spyOn(AccountsApi, "getActiveAccount")
    .mockResolvedValue({
      success: true,
      data: {
        account: {
          accountId: "acc-1",
          userId: "user-1",
          accountNumber: 1,
          status: "ACTIVE",
          initialBalancePaise: 100000000,
          cashBalancePaise: 100000000,
          version: 1,
          createdAt: "2026-11-19T00:00:00.000Z",
          updatedAt: "2026-11-19T00:00:00.000Z",
        },
      },
    });
  const indexCandlesSpy = jest
    .spyOn(MarketApi, "getIndexCandles")
    .mockResolvedValue({
      success: true,
      data: {
        index: {
          _id: "idx-1",
          symbol: "NIFTY50",
          name: "NIFTY 50",
          description: "Synthetic",
          currentValue: 2400000,
          baseValue: 2400000,
          previousCloseValue: 2400000,
          changeValue: 0,
          changeBps: 0,
          constituentCount: 50,
          methodology: "EQUAL_WEIGHTED_CONSTITUENT_BASKET",
          source: "SIMULATED",
          valueUpdatedAt: "2026-11-19T00:00:00.000Z",
        },
        interval: "1d",
        candles: [],
      },
    });

  return { indicesSpy, watchlistSpy, portfolioSpy, accountSpy, indexCandlesSpy };
}

describe("Dashboard Protected Routes, DisplayName & Session Lifecycle", () => {
  beforeEach(() => {
    resetRefreshDeduplicationForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetRefreshDeduplicationForTesting();
  });

  test("redirects unauthenticated user to frontend /signup and never renders protected data or fires protected APIs", async () => {
    const { indicesSpy, watchlistSpy, portfolioSpy, accountSpy } =
      mockProtectedDataApis();
    jest
      .spyOn(AuthApi, "refresh")
      .mockRejectedValue(new Error("No active session cookie."));
    const redirectSpy = jest.fn();

    render(
      <MemoryRouter initialEntries={["/funds"]}>
        <Home onRedirectToSignup={redirectSpy} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-redirect-screen")).toBeInTheDocument();
      expect(redirectSpy).toHaveBeenCalledWith(getFrontendSignupUrl());
    });

    // Zero protected UI rendered and zero protected APIs invoked
    expect(screen.queryByText("Funds & Practice Margins")).not.toBeInTheDocument();
    expect(screen.queryByText("Dev Token")).not.toBeInTheDocument();
    expect(indicesSpy).not.toHaveBeenCalled();
    expect(watchlistSpy).not.toHaveBeenCalled();
    expect(portfolioSpy).not.toHaveBeenCalled();
    expect(accountSpy).not.toHaveBeenCalled();
  });

  test("restores session with displayName, renders welcome message, updates name live from My Profile, and preserves after reload", async () => {
    const { portfolioSpy, accountSpy } = mockProtectedDataApis();

    let serverPersistedName = "Atharv Harde";

    jest.spyOn(AuthApi, "refresh").mockImplementation(async () => ({
      success: true,
      accessToken: "restored-access-jwt",
      user: {
        id: "user-1",
        userId: "user-1",
        email: "atharv@nivora.in",
        emailVerifiedAt: "2026-11-19T00:00:00.000Z",
        displayName: serverPersistedName,
        status: "ACTIVE",
        onboardingCompleted: true,
      },
      session: {
        id: "sess-1",
        status: "ACTIVE",
        idleExpiresAt: "2026-11-26T00:00:00.000Z",
        absoluteExpiresAt: "2026-12-19T00:00:00.000Z",
      },
    }));

    jest
      .spyOn(UserProfileApi, "updateProfile")
      .mockImplementation(async ({ displayName }) => {
        serverPersistedName = displayName;
        return {
          success: true,
          data: {
            user: {
              id: "user-1",
              userId: "user-1",
              email: "atharv@nivora.in",
              emailVerifiedAt: "2026-11-19T00:00:00.000Z",
              displayName: serverPersistedName,
              status: "ACTIVE",
              onboardingCompleted: true,
            },
          },
        };
      });

    const redirectSpy = jest.fn();

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Home onRedirectToSignup={redirectSpy} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-display-name")).toHaveTextContent(
        "Atharv Harde"
      );
      expect(screen.getByTestId("user-avatar-initials")).toHaveTextContent("AH");
      expect(screen.getByTestId("dashboard-welcome-banner")).toHaveTextContent(
        /Good (morning|afternoon|evening), Atharv Harde!/
      );
      expect(screen.queryByText("atharv@nivora.in")).not.toBeInTheDocument();
      expect(screen.getByText("Welcome back to NIVORA.")).toBeInTheDocument();
      expect(portfolioSpy).toHaveBeenCalled();
      expect(accountSpy).toHaveBeenCalled();
    });

    // Update name via My Profile modal -> auto-closes modal, shows outside toast, updates UI immediately
    fireEvent.click(screen.getByTestId("user-profile-indicator"));
    fireEvent.click(screen.getByRole("menuitem", { name: /My Profile/i }));

    expect(screen.getByTestId("profile-modal")).toBeInTheDocument();
    const emailField = screen.getByLabelText("Email Address");
    expect(emailField).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("Full Name"), {
      target: { value: "Vikram Desai" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });

    // Modal closed automatically and outside success toast shown
    expect(screen.queryByTestId("profile-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-success-toast")).toHaveTextContent(
      /Display name updated to Vikram Desai/i
    );

    // Reflected immediately across topbar, initials, and welcome banner
    expect(screen.getByTestId("user-display-name")).toHaveTextContent(
      "Vikram Desai"
    );
    expect(screen.getByTestId("user-avatar-initials")).toHaveTextContent("VD");
    expect(screen.getByTestId("dashboard-welcome-banner")).toHaveTextContent(
      /Good (morning|afternoon|evening), Vikram Desai!/
    );

    // Simulate full browser reload (unmount + fresh Home mount reading from POST /auth/refresh)
    unmount();
    resetRefreshDeduplicationForTesting();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Home onRedirectToSignup={redirectSpy} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-display-name")).toHaveTextContent(
        "Vikram Desai"
      );
      expect(screen.getByTestId("user-avatar-initials")).toHaveTextContent("VD");
      expect(screen.getByTestId("dashboard-welcome-banner")).toHaveTextContent(
        /Good (morning|afternoon|evening), Vikram Desai!/
      );
    });

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Dev Token")).not.toBeInTheDocument();
  });

  test("logout invalidates server session, unmounts protected views immediately, and redirects to /signup", async () => {
    const { portfolioSpy, accountSpy } = mockProtectedDataApis();
    jest.spyOn(AuthApi, "refresh").mockResolvedValue({
      success: true,
      accessToken: "active-session-jwt",
      user: {
        id: "user-1",
        email: "active@nivora.in",
        displayName: "Atharv Harde",
        status: "ACTIVE",
      },
      session: {
        id: "sess-1",
        status: "ACTIVE",
        idleExpiresAt: "2026-11-26T00:00:00.000Z",
        absoluteExpiresAt: "2026-12-19T00:00:00.000Z",
      },
    });
    const logoutSpy = jest.spyOn(AuthApi, "logout").mockResolvedValue({
      success: true,
      message: "Logged out successfully.",
    });
    const redirectSpy = jest.fn();

    render(
      <MemoryRouter initialEntries={["/funds"]}>
        <Home onRedirectToSignup={redirectSpy} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Funds & Practice Margins")).toBeInTheDocument();
      expect(portfolioSpy).toHaveBeenCalled();
      expect(accountSpy).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("user-profile-indicator"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Logout/i }));
    });

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith(getFrontendSignupUrl());
    // Protected views immediately unmounted — no stale portfolio data visible
    expect(screen.queryByText("Funds & Practice Margins")).not.toBeInTheDocument();
    expect(screen.queryByText("Atharv Harde")).not.toBeInTheDocument();
  });

  test("handles expired refresh session cleanly without rendering stale protected data", async () => {
    mockProtectedDataApis();
    jest.spyOn(AuthApi, "refresh").mockRejectedValue({
      response: {
        status: 401,
        data: {
          success: false,
          error: {
            code: "SESSION_EXPIRED",
            message: "Session expired.",
          },
        },
      },
    });
    const redirectSpy = jest.fn();

    render(
      <MemoryRouter initialEntries={["/orders"]}>
        <Home onRedirectToSignup={redirectSpy} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-redirect-screen")).toBeInTheDocument();
      expect(redirectSpy).toHaveBeenCalledWith(getFrontendSignupUrl());
    });

    expect(screen.queryByText(/Order History/i)).not.toBeInTheDocument();
  });
});

import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { MarketProvider } from "../../context/MarketContext";
import {
  AuthApi,
  getFrontendSignupUrl,
  MarketApi,
  resetRefreshDeduplicationForTesting,
  UserProfileApi,
} from "../../api/client";
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
  return <button onClick={() => setToken("jwt-token")}>Authenticate</button>;
};

describe("TopBar Component", () => {
  beforeEach(() => {
    resetRefreshDeduplicationForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetRefreshDeduplicationForTesting();
  });

  test("renders NIVORA branding and index indicator pills", () => {
    render(
      <BrowserRouter>
        <AuthProvider autoBootstrap={false}>
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
        <AuthProvider autoBootstrap={false}>
          <MarketProvider>
            <AuthTrigger />
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Authenticate"));
    });

    // 2412050 / 100 = 24,120.50
    expect(screen.getByText("24,120.50")).toBeInTheDocument();
    // 12050 / 100 = +120.50, 50 / 100 = +0.50%
    expect(screen.getByText(/\+120\.50 \(\+0\.50%\)/)).toBeInTheDocument();
  });

  test("displays displayName (not email), auto-closes My Profile modal on save with outside toast, keeps modal open on failure, and logs out to /signup", async () => {
    jest.spyOn(MarketApi, "getIndices").mockResolvedValue({
      success: true,
      data: { items: [mockNifty] },
    });
    jest.spyOn(AuthApi, "refresh").mockResolvedValue({
      success: true,
      accessToken: "jwt-real-session",
      user: {
        id: "user-42",
        userId: "user-42",
        email: "atharv@nivora.in",
        emailVerifiedAt: "2026-11-19T00:00:00.000Z",
        displayName: "Atharv Harde",
        status: "ACTIVE",
        onboardingCompleted: true,
      },
      session: {
        id: "sess-42",
        status: "ACTIVE",
        idleExpiresAt: "2026-11-26T00:00:00.000Z",
        absoluteExpiresAt: "2026-12-19T00:00:00.000Z",
      },
    });
    const patchSpy = jest
      .spyOn(UserProfileApi, "updateProfile")
      .mockRejectedValueOnce(new Error("Temporary server error. Please retry."))
      .mockResolvedValueOnce({
        success: true,
        data: {
          user: {
            id: "user-42",
            userId: "user-42",
            email: "atharv@nivora.in",
            emailVerifiedAt: "2026-11-19T00:00:00.000Z",
            displayName: "Neha Kulkarni",
            status: "ACTIVE",
            onboardingCompleted: true,
          },
        },
      });
    const logoutSpy = jest.spyOn(AuthApi, "logout").mockResolvedValue({
      success: true,
      message: "Logged out successfully.",
    });
    const redirectSpy = jest.fn();

    render(
      <BrowserRouter>
        <AuthProvider onRedirectToSignup={redirectSpy}>
          <MarketProvider>
            <TopBar />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    );

    // Displays displayName & initials instead of email
    await waitFor(() => {
      expect(screen.getByTestId("user-display-name")).toHaveTextContent(
        "Atharv Harde"
      );
      expect(screen.getByTestId("user-avatar-initials")).toHaveTextContent("AH");
    });
    expect(screen.queryByText("atharv@nivora.in")).not.toBeInTheDocument();

    // DevTokenModal must no longer exist
    expect(screen.queryByText("Dev Token")).not.toBeInTheDocument();
    expect(screen.queryByText("Developer Session Token")).not.toBeInTheDocument();

    // Open user menu -> My Profile
    fireEvent.click(screen.getByTestId("user-profile-indicator"));
    expect(screen.getByTestId("user-menu-dropdown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /My Profile/i }));

    // Profile modal opens with editable Full Name and read-only Verified email
    expect(screen.getByTestId("profile-modal")).toBeInTheDocument();
    const emailField = screen.getByLabelText("Email Address");
    expect(emailField).toHaveValue("atharv@nivora.in");
    expect(emailField).toHaveAttribute("readonly");
    expect(screen.getByTestId("email-verified-badge")).toHaveTextContent(
      "Verified"
    );

    const nameField = screen.getByLabelText("Full Name");
    expect(nameField).toHaveValue("Atharv Harde");

    // Client-side validation error keeps modal open
    fireEvent.change(nameField, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("Full name cannot be empty.")).toBeInTheDocument();
    expect(screen.getByTestId("profile-modal")).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();

    // Failed API save keeps modal open, preserves user input, shows error, and allows retry
    fireEvent.change(nameField, { target: { value: "  Neha   Kulkarni  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("profile-modal")).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name")).toHaveValue("  Neha   Kulkarni  ");
    expect(
      screen.getByText("Temporary server error. Please retry.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("profile-success-toast")).not.toBeInTheDocument();

    // Retry succeeds -> updates topbar & initials, auto-closes modal, shows outside toast
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });

    expect(patchSpy).toHaveBeenCalledTimes(2);
    expect(patchSpy).toHaveBeenLastCalledWith({ displayName: "Neha Kulkarni" });
    expect(screen.queryByTestId("profile-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-success-toast")).toHaveTextContent(
      /Display name updated to Neha Kulkarni/i
    );
    expect(screen.getByTestId("user-display-name")).toHaveTextContent(
      "Neha Kulkarni"
    );
    expect(screen.getByTestId("user-avatar-initials")).toHaveTextContent("NK");

    // Open menu, click Logout -> redirects to /signup
    fireEvent.click(screen.getByTestId("user-profile-indicator"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Logout/i }));
    });

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith(getFrontendSignupUrl());
  });
});

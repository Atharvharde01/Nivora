import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../AuthContext";
import {
  AuthApi,
  getFrontendSignupUrl,
  resetRefreshDeduplicationForTesting,
  UserProfileApi,
} from "../../api/client";

const TestConsumer: React.FC = () => {
  const {
    token,
    user,
    authStatus,
    isAuthenticated,
    setToken,
    clearToken,
    updateUserDisplayName,
    logout,
  } = useAuth();

  return (
    <div>
      <span data-testid="auth-status">{authStatus}</span>
      <span data-testid="is-auth">
        {isAuthenticated ? "authenticated" : "unauthenticated"}
      </span>
      <span data-testid="token-val">{token || "none"}</span>
      <span data-testid="user-email">{user?.email || "none"}</span>
      <span data-testid="user-name">{user?.displayName || "none"}</span>

      <button onClick={() => setToken("test-jwt-token")}>Set Token</button>
      <button onClick={() => clearToken()}>Clear Token</button>
      <button onClick={() => void updateUserDisplayName("Riya Sharma")}>
        Update Name
      </button>
      <button onClick={() => void logout()}>Logout</button>
    </div>
  );
};

describe("AuthContext — Production In-Memory JWT, Refresh Cookie & DisplayName Lifecycle", () => {
  beforeEach(() => {
    resetRefreshDeduplicationForTesting();
    jest.spyOn(Storage.prototype, "getItem");
    jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetRefreshDeduplicationForTesting();
  });

  test("bootstraps unauthenticated cleanly when no active refresh cookie exists, with zero persistent storage access", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "unauthenticated"
      );
    });
    expect(screen.getByTestId("is-auth")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("none");

    // Architectural invariant: NEVER access localStorage or sessionStorage
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test("restores session with displayName on reload via backend POST /auth/refresh without touching localStorage", async () => {
    const refreshSpy = jest.spyOn(AuthApi, "refresh").mockResolvedValue({
      success: true,
      accessToken: "fresh-refreshed-jwt",
      user: {
        id: "user-1",
        userId: "user-1",
        email: "trader@nivora.in",
        displayName: "Atharv Harde",
        emailVerifiedAt: "2026-11-19T00:00:00.000Z",
        status: "ACTIVE",
        onboardingCompleted: true,
      },
      session: {
        id: "sess-1",
        status: "ACTIVE",
        idleExpiresAt: "2026-11-26T00:00:00.000Z",
        absoluteExpiresAt: "2026-12-19T00:00:00.000Z",
      },
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "authenticated"
      );
    });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("token-val")).toHaveTextContent(
      "fresh-refreshed-jwt"
    );
    expect(screen.getByTestId("user-email")).toHaveTextContent(
      "trader@nivora.in"
    );
    expect(screen.getByTestId("user-name")).toHaveTextContent("Atharv Harde");
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test("updateUserDisplayName calls PATCH /api/v1/users/me/profile and immediately updates AuthContext user", async () => {
    jest.spyOn(AuthApi, "refresh").mockResolvedValue({
      success: true,
      accessToken: "session-jwt",
      user: {
        id: "user-1",
        email: "trader@nivora.in",
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

    const patchSpy = jest
      .spyOn(UserProfileApi, "updateProfile")
      .mockResolvedValue({
        success: true,
        data: {
          user: {
            id: "user-1",
            userId: "user-1",
            email: "trader@nivora.in",
            displayName: "Riya Sharma",
            status: "ACTIVE",
          },
        },
      });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-name")).toHaveTextContent("Atharv Harde");
    });

    await act(async () => {
      userEvent.click(screen.getByText("Update Name"));
    });

    expect(patchSpy).toHaveBeenCalledWith({ displayName: "Riya Sharma" });
    expect(screen.getByTestId("user-name")).toHaveTextContent("Riya Sharma");
    expect(screen.getByTestId("user-email")).toHaveTextContent(
      "trader@nivora.in"
    );
  });

  test("updates and clears token strictly in memory", async () => {
    render(
      <AuthProvider autoBootstrap={false}>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      userEvent.click(screen.getByText("Set Token"));
    });

    expect(screen.getByTestId("is-auth")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("test-jwt-token");

    act(() => {
      userEvent.click(screen.getByText("Clear Token"));
    });

    expect(screen.getByTestId("is-auth")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("none");
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test("logout calls backend POST /auth/logout, clears in-memory auth state, and redirects to frontend /signup", async () => {
    jest.spyOn(AuthApi, "refresh").mockResolvedValue({
      success: true,
      accessToken: "session-jwt",
      user: {
        id: "user-1",
        email: "trader@nivora.in",
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
      <AuthProvider onRedirectToSignup={redirectSpy}>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "authenticated"
      );
    });

    await act(async () => {
      userEvent.click(screen.getByText("Logout"));
    });

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("auth-status")).toHaveTextContent(
      "unauthenticated"
    );
    expect(screen.getByTestId("token-val")).toHaveTextContent("none");
    expect(screen.getByTestId("user-email")).toHaveTextContent("none");
    expect(screen.getByTestId("user-name")).toHaveTextContent("none");
    expect(redirectSpy).toHaveBeenCalledWith(getFrontendSignupUrl());
    expect(getFrontendSignupUrl()).toMatch(/\/signup$/);
  });
});

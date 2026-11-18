import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../AuthContext";

const TestConsumer: React.FC = () => {
  const {
    token,
    isAuthenticated,
    setToken,
    clearToken,
    isTokenModalOpen,
    openTokenModal,
    closeTokenModal,
  } = useAuth();

  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? "authenticated" : "unauthenticated"}</span>
      <span data-testid="token-val">{token || "none"}</span>
      <span data-testid="modal-status">{isTokenModalOpen ? "open" : "closed"}</span>

      <button onClick={() => setToken("test-jwt-token")}>Set Token</button>
      <button onClick={() => clearToken()}>Clear Token</button>
      <button onClick={() => openTokenModal()}>Open Modal</button>
      <button onClick={() => closeTokenModal()}>Close Modal</button>
    </div>
  );
};

describe("AuthContext — Pure React Memory Authentication", () => {
  beforeEach(() => {
    // Spy on storage to ensure ZERO persistent storage access
    jest.spyOn(Storage.prototype, "getItem");
    jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("initializes with unauthenticated status and no persistent storage access", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("none");

    // Verification of architectural constraint: NEVER access localStorage
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test("updates token strictly in memory when setToken is called", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      userEvent.click(screen.getByText("Set Token"));
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("test-jwt-token");

    // Must still NOT touch persistent storage
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test("clears token when clearToken is called", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      userEvent.click(screen.getByText("Set Token"));
    });
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");

    act(() => {
      userEvent.click(screen.getByText("Clear Token"));
    });
    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("token-val")).toHaveTextContent("none");
  });

  test("toggles dev token modal visibility", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("modal-status")).toHaveTextContent("closed");

    act(() => {
      userEvent.click(screen.getByText("Open Modal"));
    });
    expect(screen.getByTestId("modal-status")).toHaveTextContent("open");

    act(() => {
      userEvent.click(screen.getByText("Close Modal"));
    });
    expect(screen.getByTestId("modal-status")).toHaveTextContent("closed");
  });
});

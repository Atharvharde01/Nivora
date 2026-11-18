/**
 * NIVORA Trading Platform — Development Authentication Context
 * Manages access token strictly in React memory (useState).
 * NEVER persists tokens to localStorage, sessionStorage, or cookies.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setOnUnauthorized, setTokenGetter } from "../api/client";

export interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  setToken: (newToken: string | null) => void;
  clearToken: () => void;
  isTokenModalOpen: boolean;
  openTokenModal: () => void;
  closeTokenModal: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  token: null,
  isAuthenticated: false,
  setToken: () => {},
  clearToken: () => {},
  isTokenModalOpen: false,
  openTokenModal: () => {},
  closeTokenModal: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Pure in-memory state: not written to or read from localStorage/cookies
  const [token, setTokenState] = useState<string | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState<boolean>(false);

  // Keep a mutable ref so Axios interceptor always reads the freshest value synchronously
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  const setToken = useCallback((newToken: string | null) => {
    const sanitized = newToken && newToken.trim().length > 0 ? newToken.trim() : null;
    tokenRef.current = sanitized;
    setTokenState(sanitized);
  }, []);

  const clearToken = useCallback(() => {
    tokenRef.current = null;
    setTokenState(null);
  }, []);

  const openTokenModal = useCallback(() => {
    setIsTokenModalOpen(true);
  }, []);

  const closeTokenModal = useCallback(() => {
    setIsTokenModalOpen(false);
  }, []);

  useEffect(() => {
    // Register token getter with API client
    setTokenGetter(() => tokenRef.current);

    // When backend returns 401 Unauthorized, automatically clear token
    setOnUnauthorized(() => {
      clearToken();
    });
  }, [clearToken]);

  const value = useMemo<AuthContextType>(
    () => ({
      token,
      isAuthenticated: Boolean(token && token.length > 0),
      setToken,
      clearToken,
      isTokenModalOpen,
      openTokenModal,
      closeTokenModal,
    }),
    [token, setToken, clearToken, isTokenModalOpen, openTokenModal, closeTokenModal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default AuthContext;

/**
 * NIVORA Trading Platform — Production Authentication Context
 * Manages short-lived JWT access token and authenticated user profile strictly in React memory.
 * Bootstraps and recovers sessions via the backend HttpOnly refresh_token cookie + XSRF-TOKEN CSRF header.
 * NEVER persists tokens to localStorage, sessionStorage, or URL parameters.
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
import {
  AuthApi,
  getFrontendSignupUrl,
  setOnUnauthorized,
  setTokenGetter,
  setTokenRefresher,
  UserProfileApi,
} from "../api/client";
import { AuthUserDto } from "../api/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextType {
  token: string | null;
  user: AuthUserDto | null;
  authStatus: AuthStatus;
  isAuthenticated: boolean;
  isLoggingOut: boolean;
  setToken: (newToken: string | null) => void;
  clearToken: () => void;
  refreshSession: () => Promise<string | null>;
  updateUserDisplayName: (displayName: string) => Promise<AuthUserDto>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  authStatus: "loading",
  isAuthenticated: false,
  isLoggingOut: false,
  setToken: () => {},
  clearToken: () => {},
  refreshSession: async () => null,
  updateUserDisplayName: async () => {
    throw new Error("AuthProvider is not mounted.");
  },
  logout: async () => {},
});

export interface AuthProviderProps {
  children: React.ReactNode;
  autoBootstrap?: boolean;
  onRedirectToSignup?: (url: string) => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  autoBootstrap = true,
  onRedirectToSignup,
}) => {
  // Pure in-memory state: NEVER read from or written to localStorage/sessionStorage
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    autoBootstrap ? "loading" : "unauthenticated"
  );
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  // Monotonically increasing session version prevents stale bootstrap/refresh/profile responses
  // from mutating a logged-out or switched session.
  const sessionVersionRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const isLoggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setToken = useCallback((newToken: string | null) => {
    sessionVersionRef.current += 1;
    const sanitized =
      newToken && newToken.trim().length > 0 ? newToken.trim() : null;
    tokenRef.current = sanitized;
    setTokenState(sanitized);
    if (!sanitized) {
      setUser(null);
      setAuthStatus("unauthenticated");
    } else {
      setAuthStatus("authenticated");
    }
  }, []);

  const clearToken = useCallback(() => {
    sessionVersionRef.current += 1;
    tokenRef.current = null;
    setTokenState(null);
    setUser(null);
    setAuthStatus("unauthenticated");
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (isLoggingOutRef.current) {
      return null;
    }

    const requestVersion = sessionVersionRef.current;

    try {
      const response = await AuthApi.refreshDeduplicated();

      if (
        !isMountedRef.current ||
        isLoggingOutRef.current ||
        sessionVersionRef.current !== requestVersion
      ) {
        return null;
      }

      if (
        response.success &&
        response.accessToken &&
        response.accessToken.trim().length > 0
      ) {
        const freshToken = response.accessToken.trim();
        tokenRef.current = freshToken;
        setTokenState(freshToken);
        setUser(response.user ?? null);
        setAuthStatus("authenticated");
        return freshToken;
      }

      tokenRef.current = null;
      setTokenState(null);
      setUser(null);
      setAuthStatus("unauthenticated");
      return null;
    } catch {
      if (
        !isMountedRef.current ||
        sessionVersionRef.current !== requestVersion
      ) {
        return null;
      }

      tokenRef.current = null;
      setTokenState(null);
      setUser(null);
      setAuthStatus("unauthenticated");
      return null;
    }
  }, []);

  const updateUserDisplayName = useCallback(
    async (displayName: string): Promise<AuthUserDto> => {
      const requestVersion = sessionVersionRef.current;
      const response = await UserProfileApi.updateProfile({ displayName });

      if (!response.success || !response.data?.user) {
        const apiError =
          typeof response.error === "string"
            ? response.error
            : response.error?.message;
        throw new Error(apiError || "Failed to update profile name.");
      }

      const updatedUser = response.data.user;
      if (
        isMountedRef.current &&
        !isLoggingOutRef.current &&
        sessionVersionRef.current === requestVersion
      ) {
        setUser((prev) => (prev ? { ...prev, ...updatedUser } : updatedUser));
      }

      return updatedUser;
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    if (isLoggingOutRef.current) {
      return;
    }

    isLoggingOutRef.current = true;
    sessionVersionRef.current += 1;
    if (isMountedRef.current) {
      setIsLoggingOut(true);
    }

    try {
      await AuthApi.logout();
    } catch {
      // Even if server session was already revoked or expired, proceed with full local cleanup
    } finally {
      tokenRef.current = null;
      if (isMountedRef.current) {
        setTokenState(null);
        setUser(null);
        setAuthStatus("unauthenticated");
        setIsLoggingOut(false);
      }
      isLoggingOutRef.current = false;

      const signupUrl = getFrontendSignupUrl();
      if (onRedirectToSignup) {
        onRedirectToSignup(signupUrl);
      } else if (typeof window !== "undefined" && window.location) {
        window.location.replace(signupUrl);
      }
    }
  }, [onRedirectToSignup]);

  // Wire Axios client interceptors synchronously for active session lifecycle
  useEffect(() => {
    setTokenGetter(() => tokenRef.current);
    setTokenRefresher(() => refreshSession());
    setOnUnauthorized(() => {
      clearToken();
    });

    return () => {
      setTokenRefresher(null);
    };
  }, [clearToken, refreshSession]);

  // Bootstrap session on mount from the HttpOnly refresh_token cookie
  useEffect(() => {
    if (!autoBootstrap) {
      return;
    }
    if (tokenRef.current) {
      setAuthStatus("authenticated");
      return;
    }
    refreshSession();
  }, [autoBootstrap, refreshSession]);

  const value = useMemo<AuthContextType>(
    () => ({
      token,
      user,
      authStatus,
      isAuthenticated: Boolean(token && token.length > 0),
      isLoggingOut,
      setToken,
      clearToken,
      refreshSession,
      updateUserDisplayName,
      logout,
    }),
    [
      token,
      user,
      authStatus,
      isLoggingOut,
      setToken,
      clearToken,
      refreshSession,
      updateUserDisplayName,
      logout,
    ]
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

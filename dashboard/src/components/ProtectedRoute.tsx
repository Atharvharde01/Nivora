/**
 * NIVORA Trading Platform — Protected Route Guard
 * Ensures unauthenticated users cannot render or inspect protected dashboard views.
 * - While session bootstrap is in progress: shows a clean non-sensitive loading state.
 * - When unauthenticated: redirects to the public frontend `/signup` page (port 3000).
 * - When authenticated: renders protected dashboard children.
 */

import React, { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { getFrontendSignupUrl } from "../api/client";

export interface ProtectedRouteProps {
  children: React.ReactNode;
  onRedirectToSignup?: (url: string) => void;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  onRedirectToSignup,
}) => {
  const { authStatus, isAuthenticated } = useAuth();
  const signupUrl = getFrontendSignupUrl();

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      if (onRedirectToSignup) {
        onRedirectToSignup(signupUrl);
      } else if (typeof window !== "undefined" && window.location) {
        window.location.replace(signupUrl);
      }
    }
  }, [authStatus, signupUrl, onRedirectToSignup]);

  if (authStatus === "loading") {
    return (
      <div
        className="auth-gate-screen"
        data-testid="auth-loading-screen"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
          color: "#0f172a",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <img
          src="/nivora-logo.svg"
          alt="NIVORA"
          style={{ height: 36, marginBottom: 20 }}
        />
        <div className="spinner-ring" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: "0.95rem", color: "#475569", fontWeight: 500 }}>
          Restoring your NIVORA trading session...
        </p>
      </div>
    );
  }

  if (authStatus !== "authenticated" || !isAuthenticated) {
    return (
      <div
        className="auth-gate-screen"
        data-testid="auth-redirect-screen"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
          color: "#0f172a",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <img
          src="/nivora-logo.svg"
          alt="NIVORA"
          style={{ height: 36, marginBottom: 16 }}
        />
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 8 }}>
          Sign in required
        </h2>
        <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: 20 }}>
          Redirecting you to the NIVORA signup &amp; sign-in page...
        </p>
        <a
          href={signupUrl}
          className="btn-blue"
          style={{ textDecoration: "none", display: "inline-block" }}
        >
          Continue to NIVORA
        </a>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;

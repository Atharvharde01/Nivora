/**
 * NIVORA Trading Platform — Apps & Integrations View
 * Session security overview, API gateway status, and simulated trading services.
 */

import React from "react";
import { Terminal, Code, VerifiedUser, Speed } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { baseURL } from "../api/client";

export const Apps: React.FC = () => {
  const { isAuthenticated, user, logout, isLoggingOut } = useAuth();

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Apps &amp; Platform Services</h2>
        <p className="view-subtitle">
          Session security, API gateway connections, and market simulation telemetry
        </p>
      </div>

      <div className="apps-grid">
        {/* SESSION SECURITY CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <VerifiedUser sx={{ fontSize: 28, color: "#2563EB" }} />
            <div>
              <h3 className="app-card-title">Email OTP Session</h3>
              <span className="app-badge">Authentication</span>
            </div>
          </div>
          <p className="app-card-desc">
            {isAuthenticated && user?.email
              ? `Signed in as ${user.email}. Short-lived JWT access tokens remain in React memory and refresh via HttpOnly cookies.`
              : "Protected by passwordless email OTP authentication, rotating HttpOnly refresh cookies, and CSRF validation."}
          </p>
          <div className="app-card-footer">
            <span
              className={`api-status-pill ${isAuthenticated ? "online" : ""}`}
            >
              {isAuthenticated ? "Session Active" : "Signed Out"}
            </span>
            {isAuthenticated && (
              <button
                type="button"
                className="btn btn-blue"
                onClick={() => void logout()}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </button>
            )}
          </div>
        </div>

        {/* BACKEND API STATUS CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <Terminal sx={{ fontSize: 28, color: "#10B981" }} />
            <div>
              <h3 className="app-card-title">Backend Gateway</h3>
              <span className="app-badge">REST API</span>
            </div>
          </div>
          <p className="app-card-desc">
            Base endpoint: <code>{baseURL}</code>. Provides market candles, quotes, indices, orders, and portfolio APIs.
          </p>
          <div className="app-card-footer">
            <span className="api-status-pill online">Connected</span>
          </div>
        </div>

        {/* SIMULATION ENGINE CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <Speed sx={{ fontSize: 28, color: "#EA580C" }} />
            <div>
              <h3 className="app-card-title">Market Simulation Engine</h3>
              <span className="app-badge">24x7 Engine</span>
            </div>
          </div>
          <p className="app-card-desc">
            Continuous synthetic tick and candle generator operating on Asia/Kolkata day boundaries.
          </p>
          <div className="app-card-footer">
            <span className="api-status-pill online">Continuous Active</span>
          </div>
        </div>

        {/* PLATFORM STATUS CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <Code sx={{ fontSize: 28, color: "#8B5CF6" }} />
            <div>
              <h3 className="app-card-title">Simulated Trading Engine</h3>
              <span className="app-badge">Phase 6.1</span>
            </div>
          </div>
          <p className="app-card-desc">
            Passwordless email OTP authentication, interactive candlestick charts, Marketwatch, and atomic virtual portfolio ledger.
          </p>
          <div className="app-card-footer">
            <span className="api-status-pill online">Integrated</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Apps;

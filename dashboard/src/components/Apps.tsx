/**
 * NIVORA Trading Platform — Apps & Integrations View
 * Developer tools, API reference, and simulated trading services.
 */

import React from "react";
import { Terminal, Code, VpnKey, Speed } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { baseURL } from "../api/client";

export const Apps: React.FC = () => {
  const { openTokenModal, isAuthenticated } = useAuth();

  return (
    <div className="view-container">
      <div className="view-header">
        <h2 className="view-title">Apps & Developer Tools</h2>
        <p className="view-subtitle">Developer integrations, API connections, and system telemetry</p>
      </div>

      <div className="apps-grid">
        {/* DEV SESSION CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <VpnKey sx={{ fontSize: 28, color: "#2563EB" }} />
            <div>
              <h3 className="app-card-title">In-Memory Dev Token</h3>
              <span className="app-badge">Authentication</span>
            </div>
          </div>
          <p className="app-card-desc">
            Configure an ephemeral JWT access token in React memory to access protected API endpoints.
          </p>
          <div className="app-card-footer">
            <button type="button" className="btn btn-blue" onClick={openTokenModal}>
              {isAuthenticated ? "Manage Token" : "Enter Token"}
            </button>
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
            Base endpoint: <code>{baseURL}</code>. Provides market candles, quotes, indices, and orders.
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

        {/* ROADMAP CARD */}
        <div className="app-card">
          <div className="app-card-header">
            <Code sx={{ fontSize: 28, color: "#8B5CF6" }} />
            <div>
              <h3 className="app-card-title">Milestone 5 Next Steps</h3>
              <span className="app-badge">Roadmap</span>
            </div>
          </div>
          <p className="app-card-desc">
            Task 5.3: NIFTY 50 & SENSEX Market Overview. Task 5.4: Lightweight Candlestick Charts.
          </p>
          <div className="app-card-footer">
            <span className="api-status-pill">Milestone 5.2 Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Apps;

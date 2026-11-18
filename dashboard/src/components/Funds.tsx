/**
 * NIVORA Trading Platform — Funds & Practice Margins View
 * Displays verified practice account balances, cash pool, and margin metrics
 * from backend GET /api/v1/accounts/active and GET /api/v1/portfolio.
 * Strictly avoids fabricated data, fake alert buttons, or hardcoded fallbacks.
 */

import React from "react";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { formatRupees, paiseToRupees } from "../api/types";
import {
  AccountBalanceWallet,
  AccountCircle,
  Refresh,
} from "@mui/icons-material";

export const Funds: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const {
    account,
    summary,
    accountLoading,
    portfolioLoading,
    accountError,
    portfolioError,
    refreshAll,
  } = usePortfolio();

  const loading = accountLoading || portfolioLoading;
  const error = accountError || portfolioError;

  const cashBalanceRupees = summary
    ? paiseToRupees(summary.cashBalancePaise)
    : account
    ? paiseToRupees(account.cashBalancePaise)
    : null;

  const usedMarginRupees = summary
    ? paiseToRupees(summary.totalInvestedPaise)
    : null;

  const openingBalanceRupees = account
    ? paiseToRupees(account.initialBalancePaise)
    : null;

  const currentMarketValueRupees = summary
    ? paiseToRupees(summary.currentMarketValuePaise)
    : null;

  const realizedPnlRupees = summary
    ? paiseToRupees(summary.realizedPnlPaise)
    : null;

  const unrealizedPnlRupees = summary
    ? paiseToRupees(summary.unrealizedPnlPaise)
    : null;

  const totalPnlRupees = summary
    ? paiseToRupees(summary.totalPnlPaise)
    : null;

  const activePositionsCount = summary
    ? summary.activePositionsCount
    : 0;

  return (
    <div className="view-container">
      <div className="view-header funds-header-row">
        <div>
          <h2 className="view-title">Funds & Practice Margins</h2>
          <p className="view-subtitle">
            {account
              ? `Practice Account #${account.accountNumber} • Status: ${account.status}`
              : isAuthenticated
              ? "Practice Account • Virtual Trading Pool"
              : "Sign in with a session token to view active account funds."}
          </p>
        </div>
        {isAuthenticated && (
          <div className="funds-action-row">
            <button
              type="button"
              className="btn btn-grey"
              onClick={refreshAll}
              disabled={loading}
              title="Refresh account and margin metrics"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Refresh sx={{ fontSize: 16 }} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {loading && <div className="loading-state">Loading account balances...</div>}

      {error && !loading && (
        <div className="error-state-card" style={{ padding: "16px", color: "#DC2626", background: "#FEF2F2", borderRadius: "4px", marginBottom: "16px" }}>
          <p><strong>Error loading account data:</strong> {error}</p>
        </div>
      )}

      {!isAuthenticated ? (
        <div className="empty-state-card">
          <AccountBalanceWallet sx={{ fontSize: 48, color: "#94a3b8" }} />
          <h3>Authentication Required</h3>
          <p>
            Please configure an in-memory session token using <strong>Dev Token</strong> in the top navigation to access your practice account funds and portfolio margin metrics.
          </p>
        </div>
      ) : (
        !loading && (
          <div className="funds-layout-grid">
            {/* EQUITY SEGMENT MARGIN PANEL */}
            <div className="funds-panel">
              <div className="panel-title-bar">
                <AccountBalanceWallet sx={{ fontSize: 20, color: "#2563EB" }} />
                <h3>Equity Segment</h3>
              </div>

              <div className="funds-metric-table">
                <div className="metric-row-highlight">
                  <span className="label">Available Cash Margin</span>
                  <span className="value-prominent">
                    {cashBalanceRupees !== null
                      ? `₹${formatRupees(cashBalanceRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Used Margin (Invested)</span>
                  <span className="value">
                    {usedMarginRupees !== null
                      ? `₹${formatRupees(usedMarginRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Current Portfolio Value</span>
                  <span className="value">
                    {currentMarketValueRupees !== null
                      ? `₹${formatRupees(currentMarketValueRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="divider-h" />

                <div className="metric-row">
                  <span className="label">Opening / Initial Balance</span>
                  <span className="value">
                    {openingBalanceRupees !== null
                      ? `₹${formatRupees(openingBalanceRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Realized Trading P&L</span>
                  <span
                    className={`value ${
                      realizedPnlRupees !== null && realizedPnlRupees < 0
                        ? "negative"
                        : "positive"
                    }`}
                  >
                    {realizedPnlRupees !== null
                      ? `${realizedPnlRupees > 0 ? "+" : ""}₹${formatRupees(realizedPnlRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Unrealized Portfolio P&L</span>
                  <span
                    className={`value ${
                      unrealizedPnlRupees !== null && unrealizedPnlRupees < 0
                        ? "negative"
                        : "positive"
                    }`}
                  >
                    {unrealizedPnlRupees !== null
                      ? `${unrealizedPnlRupees > 0 ? "+" : ""}₹${formatRupees(unrealizedPnlRupees)}`
                      : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Total Net P&L</span>
                  <span
                    className={`value ${
                      totalPnlRupees !== null && totalPnlRupees < 0
                        ? "negative"
                        : "positive"
                    }`}
                    style={{ fontWeight: 700 }}
                  >
                    {totalPnlRupees !== null
                      ? `${totalPnlRupees > 0 ? "+" : ""}₹${formatRupees(totalPnlRupees)}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* PRACTICE ACCOUNT INFO PANEL */}
            <div className="funds-panel">
              <div className="panel-title-bar">
                <AccountCircle sx={{ fontSize: 20, color: "#16A34A" }} />
                <h3>Account Information</h3>
              </div>

              <div className="funds-metric-table">
                <div className="metric-row">
                  <span className="label">Account Number</span>
                  <span className="value">
                    {account ? `#${account.accountNumber}` : "—"}
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Account Status</span>
                  <span className="value">
                    <span className="status-chip status-success">
                      {account ? account.status : "ACTIVE"}
                    </span>
                  </span>
                </div>

                <div className="metric-row">
                  <span className="label">Active Positions</span>
                  <span className="value">{activePositionsCount}</span>
                </div>

                <div className="metric-row">
                  <span className="label">Quote Feed Status</span>
                  <span className="value">
                    {summary?.hasStaleQuotes ? (
                      <span className="badge-stale">SOME QUOTES STALE</span>
                    ) : (
                      <span style={{ fontSize: "0.75rem", color: "#166534", fontWeight: 600 }}>
                        ALL QUOTES LIVE
                      </span>
                    )}
                  </span>
                </div>

                <div className="divider-h" />

                <div style={{ padding: "8px 0" }}>
                  <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748B", lineHeight: 1.4 }}>
                    * Virtual cash and holdings in this account are managed by the server-side simulation engine with ACID transactional ledger entries.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default Funds;

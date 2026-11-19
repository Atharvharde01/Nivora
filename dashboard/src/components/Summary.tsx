/**
 * NIVORA Trading Platform — Dashboard Summary View
 * Combines the interactive instrument workspace with account and portfolio metrics.
 * Connects directly to PortfolioContext for server-authoritative valuations.
 */

import React from "react";
import Workspace from "./Workspace";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { formatRupees, paiseToRupees } from "../api/types";
import {
  getTimeBasedGreeting,
  getUserDisplayName,
} from "../utils/userDisplay";
import { AccountBalanceWallet, PieChartOutline } from "@mui/icons-material";

export const Summary: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const { summary, account } = usePortfolio();

  const greetingPrefix = getTimeBasedGreeting();
  const userGreetingName = getUserDisplayName(user);

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

  const totalInvestedRupees = summary
    ? paiseToRupees(summary.totalInvestedPaise)
    : null;

  const totalPnlRupees = summary
    ? paiseToRupees(summary.totalPnlPaise)
    : null;

  return (
    <div className="summary-page-container">
      {/* Personalized Welcome Banner */}
      <div className="dashboard-welcome-bar" data-testid="dashboard-welcome-banner">
        <div>
          <h1 className="welcome-heading">
            {greetingPrefix}, {userGreetingName}!
          </h1>
          <p className="welcome-subtext">Welcome back to NIVORA.</p>
        </div>
        {isAuthenticated && account && (
          <span className="welcome-account-pill">
            Practice Account #{account.accountNumber} • {account.status}
          </span>
        )}
      </div>

      {/* Active Selected Instrument & Chart Area */}
      <Workspace />

      {/* Account Overview Cards */}
      <div className="account-summary-section">
        <div className="user-greeting">
          <div className="greeting-text">
            <h2>Account Overview</h2>
            <p className="greeting-sub">
              {isAuthenticated
                ? account
                  ? `Practice Account #${account.accountNumber} • Status: ${account.status}`
                  : "Authenticated Practice Session"
                : "Simulation Mode • Sign in to view live account records"}
            </p>
          </div>
        </div>

        <div className="summary-cards-grid">
          {/* EQUITY & MARGIN CARD */}
          <div className="summary-metric-card">
            <div className="card-header">
              <span className="card-title">
                <AccountBalanceWallet sx={{ fontSize: 18, mr: 0.8, color: "#2563EB" }} />
                Equity Margin
              </span>
            </div>
            <div className="card-body">
              <div className="primary-metric">
                <span className="metric-large">
                  {cashBalanceRupees !== null
                    ? `₹${formatRupees(cashBalanceRupees)}`
                    : "—"}
                </span>
                <span className="metric-caption">Available Cash Margin</span>
              </div>
              <div className="metric-divider-v" />
              <div className="secondary-metrics">
                <div className="metric-row">
                  <span className="label">Margins used</span>
                  <span className="value">
                    {usedMarginRupees !== null
                      ? `₹${formatRupees(usedMarginRupees)}`
                      : "—"}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="label">Opening balance</span>
                  <span className="value">
                    {openingBalanceRupees !== null
                      ? `₹${formatRupees(openingBalanceRupees)}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* HOLDINGS & PNL CARD */}
          <div className="summary-metric-card">
            <div className="card-header">
              <span className="card-title">
                <PieChartOutline sx={{ fontSize: 18, mr: 0.8, color: "#10B981" }} />
                Holdings & P&L
              </span>
            </div>
            <div className="card-body">
              <div className="primary-metric">
                <span
                  className={`metric-large ${
                    totalPnlRupees !== null && totalPnlRupees < 0
                      ? "negative"
                      : "positive"
                  }`}
                >
                  {totalPnlRupees !== null
                    ? `${totalPnlRupees > 0 ? "+" : ""}₹${formatRupees(totalPnlRupees)}`
                    : "—"}
                </span>
                <span className="metric-caption">Total Realized + Unrealized P&L</span>
              </div>
              <div className="metric-divider-v" />
              <div className="secondary-metrics">
                <div className="metric-row">
                  <span className="label">Current Value</span>
                  <span className="value">
                    {currentMarketValueRupees !== null
                      ? `₹${formatRupees(currentMarketValueRupees)}`
                      : "—"}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="label">Total Invested</span>
                  <span className="value">
                    {totalInvestedRupees !== null
                      ? `₹${formatRupees(totalInvestedRupees)}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Summary;

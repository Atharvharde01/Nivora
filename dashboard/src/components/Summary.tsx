/**
 * NIVORA Trading Platform — Dashboard Summary View
 * Combines the interactive instrument workspace with account and portfolio metrics.
 */

import React, { useEffect, useState } from "react";
import Workspace from "./Workspace";
import { useAuth } from "../context/AuthContext";
import { PortfolioApi, AccountsApi } from "../api/client";
import { PortfolioSummaryDto, PracticeAccountSummaryDto } from "../api/types";
import { AccountBalanceWallet, PieChartOutline } from "@mui/icons-material";

export const Summary: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [summary, setSummary] = useState<PortfolioSummaryDto | null>(null);
  const [account, setAccount] = useState<PracticeAccountSummaryDto | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setSummary(null);
      setAccount(null);
      return;
    }

    let active = true;

    async function loadData() {
      try {
        const [portfolioRes, accountRes] = await Promise.allSettled([
          PortfolioApi.getSummary(),
          AccountsApi.getActiveAccount(),
        ]);

        if (active && portfolioRes.status === "fulfilled" && portfolioRes.value.success) {
          setSummary(portfolioRes.value.data?.summary || null);
        }

        if (active && accountRes.status === "fulfilled" && accountRes.value.success) {
          setAccount(accountRes.value.data?.account || null);
        }
      } catch {
        // Silently preserve clean empty state
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  return (
    <div className="summary-page-container">
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
                  ? `Practice Account #${account.accountNumber} • Active`
                  : "Authenticated Practice Session"
                : "Simulation Mode • Configure in-memory Dev Token to view live account records"}
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
                  {summary
                    ? `₹${(summary.cashBalancePaise / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : account
                    ? `₹${(account.virtualBalancePaise / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "₹10,00,000.00"}
                </span>
                <span className="metric-caption">Available Cash Margin</span>
              </div>
              <div className="metric-divider-v" />
              <div className="secondary-metrics">
                <div className="metric-row">
                  <span className="label">Margins used</span>
                  <span className="value">
                    {summary
                      ? `₹${(summary.totalInvestedPaise / 100).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "₹0.00"}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="label">Opening balance</span>
                  <span className="value">₹10,00,000.00</span>
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
                    summary && summary.totalPnlPaise < 0 ? "negative" : "positive"
                  }`}
                >
                  {summary
                    ? `₹${(summary.totalPnlPaise / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "₹0.00"}
                </span>
                <span className="metric-caption">Total Realized + Unrealized P&L</span>
              </div>
              <div className="metric-divider-v" />
              <div className="secondary-metrics">
                <div className="metric-row">
                  <span className="label">Current Value</span>
                  <span className="value">
                    {summary
                      ? `₹${(summary.currentMarketValuePaise / 100).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "₹0.00"}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="label">Total Invested</span>
                  <span className="value">
                    {summary
                      ? `₹${(summary.totalInvestedPaise / 100).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "₹0.00"}
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

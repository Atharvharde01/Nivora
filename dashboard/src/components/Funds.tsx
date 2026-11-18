/**
 * NIVORA Trading Platform — Funds & Margins View
 * Displays virtual practice account funds, cash balance, and margin allocation.
 */

import React, { useState, useEffect } from "react";
import { AccountsApi, PortfolioApi } from "../api/client";
import { PortfolioSummaryDto, PracticeAccountSummaryDto } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { AccountBalanceWallet, AddCircleOutline } from "@mui/icons-material";

export const Funds: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [account, setAccount] = useState<PracticeAccountSummaryDto | null>(null);
  const [summary, setSummary] = useState<PortfolioSummaryDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccount(null);
      setSummary(null);
      return;
    }

    let active = true;
    setLoading(true);

    Promise.allSettled([AccountsApi.getActiveAccount(), PortfolioApi.getSummary()])
      .then(([accRes, sumRes]) => {
        if (!active) return;
        if (accRes.status === "fulfilled" && accRes.value.success) {
          setAccount(accRes.value.data?.account || null);
        }
        if (sumRes.status === "fulfilled" && sumRes.value.success) {
          setSummary(sumRes.value.data?.summary || null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const cashBalance = summary
    ? summary.cashBalancePaise / 100
    : account
    ? account.virtualBalancePaise / 100
    : 1000000;

  const usedMargin = summary ? summary.totalInvestedPaise / 100 : 0;

  return (
    <div className="view-container">
      <div className="view-header funds-header-row">
        <div>
          <h2 className="view-title">Funds & Practice Margins</h2>
          <p className="view-subtitle">
            {account
              ? `Practice Account #${account.accountNumber} • Virtual Balance Pool`
              : "Virtual Trading Account • Standard 10 Lakh Simulation Pool"}
          </p>
        </div>
        <div className="funds-action-row">
          <button
            type="button"
            className="btn btn-green"
            onClick={() => alert("Practice account funds are replenished automatically.")}
          >
            <AddCircleOutline sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />
            Add Funds (Simulated)
          </button>
        </div>
      </div>

      {loading && <div className="loading-state">Loading account balances...</div>}

      <div className="funds-layout-grid">
        {/* EQUITY MARGIN PANEL */}
        <div className="funds-panel">
          <div className="panel-title-bar">
            <AccountBalanceWallet sx={{ fontSize: 20, color: "#2563EB" }} />
            <h3>Equity Segment</h3>
          </div>

          <div className="funds-metric-table">
            <div className="metric-row-highlight">
              <span className="label">Available Margin</span>
              <span className="value-prominent">
                ₹
                {cashBalance.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>

            <div className="metric-row">
              <span className="label">Used Margin</span>
              <span className="value">
                ₹
                {usedMargin.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>

            <div className="metric-row">
              <span className="label">Available Cash</span>
              <span className="value">
                ₹
                {cashBalance.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>

            <div className="divider-h" />

            <div className="metric-row">
              <span className="label">Opening Balance</span>
              <span className="value">₹10,00,000.00</span>
            </div>

            <div className="metric-row">
              <span className="label">Realized Trading P&L</span>
              <span
                className={`value ${
                  summary && summary.realizedPnlPaise < 0 ? "negative" : "positive"
                }`}
              >
                {summary
                  ? `₹${(summary.realizedPnlPaise / 100).toFixed(2)}`
                  : "₹0.00"}
              </span>
            </div>

            <div className="metric-row">
              <span className="label">Unrealized Portfolio P&L</span>
              <span
                className={`value ${
                  summary && summary.unrealizedPnlPaise < 0 ? "negative" : "positive"
                }`}
              >
                {summary
                  ? `₹${(summary.unrealizedPnlPaise / 100).toFixed(2)}`
                  : "₹0.00"}
              </span>
            </div>
          </div>
        </div>

        {/* PRACTICE ACCOUNT INFO PANEL */}
        <div className="funds-panel">
          <div className="panel-title-bar">
            <h3>Simulation Engine Status</h3>
          </div>
          <div className="funds-info-body">
            <p>
              NIVORA operates with a <strong>100% simulated execution and margin engine</strong>.
              All funds, margins, and trades are strictly virtual and free of financial risk.
            </p>
            <ul className="funds-feature-list">
              <li>Automatic virtual ₹10,00,000 credit on practice account creation</li>
              <li>Real-time margin calculation and leverage protection</li>
              <li>Sub-penny precision financial bookkeeping in paise</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Funds;

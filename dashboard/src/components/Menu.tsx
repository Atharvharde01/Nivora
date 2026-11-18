/**
 * NIVORA Trading Platform — Primary Navigation Menu
 * Handles route navigation, active route styling, dev token session trigger,
 * and user profile indicators.
 */

import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { VpnKey, PersonOutline } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import DevTokenModal from "./DevTokenModal";

export const Menu: React.FC = () => {
  const { isAuthenticated, openTokenModal } = useAuth();
  const [profileOpen, setProfileOpen] = useState<boolean>(false);

  const toggleProfile = () => {
    setProfileOpen(!profileOpen);
  };

  return (
    <nav className="menu-container" aria-label="Main Navigation">
      <ul className="nav-links">
        <li>
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/markets"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Markets
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/orders"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Orders
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/trades"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Trades
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/holdings"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Holdings
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/positions"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Positions
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/funds"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Funds
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/apps"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Apps
          </NavLink>
        </li>
      </ul>

      <div className="nav-divider" />

      {/* Dev Token & Session Area */}
      <div className="nav-session">
        <button
          type="button"
          className={`session-badge ${isAuthenticated ? "authenticated" : "unauthenticated"}`}
          onClick={openTokenModal}
          title="Click to manage in-memory Dev Session Token"
        >
          <VpnKey className="badge-icon" />
          <span className="badge-label">
            {isAuthenticated ? "Session Active" : "Dev Token"}
          </span>
          <span className={`status-dot ${isAuthenticated ? "online" : "offline"}`} />
        </button>

        {/* User Profile avatar */}
        <div
          className="profile"
          onClick={toggleProfile}
          role="button"
          tabIndex={0}
          title="User Account"
        >
          <div className="avatar">
            <PersonOutline sx={{ fontSize: 18 }} />
          </div>
          <span className="username">DEMO</span>
        </div>
      </div>

      {/* Developer Token Management Dialog */}
      <DevTokenModal />
    </nav>
  );
};

export default Menu;

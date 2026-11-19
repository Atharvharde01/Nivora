/**
 * NIVORA Trading Platform — Primary Navigation Menu
 * Handles route navigation, active route styling, authenticated user display name,
 * user profile dropdown (My Profile + Logout), outside profile-update toast, and server logout.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  CheckCircleOutline,
  Close as CloseIcon,
  KeyboardArrowDown,
  Logout as LogoutIcon,
  ManageAccountsOutlined,
  PersonOutline,
} from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { AuthUserDto } from "../api/types";
import {
  getUserAvatarInitials,
  getUserDisplayName,
} from "../utils/userDisplay";
import ProfileModal from "./ProfileModal";

const PROFILE_TOAST_DURATION_MS = 4000;

export const Menu: React.FC = () => {
  const { isAuthenticated, user, logout, isLoggingOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayLabel = getUserDisplayName(user);
  const initials = getUserAvatarInitials(user);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearToastTimer();
    };
  }, [clearToastTimer]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuWrapperRef.current &&
        !menuWrapperRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleOpenProfile = () => {
    setIsMenuOpen(false);
    setIsProfileOpen(true);
  };

  const handleProfileSaved = (updatedUser: AuthUserDto) => {
    clearToastTimer();
    const updatedName = updatedUser.displayName?.trim();
    setToastMessage(
      updatedName
        ? `Display name updated to ${updatedName}.`
        : "Your profile has been updated."
    );
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, PROFILE_TOAST_DURATION_MS);
  };

  const handleDismissToast = () => {
    clearToastTimer();
    setToastMessage(null);
  };

  const handleLogoutClick = () => {
    setIsMenuOpen(false);
    clearToastTimer();
    setToastMessage(null);
    void logout();
  };

  return (
    <>
      <nav className="menu-container" aria-label="Main Navigation">
        <ul className="nav-links">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/markets"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Markets
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/orders"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Orders
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/trades"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Trades
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/holdings"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Holdings
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/positions"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Positions
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/funds"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Funds
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/apps"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Apps
            </NavLink>
          </li>
        </ul>

        <div className="nav-divider" />

        {/* Authenticated User Profile Menu */}
        <div className="nav-session" ref={menuWrapperRef}>
          {isAuthenticated ? (
            <div className="user-menu-wrapper">
              <button
                type="button"
                className="profile user-menu-trigger"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                aria-label={`Account menu for ${displayLabel}`}
                data-testid="user-profile-indicator"
              >
                <div
                  className="avatar"
                  aria-hidden="true"
                  data-testid="user-avatar-initials"
                >
                  <span>{initials}</span>
                </div>
                <span
                  className="username"
                  data-testid="user-display-name"
                  style={{
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {displayLabel}
                </span>
                <KeyboardArrowDown
                  sx={{ fontSize: 16, color: "#64748b" }}
                  aria-hidden="true"
                />
              </button>

              {isMenuOpen && (
                <div
                  className="user-menu-dropdown"
                  role="menu"
                  aria-label="User Account Menu"
                  data-testid="user-menu-dropdown"
                >
                  <div className="user-menu-header">
                    <div className="user-menu-avatar-lg" aria-hidden="true">
                      {initials}
                    </div>
                    <div className="user-menu-identity">
                      <span className="user-menu-name">{displayLabel}</span>
                    </div>
                  </div>

                  <div className="user-menu-divider" />

                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={handleOpenProfile}
                  >
                    <ManageAccountsOutlined sx={{ fontSize: 18 }} />
                    <span>My Profile</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item danger"
                    onClick={handleLogoutClick}
                    disabled={isLoggingOut}
                  >
                    <LogoutIcon sx={{ fontSize: 18 }} />
                    <span>{isLoggingOut ? "Signing out..." : "Logout"}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="profile" data-testid="user-profile-indicator">
              <div className="avatar" aria-hidden="true">
                <PersonOutline sx={{ fontSize: 18 }} />
              </div>
              <span className="username">{displayLabel}</span>
            </div>
          )}
        </div>
      </nav>

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onSuccess={handleProfileSaved}
      />

      {toastMessage && (
        <div
          className="profile-toast"
          role="status"
          aria-live="polite"
          data-testid="profile-success-toast"
        >
          <CheckCircleOutline sx={{ fontSize: 18, color: "#059669", flexShrink: 0 }} />
          <span className="profile-toast-text">{toastMessage}</span>
          <button
            type="button"
            className="profile-toast-close"
            onClick={handleDismissToast}
            aria-label="Dismiss notification"
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>
      )}
    </>
  );
};

export default Menu;

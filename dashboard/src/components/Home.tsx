/**
 * NIVORA Trading Platform — Application Shell
 * Wraps the entire trading workspace inside AuthProvider + ProtectedRoute.
 * User-specific MarketProvider and PortfolioProvider mount ONLY for authenticated
 * sessions and unmount immediately upon logout or session expiry.
 */

import React from "react";
import { AuthProvider } from "../context/AuthContext";
import { MarketProvider } from "../context/MarketContext";
import { PortfolioProvider } from "../context/PortfolioContext";
import ProtectedRoute from "./ProtectedRoute";
import TopBar from "./TopBar";
import Dashboard from "./Dashboard";
import OrderActionWindow from "./OrderActionWindow";

export interface HomeProps {
  onRedirectToSignup?: (url: string) => void;
}

export const Home: React.FC<HomeProps> = ({ onRedirectToSignup }) => {
  return (
    <AuthProvider onRedirectToSignup={onRedirectToSignup}>
      <ProtectedRoute onRedirectToSignup={onRedirectToSignup}>
        <MarketProvider>
          <PortfolioProvider>
            <div className="nivora-shell">
              <TopBar />
              <Dashboard />
              <OrderActionWindow />
            </div>
          </PortfolioProvider>
        </MarketProvider>
      </ProtectedRoute>
    </AuthProvider>
  );
};

export default Home;

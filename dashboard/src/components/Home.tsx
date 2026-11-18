/**
 * NIVORA Trading Platform — Application Shell
 * Wraps top-level navigation, workspace, and modals with AuthProvider and MarketProvider.
 */

import React from "react";
import { AuthProvider } from "../context/AuthContext";
import { MarketProvider } from "../context/MarketContext";
import TopBar from "./TopBar";
import Dashboard from "./Dashboard";
import OrderActionWindow from "./OrderActionWindow";

export const Home: React.FC = () => {
  return (
    <AuthProvider>
      <MarketProvider>
        <div className="nivora-shell">
          <TopBar />
          <Dashboard />
          <OrderActionWindow />
        </div>
      </MarketProvider>
    </AuthProvider>
  );
};

export default Home;

/**
 * NIVORA Trading Platform — Dashboard Layout
 * Renders the persistent Marketwatch left sidebar and dynamic view routes.
 */

import React from "react";
import { Route, Routes } from "react-router-dom";

import WatchList from "./WatchList";
import Summary from "./Summary";
import MarketsView from "./MarketsView";
import Orders from "./Orders";
import TradesView from "./TradesView";
import Holdings from "./Holdings";
import Positions from "./Positions";
import Funds from "./Funds";
import Apps from "./Apps";

export const Dashboard: React.FC = () => {
  return (
    <div className="dashboard-container">
      <WatchList />
      <main className="content">
        <Routes>
          <Route path="/" element={<Summary />} />
          <Route path="/markets" element={<MarketsView />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/trades" element={<TradesView />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/funds" element={<Funds />} />
          <Route path="/apps" element={<Apps />} />
        </Routes>
      </main>
    </div>
  );
};

export default Dashboard;

import React from "react";
import { useNavigate } from "react-router-dom";

const OpenAccount: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="container p-5 mb-5 mt-3">
      <div className="row text-center">
        <h1 className="mt-5 mb-3">Open a Zerodha account</h1>
        <p className="text-muted">
          Modern platforms and apps, ₹0 investments, and flat ₹20 intraday and
          F&O trades.
        </p>
        <button
          type="button"
          className="p-2 btn btn-primary fs-5 mt-3 mb-5 "
          style={{ width: "20%", margin: "0 auto" }}
          onClick={() => navigate("/signup")}
        >
          Sign up Now
        </button>
      </div>
    </div>
  );
};

export default OpenAccount;


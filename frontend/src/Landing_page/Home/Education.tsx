import React from "react";

const Education: React.FC = () => {
  return (
    <div className="container mt-5">
      <div className="row">
        <div className="col-6 mb-5 pb-5">
          <img
            src="media/images/education.svg"
            style={{ width: "68%" }}
            alt="Education"
          />
        </div>
        <div className="col-6 mb-5 pb-5">
          <h1 className="mb-3 fs-2">Free and open market education</h1>
          <p>
            Varsity, the largest online stock market education book in the world
            covering everything from the basics to advanced trading.
          </p>
          <a href="/about" style={{ textDecoration: "none" }}>
            Varsity <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </a>
          <p className="mt-5">
            TradingQ&A, the most active trading and investment community in
            India for all your market related queries.
          </p>
          <a href="/support" style={{ textDecoration: "none" }}>
            TradingQ&A <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </a>
        </div>
      </div>
    </div>
  );
};

export default Education;


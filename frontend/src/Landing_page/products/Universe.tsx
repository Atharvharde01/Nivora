import React from "react";

function Universe(): JSX.Element {
  return (
    <div className="container mt-5">
      <div className="row text-center">
        <p className="text-muted mb-4">
          Want to know more about our technology stack? Check out the{" "}
          <a
            href="https://zerodha.tech"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#387ed1", textDecoration: "none" }}
          >
            Zerodha.tech
          </a>{" "}
          blog.
        </p>
        <h1 className="mb-3">The Zerodha Universe</h1>
        <p className="text-muted mb-5">
          Extend your trading and investment experience even further with our
          partner platforms
        </p>

        <div className="col-4 p-3 mt-4">
          <a href="https://www.smallcase.com" target="_blank" rel="noopener noreferrer">
            <img src="media/images/smallcaseLogo.png" alt="smallcase" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">
            Thematic investing platform that helps you invest in diversified baskets of stocks and ETFs.
          </p>
        </div>
        <div className="col-4 p-3 mt-4">
          <a href="https://streak.tech" target="_blank" rel="noopener noreferrer">
            <img src="media/images/streakLogo.png" alt="streak" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">
            Systematic trading platform that allows you to create and backtest strategies without coding.
          </p>
        </div>
        <div className="col-4 p-3 mt-4">
          <a href="https://joinditto.in" target="_blank" rel="noopener noreferrer">
            <img src="media/images/dittoLogo.png" alt="ditto" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">
            Personalized advice on life and health insurance. No spam and no mis-selling.
          </p>
        </div>
        <div className="col-4 p-3 mt-5">
          <a href="https://www.zerodhafundhouse.com" target="_blank" rel="noopener noreferrer">
            <img src="media/images/zerodhaFundHouse.png" alt="zerodha fund house" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">
            Our asset management venture that is creating simple and transparent index funds to help you save for your goals.
          </p>
        </div>
        <div className="col-4 p-3 mt-5">
          <a href="https://sensibull.com" target="_blank" rel="noopener noreferrer">
            <img src="media/images/sensibullLogo.svg" alt="sensibull" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">
            Options trading platform that lets you create strategies, analyze positions, and examine data points like open interest, FII/DII, and more.
          </p>
        </div>
        <div className="col-4 p-3 mt-5">
          <a href="https://www.goldenpi.com" target="_blank" rel="noopener noreferrer">
            <img src="media/images/goldenpiLogo.png" alt="goldenpi" style={{ width: "50%" }} />
          </a>
          <p className="text-muted mt-3">Bonds trading platform</p>
        </div>
        <div className="col-12 mt-5 mb-5">
          <a
            href=""
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary fs-5 px-4 py-2"
          >
            Sign up for free
          </a>
        </div>
      </div>
    </div>
  );
}

export default Universe;


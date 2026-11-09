import React from "react";
import { Link } from "react-router-dom";

const Navbar: React.FC = () => {
  return (
    <nav
      className="navbar navbar-expand-lg border-bottom"
      style={{ backgroundColor: "#FFF" }}
    >
      <div className="container p-2">
        <Link to="/" className="navbar-brand mr-5 pr-5">
          <img
            src="media/images/logo.svg"
            style={{ width: "24%", marginLeft: "2rem" }}
            alt="Logo"
          />
        </Link>
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarSupportedContent"
          aria-controls="navbarSupportedContent"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarSupportedContent">
          <form className="d-flex" role="search">
            <ul className="navbar-nav mb-lg-0">
              <li className="nav-item">
                <Link to="/signup" className="nav-link active" aria-current="page">
                  Signup
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/about" className="nav-link active">
                  About
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/product" className="nav-link active">
                  Product
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/pricing" className="nav-link active">
                  Pricing
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/support" className="nav-link active">
                  Support
                </Link>
              </li>
            </ul>
          </form>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;


import React from "react";

const Hero: React.FC = () => {
  return (
    <div className="container p-5 mb-5">
      <div className="row text-center">
        <img
          className="home_img mb-4"
          src="media/images/homeHero.png"
          alt="Home"
        />
        <h1 className="mt-5">Invest in everything</h1>
        <p>
          Online platform to invest in stocks, derivatives, mutual funds, ETFs,
          bonds, and more.
        </p>
        <button className="btn btn-primary fs-5 mb-4">Signup For free</button>
      </div>
    </div>
  );
};

export default Hero;


/**
 * NIVORA Public Website — Account Signup Page (`/signup`)
 * Follows the Zerodha `/open-account` structural layout adapted strictly for
 * NIVORA's simulated Indian stock-trading platform using passwordless email OTP.
 */

import React, { useState, useRef } from "react";
import EmailOtpAuthFlow, { AuthStep } from "../auth/EmailOtpAuthFlow";
import "../auth/AuthPages.css";

interface FaqItem {
  question: string;
  answer: string;
}

const NIVORA_FAQS: readonly FaqItem[] = [
  {
    question: "What is a NIVORA practice account?",
    answer:
      "A NIVORA practice account gives you virtual trading funds to explore Indian equity markets, monitor simulated NIFTY 50 and SENSEX indices, place simulated BUY and SELL market orders, and track orders, holdings, positions, and portfolio P&L without risking real money.",
  },
  {
    question: "Do I need a PAN, Aadhaar, bank account, or demat account?",
    answer:
      "No. NIVORA is a simulated trading platform. You only need a valid email address to verify via a 6-digit OTP and start practicing immediately—no brokerage KYC documents, phone numbers, or bank details are required.",
  },
  {
    question: "Is creating a NIVORA account free?",
    answer:
      "Yes. Signing up for NIVORA is completely free and automatically provisions one active virtual practice account funded with simulated capital so you can start testing trading workflows right away.",
  },
  {
    question: "How does passwordless email OTP login work?",
    answer:
      "Enter your email address and request a 6-digit single-use verification code sent to your inbox. Once verified, NIVORA establishes a secure session and opens your trading dashboard—no passwords to remember or reuse.",
  },
  {
    question: "Are trades placed on NIVORA real money or live exchange orders?",
    answer:
      "No. All quotes, candles, market indices, and BUY/SELL order executions on NIVORA are simulated using virtual funds. No real money, securities, or brokerage accounts are involved.",
  },
  {
    question: "What features are currently available on the NIVORA dashboard?",
    answer:
      "You can use Marketwatch with custom watchlists, inspect synthetic NIFTY 50 and SENSEX indices with interactive candlestick charts, submit simulated BUY and SELL market orders, and review your Orders, Trades, Holdings, Positions, and Virtual Funds in real time.",
  },
];

export interface SignupProps {
  onRedirect?: (url: string) => void;
}

export const Signup: React.FC<SignupProps> = ({ onRedirect }) => {
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const fullNameInputRef = useRef<HTMLInputElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const scrollToSignupForm = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      fullNameInputRef.current?.focus();
    }, 350);
  };

  const isOtpStep = authStep === "otp";

  return (
    <div className="nivora-auth-page">
      {/* 1. HERO / OTP VERIFICATION SECTION */}
      <section className={isOtpStep ? "nivora-otp-screen" : "nivora-signup-hero"}>
        {!isOtpStep && (
          <div className="nivora-signup-hero-header">
            <h1>Start your trading journey with NIVORA</h1>
            <p>
              Explore the stock market, practice simulated trades, and build your
              trading skills with virtual funds.
            </p>
          </div>
        )}

        <div className="nivora-auth-two-col">
          <div className="nivora-auth-illustration-wrap">
            <img
              src={
                isOtpStep
                  ? "/media/images/open-account/email-otp.svg"
                  : "/media/images/open-account/account_open.svg"
              }
              alt={
                isOtpStep
                  ? "Email OTP verification"
                  : "NIVORA simulated trading dashboard illustration"
              }
              className={
                isOtpStep
                  ? "nivora-otp-illustration"
                  : "nivora-auth-illustration"
              }
            />
          </div>

          <div>
            <EmailOtpAuthFlow
              onStepChange={setAuthStep}
              onRedirect={onRedirect}
              fullNameInputRef={fullNameInputRef}
              emailInputRef={emailInputRef}
            />
          </div>
        </div>
      </section>

      {!isOtpStep && (
        <>

      {/* 2. NIVORA FEATURES SECTION */}
      <section className="nivora-section">
        <h2 className="nivora-section-title">
          What you can practice with a NIVORA account
        </h2>

        <div className="nivora-features-grid">
          <div className="nivora-feature-item">
            <img
              src="/media/images/open-account/stocks-acop.svg"
              alt="Marketwatch and Watchlists"
              className="nivora-feature-icon"
            />
            <div>
              <h3>Marketwatch &amp; Watchlists</h3>
              <p>
                Search NSE equities, build custom watchlists, reorder your
                tracked instruments, and monitor live simulated quotes.
              </p>
            </div>
          </div>

          <div className="nivora-feature-item">
            <img
              src="/media/images/open-account/mf-acop.svg"
              alt="Synthetic Market Indices"
              className="nivora-feature-icon"
            />
            <div>
              <h3>Market Indices &amp; Charts</h3>
              <p>
                Track synthetic NIFTY 50 and SENSEX benchmarks, expand index
                constituents, and analyze multi-timeframe candlestick charts.
              </p>
            </div>
          </div>

          <div className="nivora-feature-item">
            <img
              src="/media/images/open-account/ipo-acop.svg"
              alt="Simulated BUY and SELL Orders"
              className="nivora-feature-icon"
            />
            <div>
              <h3>Simulated BUY &amp; SELL Orders</h3>
              <p>
                Submit simulated market buy and sell orders with server-verified
                execution prices, margin validation, and complete order history.
              </p>
            </div>
          </div>

          <div className="nivora-feature-item">
            <img
              src="/media/images/open-account/fo-acop.svg"
              alt="Portfolio Tracking and Virtual Funds"
              className="nivora-feature-icon"
            />
            <div>
              <h3>Portfolio, Holdings &amp; Virtual Funds</h3>
              <p>
                Track open positions, holdings, realized and unrealized P&amp;L,
                executed trade logs, and available virtual cash balance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. STEPS TO GET STARTED */}
      <section className="nivora-section-tinted">
        <div className="nivora-section">
          <h2 className="nivora-section-title">
            Steps to get started with NIVORA
          </h2>

          <div className="nivora-steps-grid">
            <div>
              <img
                src="/media/images/open-account/steps-acop.svg"
                alt="Steps to create a NIVORA practice account"
                className="nivora-steps-illustration"
              />
            </div>

            <ol className="nivora-steps-list">
              <li className="nivora-step-row">
                <span className="nivora-step-badge">01</span>
                <span className="nivora-step-text">
                  Enter your email address
                </span>
              </li>
              <li className="nivora-step-row">
                <span className="nivora-step-badge">02</span>
                <span className="nivora-step-text">
                  Verify with your 6-digit email OTP
                </span>
              </li>
              <li className="nivora-step-row">
                <span className="nivora-step-badge">03</span>
                <span className="nivora-step-text">
                  Start simulated trading with virtual funds!
                </span>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* 4. BENEFITS OF SIMULATED TRADING */}
      <section className="nivora-section">
        <div className="nivora-benefits-grid">
          <div className="nivora-benefits-left">
            <img
              src="/media/images/open-account/acop-benefits.svg"
              alt="Benefits of simulated trading on NIVORA"
              className="nivora-benefits-illustration"
            />
            <h2>Benefits of simulated trading with NIVORA</h2>
          </div>

          <div>
            <div className="nivora-benefit-item">
              <h3>Risk-free virtual funds</h3>
              <p>
                Every new account receives virtual practice capital so you can
                practice equity orders and position sizing without risking real
                money.
              </p>
            </div>

            <div className="nivora-benefit-item">
              <h3>Realistic trading workflow</h3>
              <p>
                Experience clean Marketwatch navigation, live simulated quote
                updates, order execution validation, and accurate P&amp;L
                calculations.
              </p>
            </div>

            <div className="nivora-benefit-item">
              <h3>Complete portfolio visibility</h3>
              <p>
                Inspect your Orders, Trades, Holdings, Positions, and Funds
                views together in one unified workspace backed by atomic ledger
                accounting.
              </p>
            </div>

            <div className="nivora-benefit-item">
              <h3>Fast passwordless access</h3>
              <p>
                Sign up and sign back in securely with single-use email OTP
                codes—no complex onboarding forms or brokerage paperwork.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. FAQS SECTION */}
      <section className="nivora-section">
        <div className="nivora-faq-container">
          <h2 className="nivora-faq-heading">FAQs</h2>

          {NIVORA_FAQS.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div key={faq.question} className="nivora-faq-item">
                <button
                  type="button"
                  className="nivora-faq-trigger"
                  aria-expanded={isOpen}
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                >
                  <span>{faq.question}</span>
                  <i
                    className={`bi bi-chevron-down nivora-faq-chevron ${
                      isOpen ? "open" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div className="nivora-faq-answer">{faq.answer}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 6. FINAL SIGNUP CTA */}
      <section className="nivora-final-cta">
        <h2>Start practicing on NIVORA</h2>
        <p>
          Explore Marketwatch, synthetic indices, simulated orders, and virtual
          portfolio tracking—all in one place.
        </p>
        <button
          type="button"
          className="nivora-auth-btn-primary"
          onClick={scrollToSignupForm}
        >
          Signup for free
        </button>
      </section>
        </>
      )}
    </div>
  );
};

export default Signup;

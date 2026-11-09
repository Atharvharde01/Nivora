import React from "react";

const Footer: React.FC = () => {
  return (
    <footer style={{ backgroundColor: "rgb(250, 250, 250)" }}>
      <div className="container border-top mt-5">
        <div className="row mt-5">
          <div className="col text-muted">
            <img src="media/images/logo.svg" style={{ width: "50%" }} alt="Logo" />
            <p>
              &copy; 2010 - 2024, Not Zerodha Broking Ltd. All rights reserved.
            </p>
            <ul className="social">
              <li>
                <a
                  href="https://x.com/zerodha"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-twitter-x"></i>
                </a>
              </li>

              <li>
                <a
                  href="https://www.facebook.com/zerodha.social"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-facebook"></i>
                </a>
              </li>

              <li>
                <a
                  href="https://www.instagram.com/zerodhaonline/"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-instagram"></i>
                </a>
              </li>

              <li>
                <a
                  href="https://www.linkedin.com/company/zerodha"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-linkedin"></i>
                </a>
              </li>
            </ul>
            <hr style={{ width: "60%" }} />
            <ul className="social">
              <li>
                <a
                  href="https://www.youtube.com/@zerodhaonline"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-youtube"></i>
                </a>
              </li>

              <li>
                <a
                  href="https://whatsapp.com/channel/0029Va8lH5tKQuJH4D6L3R0S"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-whatsapp"></i>
                </a>
              </li>

              <li>
                <a
                  href="https://t.me/zerodhaonline"
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="bi bi-telegram"></i>
                </a>
              </li>
            </ul>
          </div>
          <div className="col">
            <p>Company</p>
            <a href="/about" className="text-muted">
              About
            </a>
            <br />
            <a href="/product" className="text-muted">
              Products
            </a>
            <br />
            <a href="/pricing" className="text-muted">
              Pricing
            </a>
            <br />
            <a href="/support" className="text-muted">
              Referral programme
            </a>
            <br />
            <a href="/about" className="text-muted">
              Careers
            </a>
            <br />
            <a href="/about" className="text-muted">
              Zerodha.tech
            </a>
            <br />
            <a href="/about" className="text-muted">
              Press & media
            </a>
            <br />
            <a href="/about" className="text-muted">
              Zerodha cares (CSR)
            </a>
            <br />
          </div>
          <div className="col">
            <p>Support</p>
            <a href="/support" className="text-muted">
              Contact
            </a>
            <br />
            <a href="/support" className="text-muted">
              Support portal
            </a>
            <br />
            <a href="/support" className="text-muted">
              Z-Connect blog
            </a>
            <br />
            <a href="/pricing" className="text-muted">
              List of charges
            </a>
            <br />
            <a href="/support" className="text-muted">
              Downloads & resources
            </a>
            <br />
          </div>
          <div className="col">
            <p>Account</p>
            <a href="/signup" className="text-muted">
              Open an account
            </a>
            <br />
            <a href="/signup" className="text-muted">
              Fund transfer
            </a>
            <br />
            <a href="/signup" className="text-muted">
              60 day challenge
            </a>
            <br />
          </div>
        </div>
        <div className="mt-5 text-muted" style={{ fontSize: "14px" }}>
          <p>
            Zerodha Broking Ltd.: Member of NSE​ &​ BSE – SEBI Registration no.:
            INZ000031633 CDSL: Depository services through Zerodha Securities
            Pvt. Ltd. – SEBI Registration no.: IN-DP-100-2015 Commodity Trading
            through Zerodha Commodities Pvt. Ltd. MCX: 46025 – SEBI Registration
            no.: INZ000038238 Registered Address: Zerodha Broking Ltd.,
            #153/154, 4th Cross, Dollars Colony, Opp. Clarence Public School,
            J.P Nagar 4th Phase, Bengaluru - 560078, Karnataka, India. For any
            complaints pertaining to securities broking please write to
            complaints@zerodha.com, for DP related to dp@zerodha.com. Please
            ensure you carefully read the Risk Disclosure Document as prescribed
            by SEBI | ICF
          </p>

          <p>
            Procedure to file a complaint on SEBI SCORES: Register on SCORES
            portal. Mandatory details for filing complaints on SCORES: Name,
            PAN, Address, Mobile Number, E-mail ID. Benefits: Effective
            Communication, Speedy redressal of the grievances
          </p>

          <p>
            Investments in securities market are subject to market risks; read
            all the related documents carefully before investing.
          </p>

          <p>
            &quot;Prevent unauthorised transactions in your account. Update your
            mobile numbers/email IDs with your stock brokers. Receive
            information of your transactions directly from Exchange on your
            mobile/email at the end of the day. Issued in the interest of
            investors. KYC is one time exercise while dealing in securities
            markets - once KYC is done through a SEBI registered intermediary
            (broker, DP, Mutual Fund etc.), you need not undergo the same
            process again when you approach another intermediary.&quot; Dear
            Investor, if you are subscribing to an IPO, there is no need to
            issue a cheque. Please write the Bank account number and sign the
            IPO application form to authorize your bank to make payment in case
            of allotment. In case of non allotment the funds will remain in your
            bank account. As a business we don&apos;t give stock tips, and have not
            authorized anyone to trade on behalf of others. If you find anyone
            claiming to be part of Zerodha and offering such services, please
            create a ticket here.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;


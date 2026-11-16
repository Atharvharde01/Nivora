import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import { createApp } from "../../app";
import { createAppRouter } from "../../routes";
import { JwtService } from "../../modules/auth/jwt.service";
import { AuthController } from "../../modules/auth/auth.controller";
import { OtpService } from "../../modules/auth/otp.service";
import { AuthService } from "../../modules/auth/auth.service";
import { MockEmailService } from "../../modules/auth/email.service";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { InstrumentController } from "../../modules/instruments/instrument.controller";
import { WatchlistService } from "../../modules/watchlist/watchlist.service";
import { WatchlistController } from "../../modules/watchlist/watchlist.controller";
import { PracticeAccountService } from "../../modules/practice-accounts/account.service";
import { AccountController } from "../../modules/practice-accounts/account.controller";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { OrderController } from "../../modules/orders/order.controller";
import { PortfolioService } from "../../modules/portfolio/portfolio.service";
import { PortfolioController } from "../../modules/portfolio/portfolio.controller";
import { TradeController } from "../../modules/trades/trade.controller";
import { SessionModel } from "../../modules/auth/session.model";
import {
  clearDatabase,
  createTestAccount,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";
import { runSmokeSuite } from "../../../scripts/smoke-test";

describe("Task 35 — Automated Deployment Smoke Runner (Integration)", () => {
  const TEST_JWT_SECRET = "test_smoke_runner_jwt_secret_min_32_characters_ok";
  const ALLOWED_ORIGIN = "http://localhost:3000";

  let server: http.Server;
  let baseUrl: string;
  let jwtService: JwtService;
  let testAuthToken: string;

  before(async () => {
    await setupIntegrationTestDb();
    await clearDatabase();

    const mockEmailService = new MockEmailService();
    const otpService = new OtpService({
      hmacSecret: "test_smoke_hmac_secret_min_32_chars_ok!",
      emailService: mockEmailService,
    });

    jwtService = new JwtService({
      accessSecret: TEST_JWT_SECRET,
      issuer: "nivora-api",
      audience: "nivora-client",
      expiresInSeconds: 900,
    });

    const authService = new AuthService({ otpService, jwtService });
    const authController = new AuthController({
      otpService,
      authService,
      cookieConfig: { isProduction: false },
      allowedOrigins: [ALLOWED_ORIGIN],
    });

    const quoteService = new InstrumentQuoteService();
    const instrumentController = new InstrumentController({ quoteService });
    const watchlistService = new WatchlistService({ quoteService });
    const watchlistController = new WatchlistController({ watchlistService });
    const practiceAccountService = new PracticeAccountService();
    const orderExecutionService = new OrderExecutionService({
      quoteService,
    });
    const orderController = new OrderController({
      orderExecutionService,
      practiceAccountService,
    });
    const portfolioService = new PortfolioService({
      quoteService,
      accountService: practiceAccountService,
    });
    const portfolioController = new PortfolioController({ portfolioService });
    const tradeController = new TradeController();
    const accountController = new AccountController({ practiceAccountService });

    const appRouter = createAppRouter({
      authDependencies: { authController, jwtService },
      instrumentController,
      watchlistController,
      orderController,
      portfolioController,
      tradeController,
      accountController,
    });

    const app = createApp({
      isProduction: false,
      allowedOrigins: [ALLOWED_ORIGIN],
      router: appRouter,
      enableSwagger: true,
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed test data
    const user = await createTestUser({ email: "smoke.test.trader@nivora.in" });
    const account = await createTestAccount(user._id, {
      accountNumber: 1,
      status: "ACTIVE",
      initialBalancePaise: 100_000_000,
      cashBalancePaise: 100_000_000,
    });

    // Seed tradable instrument
    await createTestInstrument({
      symbol: "RELIANCE",
      name: "Reliance Industries",
      exchange: "NSE",
      lastPricePaise: 250_000,
      bidPricePaise: 249_950,
      askPricePaise: 250_050,
      isTradable: true,
    });

    const now = new Date();
    const session = new SessionModel({
      userId: user._id,
      currentRefreshTokenHash: "a".repeat(64),
      ipAddress: "127.0.0.1",
      userAgent: "SmokeRunner",
      status: "ACTIVE",
      createdAt: now,
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    await session.save();

    testAuthToken = jwtService.generateAccessToken({
      userId: user._id.toString(),
      sessionId: session._id.toString(),
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await teardownIntegrationTestDb();
  });

  it("executes the complete automated smoke suite and reports 100% pass rate", async () => {
    const report = await runSmokeSuite({
      targetUrl: baseUrl,
      authToken: testAuthToken,
      verbose: true,
    });

    assert.equal(report.totalFailed, 0, `Expected 0 failures, got ${report.totalFailed}`);
    assert.ok(report.totalPassed >= 7, `Expected at least 7 stages passed, got ${report.totalPassed}`);
    assert.ok(report.totalDurationMs > 0);

    // Verify all stage results passed
    for (const res of report.results) {
      assert.equal(
        res.passed,
        true,
        `Stage failed: [${res.stage}] ${res.name}: ${res.error}`
      );
    }
  });
});

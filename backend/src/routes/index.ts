import { RequestHandler, Router } from "express";
import { AuthRouterDependencies, createAuthRouter } from "../modules/auth/auth.routes";
import { createAuthMiddleware } from "../modules/auth/auth.middleware";
import { JwtService } from "../modules/auth/jwt.service";
import { InstrumentController } from "../modules/instruments/instrument.controller";
import { createInstrumentRouter } from "../modules/instruments/instrument.routes";
import { WatchlistController } from "../modules/watchlist/watchlist.controller";
import { WatchlistService } from "../modules/watchlist/watchlist.service";
import { createWatchlistRouter } from "../modules/watchlist/watchlist.routes";
import { OrderController } from "../modules/orders/order.controller";
import { createOrderRouter } from "../modules/orders/order.routes";
import { PortfolioController } from "../modules/portfolio/portfolio.controller";
import { createPortfolioRouter } from "../modules/portfolio/portfolio.routes";
import { TradeController } from "../modules/trades/trade.controller";
import { createTradeRouter } from "../modules/trades/trade.routes";
import { AccountController } from "../modules/practice-accounts/account.controller";
import { createAccountRouter } from "../modules/practice-accounts/account.routes";

export interface AppRouterDependencies {
  authDependencies: AuthRouterDependencies;
  jwtService?: JwtService;
  instrumentController?: InstrumentController;
  watchlistController?: WatchlistController;
  orderController?: OrderController;
  portfolioController?: PortfolioController;
  tradeController?: TradeController;
  accountController?: AccountController;
}

export function createAppRouter(dependencies: AppRouterDependencies): Router {
  const router = Router();

  // /auth routes
  router.use("/auth", createAuthRouter(dependencies.authDependencies));

  // /api/v1 routes
  const apiV1Router = Router();
  const jwtService =
    dependencies.jwtService ?? dependencies.authDependencies.jwtService;
  if (!jwtService) {
    throw new Error(
      "JwtService must be provided to initialize API router authentication."
    );
  }
  const authMiddleware: RequestHandler = createAuthMiddleware(jwtService);

  const instrumentController =
    dependencies.instrumentController ?? new InstrumentController();
  const watchlistController =
    dependencies.watchlistController ??
    new WatchlistController({ watchlistService: new WatchlistService() });
  const orderController =
    dependencies.orderController ?? new OrderController();
  const portfolioController =
    dependencies.portfolioController ?? new PortfolioController();
  const tradeController =
    dependencies.tradeController ?? new TradeController();
  const accountController =
    dependencies.accountController ?? new AccountController();

  apiV1Router.use(
    "/instruments",
    authMiddleware,
    createInstrumentRouter(instrumentController)
  );
  apiV1Router.use(
    "/watchlist",
    createWatchlistRouter(watchlistController, authMiddleware)
  );
  apiV1Router.use(
    "/orders",
    createOrderRouter(orderController, authMiddleware)
  );
  apiV1Router.use(
    "/portfolio",
    createPortfolioRouter(portfolioController, authMiddleware)
  );
  apiV1Router.use(
    "/trades",
    createTradeRouter(tradeController, authMiddleware)
  );
  apiV1Router.use(
    "/accounts",
    createAccountRouter(accountController, authMiddleware)
  );

  router.use("/api/v1", apiV1Router);

  return router;
}

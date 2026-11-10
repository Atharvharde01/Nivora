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

export interface AppRouterDependencies {
  authDependencies: AuthRouterDependencies;
  jwtService?: JwtService;
  instrumentController?: InstrumentController;
  watchlistController?: WatchlistController;
  orderController?: OrderController;
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

  router.use("/api/v1", apiV1Router);

  return router;
}

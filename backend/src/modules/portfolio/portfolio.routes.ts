import { Router, RequestHandler } from "express";
import { PortfolioController } from "./portfolio.controller";

export function createPortfolioRouter(
  controller: PortfolioController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/", controller.getPortfolio);
  router.get("/positions/:instrumentId", controller.getPositionByInstrumentId);

  return router;
}

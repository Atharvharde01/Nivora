import { Router, RequestHandler } from "express";
import { PortfolioController } from "./portfolio.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  instrumentIdParamsSchema,
  portfolioQuerySchema,
} from "../../shared/validation/schemas";

export function createPortfolioRouter(
  controller: PortfolioController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get(
    "/",
    validateRequest({ query: portfolioQuerySchema }),
    controller.getPortfolio
  );
  router.get(
    "/positions/:instrumentId",
    validateRequest({
      params: instrumentIdParamsSchema,
      query: portfolioQuerySchema,
    }),
    controller.getPositionByInstrumentId
  );

  return router;
}

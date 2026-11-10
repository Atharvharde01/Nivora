import { Router, RequestHandler } from "express";
import { TradeController } from "./trade.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  listTradesQuerySchema,
  tradeIdParamsSchema,
} from "../../shared/validation/schemas";

export function createTradeRouter(
  controller: TradeController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get(
    "/",
    validateRequest({ query: listTradesQuerySchema }),
    controller.listTrades
  );
  router.get(
    "/:tradeId",
    validateRequest({ params: tradeIdParamsSchema }),
    controller.getTradeById
  );

  return router;
}

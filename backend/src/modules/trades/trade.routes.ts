import { Router, RequestHandler } from "express";
import { TradeController } from "./trade.controller";

export function createTradeRouter(
  controller: TradeController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/", controller.listTrades);
  router.get("/:tradeId", controller.getTradeById);

  return router;
}

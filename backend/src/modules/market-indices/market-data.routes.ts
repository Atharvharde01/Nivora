import { Router } from "express";
import {
  instrumentIdParamsSchema,
  marketCandlesQuerySchema,
  marketIndexSymbolParamsSchema,
} from "../../shared/validation/schemas";
import { validateRequest } from "../../shared/validation/validation.middleware";
import { MarketDataController } from "./market-data.controller";

export function createMarketDataRouter(
  controller: MarketDataController = new MarketDataController()
): Router {
  const router = Router();

  router.get("/indices", controller.listIndices);

  router.get(
    "/indices/:symbol",
    validateRequest({ params: marketIndexSymbolParamsSchema }),
    controller.getIndexBySymbol
  );

  router.get(
    "/indices/:symbol/candles",
    validateRequest({
      params: marketIndexSymbolParamsSchema,
      query: marketCandlesQuerySchema,
    }),
    controller.getIndexCandles
  );

  router.get(
    "/instruments/:instrumentId/candles",
    validateRequest({
      params: instrumentIdParamsSchema,
      query: marketCandlesQuerySchema,
    }),
    controller.getInstrumentCandles
  );

  return router;
}

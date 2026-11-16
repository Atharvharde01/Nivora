import { Router } from "express";
import { InstrumentController } from "./instrument.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  instrumentIdParamsSchema,
  searchInstrumentsQuerySchema,
} from "../../shared/validation/schemas";

export function createInstrumentRouter(
  controller: InstrumentController
): Router {
  const router = Router();

  router.get(
    "/",
    validateRequest({ query: searchInstrumentsQuerySchema }),
    controller.searchInstruments
  );
  router.get(
    "/:instrumentId",
    validateRequest({ params: instrumentIdParamsSchema }),
    controller.getInstrumentById
  );
  router.get(
    "/:instrumentId/quote",
    validateRequest({ params: instrumentIdParamsSchema }),
    controller.getInstrumentQuote
  );

  return router;
}

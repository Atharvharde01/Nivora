import { Router } from "express";
import { InstrumentController } from "./instrument.controller";

export function createInstrumentRouter(
  controller: InstrumentController
): Router {
  const router = Router();

  router.get("/", controller.searchInstruments);
  router.get("/:instrumentId", controller.getInstrumentById);
  router.get("/:instrumentId/quote", controller.getInstrumentQuote);

  return router;
}

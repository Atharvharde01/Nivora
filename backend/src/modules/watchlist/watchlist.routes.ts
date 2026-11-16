import { Router, RequestHandler } from "express";
import { WatchlistController } from "./watchlist.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  addWatchlistItemBodySchema,
  instrumentIdParamsSchema,
  reorderWatchlistBodySchema,
} from "../../shared/validation/schemas";

export function createWatchlistRouter(
  controller: WatchlistController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/", controller.getWatchlist);
  router.post(
    "/items",
    validateRequest({ body: addWatchlistItemBodySchema }),
    controller.addItem
  );
  router.delete(
    "/items/:instrumentId",
    validateRequest({ params: instrumentIdParamsSchema }),
    controller.removeItem
  );
  router.patch(
    "/reorder",
    validateRequest({ body: reorderWatchlistBodySchema }),
    controller.reorderWatchlist
  );

  return router;
}

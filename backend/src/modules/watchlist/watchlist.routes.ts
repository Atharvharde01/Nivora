import { Router, RequestHandler } from "express";
import { WatchlistController } from "./watchlist.controller";

export function createWatchlistRouter(
  controller: WatchlistController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/", controller.getWatchlist);
  router.post("/items", controller.addItem);
  router.delete("/items/:instrumentId", controller.removeItem);
  router.patch("/reorder", controller.reorderWatchlist);

  return router;
}

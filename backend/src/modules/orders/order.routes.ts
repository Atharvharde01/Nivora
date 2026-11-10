import { Router, RequestHandler } from "express";
import { OrderController } from "./order.controller";

export function createOrderRouter(
  controller: OrderController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.post("/", controller.createOrder);
  router.get("/", controller.listOrders);
  router.get("/:orderId", controller.getOrderById);

  return router;
}

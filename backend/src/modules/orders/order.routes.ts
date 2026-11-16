import { Router, RequestHandler } from "express";
import { OrderController } from "./order.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  createOrderBodySchema,
  idempotencyKeyHeaderObjectSchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
} from "../../shared/validation/schemas";
import { tradingRateLimiter } from "../../shared/security";

export function createOrderRouter(
  controller: OrderController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.post(
    "/",
    tradingRateLimiter,
    validateRequest({
      headers: idempotencyKeyHeaderObjectSchema,
      body: createOrderBodySchema,
    }),
    controller.createOrder
  );
  router.get(
    "/",
    validateRequest({ query: listOrdersQuerySchema }),
    controller.listOrders
  );
  router.get(
    "/:orderId",
    validateRequest({ params: orderIdParamsSchema }),
    controller.getOrderById
  );

  return router;
}

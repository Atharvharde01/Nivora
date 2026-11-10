import { Router, RequestHandler } from "express";
import { AccountController } from "./account.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import {
  accountIdParamsSchema,
  idempotencyKeyHeaderObjectSchema,
  listLedgerQuerySchema,
  paginationQuerySchema,
  resetAccountBodySchema,
} from "../../shared/validation/schemas";

export function createAccountRouter(
  controller: AccountController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/active", controller.getActiveAccount);
  router.get(
    "/",
    validateRequest({ query: paginationQuerySchema }),
    controller.listAccounts
  );
  router.get(
    "/:accountId",
    validateRequest({ params: accountIdParamsSchema }),
    controller.getAccountById
  );
  router.get(
    "/:accountId/balance",
    validateRequest({ params: accountIdParamsSchema }),
    controller.getAccountBalance
  );
  router.get(
    "/:accountId/ledger",
    validateRequest({
      params: accountIdParamsSchema,
      query: listLedgerQuerySchema,
    }),
    controller.getAccountLedger
  );
  router.post(
    "/reset",
    validateRequest({
      headers: idempotencyKeyHeaderObjectSchema,
      body: resetAccountBodySchema,
    }),
    controller.resetAccount
  );

  return router;
}

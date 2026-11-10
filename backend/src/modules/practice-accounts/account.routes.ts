import { Router, RequestHandler } from "express";
import { AccountController } from "./account.controller";

export function createAccountRouter(
  controller: AccountController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.get("/active", controller.getActiveAccount);
  router.get("/", controller.listAccounts);
  router.get("/:accountId", controller.getAccountById);
  router.get("/:accountId/balance", controller.getAccountBalance);
  router.get("/:accountId/ledger", controller.getAccountLedger);
  router.post("/reset", controller.resetAccount);

  return router;
}

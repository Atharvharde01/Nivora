import { Router, RequestHandler } from "express";
import { UserController } from "./user.controller";
import { validateRequest } from "../../shared/validation/validation.middleware";
import { updateUserProfileBodySchema } from "../../shared/validation/schemas";

export function createUserRouter(
  controller: UserController,
  authMiddleware: RequestHandler
): Router {
  const router = Router();

  router.use(authMiddleware);

  router.patch(
    "/me/profile",
    validateRequest({ body: updateUserProfileBodySchema }),
    controller.updateMyProfile
  );

  return router;
}

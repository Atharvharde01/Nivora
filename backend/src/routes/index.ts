import { Router } from "express";
import { AuthRouterDependencies, createAuthRouter } from "../modules/auth/auth.routes";

export interface AppRouterDependencies {
  authDependencies: AuthRouterDependencies;
}

export function createAppRouter(dependencies: AppRouterDependencies): Router {
  const router = Router();

  router.use("/auth", createAuthRouter(dependencies.authDependencies));

  return router;
}

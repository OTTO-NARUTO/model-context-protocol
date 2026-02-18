import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validationMiddleware.js";

const authParamSchema = z.object({
  params: z.object({
    provider: z.string()
  }),
  body: z.object({}).optional().default({}),
  query: z.object({}).passthrough().optional().default({})
});

const repoQuerySchema = z.object({
  params: z.object({}).optional().default({}),
  body: z.object({}).optional().default({}),
  query: z.object({
    provider: z.string().min(1)
  })
});

export function buildAuthRoutes(controller) {
  const router = Router();

  router.get("/:provider/connect", validate(authParamSchema), controller.connect);
  router.get("/:provider/callback", validate(authParamSchema), controller.callback);
  router.get("/:provider/status", validate(authParamSchema), controller.status);
  router.post("/:provider/disconnect", validate(authParamSchema), controller.disconnect);
  router.get("/repos/list", validate(repoQuerySchema), controller.repos);

  return router;
}

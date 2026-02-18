import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validationMiddleware.js";

const evaluateSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: z.object({
    controlId: z.string().min(1),
    provider: z.string().min(1),
    repoName: z.string().min(1)
  })
});

export function buildComplianceRoutes(controller) {
  const router = Router();
  router.post("/evaluate", validate(evaluateSchema), controller.evaluateControl);
  return router;
}

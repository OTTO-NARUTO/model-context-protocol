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

const evaluateStandardSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: z.object({
    standard: z.string().min(1),
    provider: z.string().min(1),
    repoName: z.string().min(1).optional(),
    repoNames: z.array(z.string().min(1)).min(1).optional()
  }).refine((body) => {
    const hasSingle = typeof body.repoName === "string" && body.repoName.trim().length > 0;
    const hasMulti = Array.isArray(body.repoNames) && body.repoNames.length > 0;
    return hasSingle || hasMulti;
  }, {
    message: "Provide repoName or repoNames with at least one repository."
  })
});

const debugToolsSchema = z.object({
  params: z.object({
    provider: z.string().min(1)
  }),
  query: z.object({}).optional().default({}),
  body: z.object({}).optional().default({})
});

export function buildComplianceRoutes(controller) {
  const router = Router();
  router.get("/debug/:provider", validate(debugToolsSchema), controller.debugTools);
  router.post("/evaluate", validate(evaluateSchema), controller.evaluateControl);
  router.post("/evaluate-standard", validate(evaluateStandardSchema), controller.evaluateStandard);
  return router;
}

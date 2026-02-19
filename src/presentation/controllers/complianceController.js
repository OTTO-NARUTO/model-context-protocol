import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { isProvider } from "../../domain/entities/provider.js";
import EvaluationEngine from "../../application/services/EvaluationEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

const evaluationEngine = new EvaluationEngine();

function getMapping(standard) {
  const fileName = String(standard ?? "").toLowerCase() === "iso27001"
    ? "iso27001_mapping.json"
    : "soc2_mapping.json";

  const filePath = path.join(projectRoot, "question_mapping", fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Mapping file not found at: ${filePath}`);
  }

  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function resolveToolName(mcpTool, provider) {
  if (typeof mcpTool === "string") {
    return mcpTool;
  }

  if (mcpTool && typeof mcpTool === "object") {
    const value = mcpTool[String(provider ?? "").toLowerCase()];
    return typeof value === "string" ? value : "";
  }

  return "";
}

function getControlEntry(controlId) {
  const allMappings = [...getMapping("iso27001"), ...getMapping("soc2")];
  return allMappings.find((item) => String(item?.control_id ?? "") === String(controlId));
}

export class ComplianceController {
  constructor(oauthService, mcpClient) {
    this.oauthService = oauthService;
    this.mcpClient = mcpClient;
  }

  evaluateControl = async (req, res) => {
    const { controlId, provider, repoName } = req.body ?? {};
    const [owner, repo] = String(repoName ?? "").split("/");

    try {
      if (!isProvider(provider)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      if (!owner || !repo) {
        res.status(400).json({ error: "repoName must be in 'owner/repo' format" });
        return;
      }

      const tenantId = req.tenantId;
      const plan = getControlEntry(controlId);
      if (!plan) {
        res.status(404).json({ error: `Control ${controlId} not found in question_mapping files.` });
        return;
      }

      const toolName = resolveToolName(plan.mcp_tool, provider);
      if (!toolName) {
        res.status(400).json({ error: `No ${provider} tool mapped for control ${controlId}.` });
        return;
      }

      const token = await this.oauthService.getAccessToken(provider, tenantId);

      const evidence = await this.mcpClient.callTool(
        provider,
        toolName,
        { owner, repo },
        token
      );

      const evidencePayload = evidence?.raw ?? evidence?.standardized ?? evidence;
      const verdict = evaluationEngine.evaluate(controlId, evidencePayload);

      res.json({
        control: controlId,
        description: plan.control_name,
        question: plan.question,
        answer: verdict.answer,
        evidence_source: plan.evidence_source,
        tool_used: toolName,
        status: verdict.status,
        findings: verdict.findings,
        metadata: verdict.metadata,
        evidence: evidencePayload,
        traceId: evidence.traceId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evaluation failed.";
      const code = message.includes("No OAuth token found") ? 401 : 400;
      res.status(code).json({ error: message });
    }
  };

  evaluateStandard = async (req, res) => {
    const { standard, provider, repoName } = req.body ?? {};
    const normalizedStandard = String(standard ?? "").toUpperCase();
    const [owner, repo] = String(repoName ?? "").split("/");

    try {
      if (!isProvider(provider)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      if (!owner || !repo) {
        res.status(400).json({ error: "repoName must be in 'owner/repo' format" });
        return;
      }

      const mappings = getMapping(normalizedStandard);
      if (mappings.length === 0) {
        res.status(404).json({ error: `No repo-related controls found for ${normalizedStandard}` });
        return;
      }

      const tenantId = req.tenantId;
      const token = await this.oauthService.getAccessToken(provider, tenantId);

      const results = [];
      for (const item of mappings) {
        try {
          const toolName = resolveToolName(item.mcp_tool, provider);
          if (!toolName) {
            throw new Error(`No ${provider} tool mapped for control ${item.control_id}.`);
          }

          const evidence = await this.mcpClient.callTool(
            provider,
            toolName,
            { owner, repo },
            token
          );

          const evidencePayload = evidence?.raw ?? evidence?.standardized ?? evidence;
          const verdict = evaluationEngine.evaluate(item.control_id, evidencePayload);

          results.push({
            control: item.control_id,
            description: item.control_name,
            question: item.question,
            answer: verdict.answer,
            evidence_source: item.evidence_source,
            tool_used: toolName,
            status: verdict.status,
            findings: verdict.findings,
            metadata: verdict.metadata,
            traceId: evidence?.traceId ?? randomUUID()
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Evaluation failed.";
          results.push({
            control: item.control_id,
            description: item.control_name,
            question: item.question,
            answer: "Unable to determine due to evaluation error.",
            evidence_source: item.evidence_source,
            tool_used: resolveToolName(item.mcp_tool, provider),
            status: "ERROR",
            findings: message,
            metadata: { error: true },
            traceId: randomUUID()
          });
        }
      }

      res.json({
        standard: normalizedStandard,
        repository: `${owner}/${repo}`,
        timestamp: new Date().toISOString(),
        summary: {
          total: results.length,
          compliant: results.filter((item) => item.status === "COMPLIANT").length,
          non_compliant: results.filter((item) => item.status === "NON_COMPLIANT").length,
          errors: results.filter((item) => item.status === "ERROR").length
        },
        results
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evaluation failed.";
      const code = message.includes("No OAuth token found") ? 401 : 400;
      res.status(code).json({ error: message });
    }
  };

  debugTools = async (req, res) => {
    const provider = String(req.params.provider ?? "");

    try {
      if (!isProvider(provider)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }

      const tenantId = req.tenantId;
      const token = await this.oauthService.getAccessToken(provider, tenantId);
      const tools = await this.mcpClient.listTools(provider, token);
      res.json({ provider, tools });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool discovery failed.";
      const code = message.includes("No OAuth token found") ? 401 : 500;
      res.status(code).json({ error: message });
    }
  };
}

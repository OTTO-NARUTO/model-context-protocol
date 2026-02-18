import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { isProvider } from "../../domain/entities/provider.js";
import EvidenceMappingTool from "../../application/services/EvidenceMappingTool.js";
import EvaluationEngine from "../../application/services/EvaluationEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

function readJson(relativePath) {
  const fullPath = path.resolve(projectRoot, relativePath);
  const raw = readFileSync(fullPath, "utf-8");
  return JSON.parse(raw);
}

const isoData = readJson("compliance/mcp-tool-mapping/ISO27001_Repo_Controls.json");
const socData = readJson("compliance/mcp-tool-mapping/SOC2_Repo_Controls.json");
const mapper = new EvidenceMappingTool(isoData, socData);
const evaluationEngine = new EvaluationEngine();

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
      const plan = mapper.getMapping(controlId, provider);
      const token = await this.oauthService.getAccessToken(provider, tenantId);

      const evidence = await this.mcpClient.callTool(
        provider,
        plan.mcpMethod,
        { owner, repo, ...plan.params },
        token
      );

      const evidencePayload = evidence?.raw ?? evidence?.standardized ?? evidence;
      const verdict = evaluationEngine.evaluate(controlId, evidencePayload);

      res.json({
        control: controlId,
        description: plan.controlName,
        evidence_source: plan.evidenceSource,
        tool_used: plan.mcpMethod,
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
}

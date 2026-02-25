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

function normalizeRepoNames(repoName, repoNames) {
  const repos = Array.isArray(repoNames)
    ? repoNames
    : (repoName ? [repoName] : []);

  return repos
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function parseRepoCoordinates(fullRepoName) {
  const [owner, repo] = String(fullRepoName ?? "").split("/");
  return { owner, repo };
}

function extractEvidencePayload(evidence) {
  return evidence?.raw ?? evidence?.standardized ?? evidence;
}

function isUnknownToolError(message) {
  return /unknown tool/i.test(String(message ?? ""));
}

function isRetryableToolError(message) {
  return /unknown tool|missing required parameter|required parameter/i.test(String(message ?? ""));
}

function buildToolCoverage(controlId, provider, evidencePayload) {
  const isGithub518 =
    String(controlId ?? "") === "5.18" &&
    String(provider ?? "").toLowerCase() === "github";
  if (!isGithub518) {
    return null;
  }

  const diagnostics = evidencePayload?.diagnostics ?? {};
  const requiredTools = Array.isArray(diagnostics?.requiredTools)
    ? diagnostics.requiredTools.map((item) => String(item))
    : ["list_collaborators", "get_repository"];
  const availableTools = Array.isArray(diagnostics?.availableTools)
    ? diagnostics.availableTools.map((item) => String(item))
    : [];
  const missingTools = Array.isArray(diagnostics?.missingRequiredTools)
    ? diagnostics.missingRequiredTools.map((item) => String(item))
    : requiredTools.filter((name) => !availableTools.includes(name));

  return {
    required_tools: requiredTools,
    available_tools: availableTools,
    missing_tools: missingTools
  };
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

      const collected = await this.collectEvidence({
        controlId,
        provider,
        toolName,
        owner,
        repo,
        token
      });
      const evidencePayload = collected.evidencePayload;
      const verdict = evaluationEngine.evaluate(controlId, evidencePayload, {
        controlId,
        controlName: plan.control_name,
        question: plan.question,
        evidenceSource: plan.evidence_source,
        toolName: collected.toolUsed,
        provider
      });
      const toolCoverage = buildToolCoverage(controlId, provider, evidencePayload);

      res.json({
        control: controlId,
        description: plan.control_name,
        question: plan.question,
        answer: verdict.answer,
        compliant: verdict.compliant,
        evidence_source: plan.evidence_source,
        tool_used: collected.toolUsed,
        status: verdict.status,
        findings: verdict.findings,
        metadata: verdict.metadata,
        evidence: evidencePayload,
        traceId: collected.traceId,
        ...(toolCoverage ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evaluation failed.";
      const code = message.includes("No OAuth token found") ? 401 : 400;
      res.status(code).json({ error: message });
    }
  };

  evaluateStandard = async (req, res) => {
    const { standard, provider, repoName, repoNames } = req.body ?? {};
    const normalizedStandard = String(standard ?? "").toUpperCase();
    const normalizedRepos = normalizeRepoNames(repoName, repoNames);

    try {
      if (!isProvider(provider)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      if (normalizedRepos.length === 0) {
        res.status(400).json({ error: "repoName or repoNames is required." });
        return;
      }

      const invalidRepo = normalizedRepos.find((fullRepoName) => {
        const { owner, repo } = parseRepoCoordinates(fullRepoName);
        return !owner || !repo;
      });
      if (invalidRepo) {
        res.status(400).json({ error: `Invalid repository '${invalidRepo}'. Expected 'owner/repo' format.` });
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
      for (const fullRepoName of normalizedRepos) {
        const { owner, repo } = parseRepoCoordinates(fullRepoName);

        for (const item of mappings) {
          try {
            const toolName = resolveToolName(item.mcp_tool, provider);
            if (!toolName) {
              throw new Error(`No ${provider} tool mapped for control ${item.control_id}.`);
            }

            const collected = await this.collectEvidence({
              controlId: item.control_id,
              provider,
              toolName,
              owner,
              repo,
              token
            });
            const evidencePayload = collected.evidencePayload;
            const verdict = evaluationEngine.evaluate(item.control_id, evidencePayload, {
              controlId: item.control_id,
              controlName: item.control_name,
              question: item.question,
              evidenceSource: item.evidence_source,
              toolName: collected.toolUsed,
              provider
            });
            const toolCoverage = buildToolCoverage(item.control_id, provider, evidencePayload);

            results.push({
              repository: fullRepoName,
              control: item.control_id,
              description: item.control_name,
              question: item.question,
              answer: verdict.answer,
              compliant: verdict.compliant,
              evidence_source: item.evidence_source,
              tool_used: collected.toolUsed,
              status: verdict.status,
              findings: verdict.findings,
              metadata: verdict.metadata,
              traceId: collected.traceId ?? randomUUID(),
              ...(toolCoverage ?? {})
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Evaluation failed.";
            results.push({
              repository: fullRepoName,
              control: item.control_id,
              description: item.control_name,
              question: item.question,
              answer: "Unable to determine due to evaluation error.",
              compliant: null,
              evidence_source: item.evidence_source,
              tool_used: resolveToolName(item.mcp_tool, provider),
              status: "ERROR",
              findings: message,
              metadata: { error: true },
              traceId: randomUUID()
            });
          }
        }
      }

      res.json({
        standard: normalizedStandard,
        repository: normalizedRepos.length === 1 ? normalizedRepos[0] : undefined,
        repositories: normalizedRepos,
        timestamp: new Date().toISOString(),
        summary: {
          repositories: normalizedRepos.length,
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

  collectEvidence = async ({ controlId, provider, toolName, owner, repo, token }) => {
    const normalizedProvider = String(provider ?? "").toLowerCase();
    const normalizedControlId = String(controlId ?? "");
    const args = { owner, repo };

    if (normalizedProvider === "github" && normalizedControlId === "5.18") {
      const available = await this.safeListToolNames(provider, token);
      const requiredTools = ["list_collaborators", "get_repository"];
      const availableSet = new Set(available);
      const missingRequiredTools = requiredTools.filter((name) => !availableSet.has(name));

      if (missingRequiredTools.length > 0) {
        return {
          toolUsed: "",
          traceId: randomUUID(),
          evidencePayload: {
            membership: [],
            repository: null,
            diagnostics: {
              requiredTools,
              availableTools: available,
              missingRequiredTools,
              availableToolsDetected: available.length > 0,
              policy: "GitHub 5.18 requires list_collaborators and get_repository for accurate evaluation."
            }
          }
        };
      }

      const collaboratorEvidence = await this.mcpClient.callTool(
        provider,
        "list_collaborators",
        args,
        token
      );
      const repositoryEvidence = await this.mcpClient.callTool(
        provider,
        "get_repository",
        args,
        token
      );

      const repositoryPayload = extractEvidencePayload(repositoryEvidence);
      const collaboratorPayload = extractEvidencePayload(collaboratorEvidence);
      const traceId = collaboratorEvidence?.traceId ?? repositoryEvidence?.traceId ?? randomUUID();
      return {
        toolUsed: "list_collaborators+get_repository",
        traceId,
        evidencePayload: {
          membership: collaboratorPayload,
          repository: repositoryPayload
        }
      };
    }

    const evidence = await this.mcpClient.callTool(provider, toolName, args, token);
    return {
      toolUsed: toolName,
      traceId: evidence?.traceId ?? randomUUID(),
      evidencePayload: extractEvidencePayload(evidence)
    };
  };

  safeListToolNames = async (provider, token) => {
    try {
      const tools = await this.mcpClient.listTools(provider, token);
      return tools.map((item) => String(item?.name ?? "")).filter(Boolean);
    } catch {
      return [];
    }
  };

  filterSupportedTools = (candidates, availableNames) => {
    const deduped = [...new Set(candidates.filter(Boolean))];
    if (!Array.isArray(availableNames) || availableNames.length === 0) {
      return deduped;
    }
    const availableSet = new Set(availableNames);
    return deduped.filter((name) => availableSet.has(name));
  };

  callToolCandidates = async (provider, tools, paramVariants, token, options = {}) => {
    const candidateTools = Array.isArray(tools) ? tools.filter(Boolean) : [];
    const variants = Array.isArray(paramVariants) ? paramVariants : [{}];
    const allowFailure = Boolean(options?.allowFailure);
    let lastErrorMessage = "";

    for (const tool of candidateTools) {
      for (const params of variants) {
        try {
          const evidence = await this.mcpClient.callTool(provider, tool, params, token);
          return { toolUsed: tool, evidence, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "");
          lastErrorMessage = message;
          if (!isRetryableToolError(message)) {
            if (allowFailure) {
              return { toolUsed: "", evidence: null, error: message };
            }
            throw error;
          }
        }
      }
    }

    if (allowFailure) {
      return {
        toolUsed: "",
        evidence: null,
        error: lastErrorMessage || `No compatible tool found. Tried: ${candidateTools.join(", ")}`
      };
    }

    return {
      toolUsed: "",
      evidence: null,
      error: lastErrorMessage || "No compatible membership tool found.",
    };
  };
}

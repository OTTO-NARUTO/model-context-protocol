import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { isProvider } from "../../domain/entities/provider.js";
import EvaluationEngine from "../../application/services/EvaluationEngine.js";
import { ReportFormatter } from "../../application/services/reportFormatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

const evaluationEngine = new EvaluationEngine();
const reportFormatter = new ReportFormatter();
const controlLogicCatalog = buildControlLogicCatalog();

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

function buildControlLogicCatalog() {
  const fileSpecs = [
    { standard: "ISO27001", file: "ISO27001_Repo_Controls.json" },
    { standard: "SOC2", file: "SOC2_Repo_Controls.json" }
  ];

  const out = {};
  for (const spec of fileSpecs) {
    const filePath = path.join(projectRoot, "compliance", "mcp-tool-mapping", spec.file);
    if (!existsSync(filePath)) {
      continue;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      parsed = null;
    }
    const controls = Array.isArray(parsed?.controls) ? parsed.controls : [];
    for (const control of controls) {
      const controlCode = String(control?.control_code ?? "");
      if (!controlCode) continue;
      const mapping = Array.isArray(control?.mappings) ? control.mappings[0] : null;
      const logic = mapping?.logic && typeof mapping.logic === "object" ? mapping.logic : null;
      if (!logic) continue;
      out[`${spec.standard}:${controlCode}`] = logic;
    }
  }

  return out;
}

function getControlLogic(controlId, standard) {
  const normalizedControl = String(controlId ?? "");
  const normalizedStandard = String(standard ?? "").toUpperCase();
  const directKey = `${normalizedStandard}:${normalizedControl}`;
  if (controlLogicCatalog[directKey]) {
    return controlLogicCatalog[directKey];
  }

  // Fallback: look up by control id only if unique in catalog.
  const matches = Object.entries(controlLogicCatalog)
    .filter(([key]) => key.endsWith(`:${normalizedControl}`))
    .map(([, value]) => value);

  if (matches.length === 1) {
    return matches[0];
  }
  return null;
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

function normalizePreference(value) {
  const normalized = String(value ?? "prefer_mcp").toLowerCase();
  const allowed = new Set(["prefer_mcp", "prefer_rest", "mcp_only", "rest_only"]);
  return allowed.has(normalized) ? normalized : "prefer_mcp";
}

function extractEvidencePayload(evidence) {
  return evidence?.raw ?? evidence?.standardized ?? evidence;
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
  constructor(oauthService, toolExecutionStrategy) {
    this.oauthService = oauthService;
    this.toolExecutionStrategy = toolExecutionStrategy;
  }

  evaluateControl = async (req, res) => {
    const { controlId, provider, repoName, executionPreference } = req.body ?? {};
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
        token,
        preference: normalizePreference(executionPreference)
      });
      const evaluatedAt = new Date().toISOString();
      const evidencePayload = collected.evidencePayload;
      const verdict = evaluationEngine.evaluate(controlId, evidencePayload, {
        controlId,
        controlName: plan.control_name,
        question: plan.question,
        evidenceSource: plan.evidence_source,
        toolName: collected.toolUsed,
        provider,
        logic: getControlLogic(controlId)
      });
      const toolCoverage = buildToolCoverage(controlId, provider, evidencePayload);

      res.json({
        control: controlId,
        evaluated_at: evaluatedAt,
        description: plan.control_name,
        question: plan.question,
        answer: verdict.answer,
        compliant: verdict.compliant,
        evidence_source: plan.evidence_source,
        tool_used: collected.toolUsed,
        status: verdict.status,
        fail_reason: verdict.failReason,
        evidence_snapshot: verdict.evidenceSnapshot,
        findings: verdict.findings,
        metadata: verdict.metadata,
        evidence: evidencePayload,
        traceId: collected.traceId,
        report: reportFormatter.formatControlReport({
          repository: repoName,
          control: controlId,
          description: plan.control_name,
          question: plan.question,
          status: verdict.status,
          compliant: verdict.compliant,
          fail_reason: verdict.failReason,
          evaluated_at: evaluatedAt,
          evidence_source: plan.evidence_source,
          tool_used: collected.toolUsed
        }),
        ...(toolCoverage ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evaluation failed.";
      const code = message.includes("No OAuth token found") ? 401 : 400;
      res.status(code).json({ error: message });
    }
  };

  evaluateStandard = async (req, res) => {
    const { standard, provider, repoName, repoNames, executionPreference } = req.body ?? {};
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
              token,
              preference: normalizePreference(executionPreference)
            });
            const evidencePayload = collected.evidencePayload;
            const verdict = evaluationEngine.evaluate(item.control_id, evidencePayload, {
              controlId: item.control_id,
              controlName: item.control_name,
              question: item.question,
              evidenceSource: item.evidence_source,
              toolName: collected.toolUsed,
              provider,
              logic: getControlLogic(item.control_id, normalizedStandard)
            });
            const toolCoverage = buildToolCoverage(item.control_id, provider, evidencePayload);

            results.push({
              repository: fullRepoName,
              evaluated_at: new Date().toISOString(),
              control: item.control_id,
              description: item.control_name,
              question: item.question,
              answer: verdict.answer,
              compliant: verdict.compliant,
              evidence_source: item.evidence_source,
              tool_used: collected.toolUsed,
              status: verdict.status,
              fail_reason: verdict.failReason,
              evidence_snapshot: verdict.evidenceSnapshot,
              findings: verdict.findings,
              metadata: verdict.metadata,
              traceId: collected.traceId ?? randomUUID(),
              ...(toolCoverage ?? {})
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Evaluation failed.";
            results.push({
              repository: fullRepoName,
              evaluated_at: new Date().toISOString(),
              control: item.control_id,
              description: item.control_name,
              question: item.question,
              answer: "Unable to determine due to evaluation error.",
              compliant: null,
              evidence_source: item.evidence_source,
              tool_used: resolveToolName(item.mcp_tool, provider),
              status: "ERROR",
              fail_reason: message,
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
        results,
        report: reportFormatter.formatStandardReport(results)
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
      const tools = await this.toolExecutionStrategy.listTools(provider, token);
      res.json({ provider, tools });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool discovery failed.";
      const code = message.includes("No OAuth token found") ? 401 : 500;
      res.status(code).json({ error: message });
    }
  };

  collectEvidence = async ({ controlId, provider, toolName, owner, repo, token, preference = "prefer_mcp" }) => {
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

      const collaboratorEvidence = await this.toolExecutionStrategy.executeTool({
        provider,
        toolName: "list_collaborators",
        params: args,
        token,
        preference
      });
      const repositoryEvidence = await this.toolExecutionStrategy.executeTool({
        provider,
        toolName: "get_repository",
        params: args,
        token,
        preference
      });

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

    if (normalizedProvider === "github" && normalizedControlId === "8.28") {
      return this.collectCodeReviewEvidence({
        provider,
        owner,
        repo,
        token,
        preference
      });
    }

    const evidence = await this.toolExecutionStrategy.executeTool({
      provider,
      toolName,
      params: args,
      token,
      preference
    });
    return {
      toolUsed: toolName,
      traceId: evidence?.traceId ?? randomUUID(),
      evidencePayload: extractEvidencePayload(evidence)
    };
  };

  safeListToolNames = async (provider, token) => {
    try {
      const tools = await this.toolExecutionStrategy.listTools(provider, token);
      return tools
        .filter((item) => String(item?.selected_mode ?? "") !== "none")
        .map((item) => String(item?.name ?? ""))
        .filter(Boolean);
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
          const evidence = await this.toolExecutionStrategy.executeTool({
            provider,
            toolName: tool,
            params,
            token
          });
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

  collectCodeReviewEvidence = async ({ provider, owner, repo, token, preference = "prefer_mcp" }) => {
    const mergedPrsQuery = `repo:${owner}/${repo} is:pr is:merged`;
    const mergedPrCandidates = [
      {
        toolName: "search_pull_requests",
        params: { owner, repo, query: mergedPrsQuery, perPage: 100, page: 1 }
      },
      {
        toolName: "list_pull_requests",
        params: { owner, repo, state: "closed", perPage: 100, page: 1 }
      }
    ];

    const mergedEvidence = await this.tryToolCandidates(provider, mergedPrCandidates, token, preference);
    if (!mergedEvidence) {
      throw new Error("Unable to collect merged pull requests for control 8.28.");
    }

    const mergedPrItems = this.extractPullRequests(mergedEvidence.payload);
    const mergedPrNumbers = mergedPrItems
      .filter((pr) => this.isMergedPullRequest(pr))
      .map((pr) => this.extractPullNumber(pr))
      .filter((value) => Number.isFinite(value));

    const dedupedPullNumbers = [...new Set(mergedPrNumbers)];
    const pullRequests = [];
    for (const pullNumber of dedupedPullNumbers) {
      const reviewEvidence = await this.tryToolCandidates(
        provider,
        [
          {
            toolName: "pull_request_read",
            params: { owner, repo, pullNumber, method: "get_reviews", perPage: 100, page: 1 }
          },
          {
            toolName: "get_pull_request_reviews",
            params: { owner, repo, pullNumber, perPage: 100, page: 1 }
          }
        ],
        token,
        preference
      );

      const reviews = this.extractReviewItems(reviewEvidence?.payload);
      const approvedReviewsCount = reviews.filter((review) => {
        const state = String(review?.state ?? review?.status ?? "").toUpperCase();
        return state === "APPROVED" || state === "APPROVE";
      }).length;

      pullRequests.push({
        pullNumber,
        approved_reviews_count: approvedReviewsCount
      });
    }

    const zeroMergedPolicy = "COMPLIANT";
    const traceId = mergedEvidence?.traceId ?? randomUUID();
    const reviewToolUsed = pullRequests.length > 0 ? "pull_request_read(get_reviews)" : "none";
    return {
      toolUsed: `${mergedEvidence.toolUsed}+${reviewToolUsed}`,
      traceId,
      evidencePayload: {
        pull_requests: pullRequests,
        merged_pr_count: pullRequests.length,
        zero_merged_policy: zeroMergedPolicy
      }
    };
  };

  tryToolCandidates = async (provider, candidates, token, preference) => {
    for (const candidate of candidates) {
      try {
        console.log(`[8.28] tool_used=${candidate.toolName}`);
        const evidence = await this.toolExecutionStrategy.executeTool({
          provider,
          toolName: candidate.toolName,
          params: candidate.params,
          token,
          preference
        });
        return {
          toolUsed: candidate.toolName,
          traceId: evidence?.traceId ?? randomUUID(),
          payload: extractEvidencePayload(evidence)
        };
      } catch {
        continue;
      }
    }
    return null;
  };

  extractPullRequests = (payload) => {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.items)) {
      return payload.items;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  };

  isMergedPullRequest = (pr) => {
    const state = String(pr?.state ?? "").toLowerCase();
    return Boolean(pr?.merged_at) || state === "merged" || Boolean(pr?.merged_by);
  };

  extractPullNumber = (pr) => {
    const value = pr?.number ?? pr?.pullNumber ?? pr?.pull_number ?? pr?.iid ?? null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  extractReviewItems = (payload) => {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.items)) {
      return payload.items;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    if (Array.isArray(payload?.reviews)) {
      return payload.reviews;
    }
    return [];
  };
}

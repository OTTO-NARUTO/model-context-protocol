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
const ALLOWED_STANDARD = "ISO27001";
const ALLOWED_CONTROLS = new Set(["8.9", "8.28"]);
const controlLogicCatalog = buildControlLogicCatalog();
const isoControlMappings = buildIsoControlMappings();

function getMapping(standard) {
  const normalizedStandard = String(standard ?? "").toUpperCase();
  if (normalizedStandard !== ALLOWED_STANDARD) {
    return [];
  }
  return isoControlMappings;
}

function resolveToolNames(mcpTool, provider) {
  if (Array.isArray(mcpTool)) {
    return mcpTool.map((item) => String(item ?? "")).filter(Boolean);
  }
  if (typeof mcpTool === "string") {
    return [mcpTool];
  }

  if (mcpTool && typeof mcpTool === "object") {
    const value = mcpTool[String(provider ?? "").toLowerCase()];
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "")).filter(Boolean);
    }
    return typeof value === "string" ? [value] : [];
  }

  return [];
}

function getControlEntry(controlId) {
  return getMapping(ALLOWED_STANDARD).find((item) => String(item?.control_id ?? "") === String(controlId));
}

function buildControlLogicCatalog() {
  const filePath = path.join(projectRoot, "compliance", "mcp-tool-mapping", "ISO27001_Repo_Controls.json");
  if (!existsSync(filePath)) {
    return {};
  }

  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    parsed = null;
  }

  const controls = Array.isArray(parsed?.controls) ? parsed.controls : [];
  const out = {};
  for (const control of controls) {
    const controlCode = String(control?.control_code ?? "");
    if (!ALLOWED_CONTROLS.has(controlCode)) continue;
    const mapping = Array.isArray(control?.mappings) ? control.mappings[0] : null;
    const logic = mapping?.logic && typeof mapping.logic === "object" ? mapping.logic : null;
    if (!logic) continue;
    out[`${ALLOWED_STANDARD}:${controlCode}`] = logic;
  }

  return out;
}

function buildIsoControlMappings() {
  const filePath = path.join(projectRoot, "compliance", "mcp-tool-mapping", "ISO27001_Repo_Controls.json");
  if (!existsSync(filePath)) {
    throw new Error(`Mapping file not found at: ${filePath}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    parsed = null;
  }

  const controls = Array.isArray(parsed?.controls) ? parsed.controls : [];
  const out = [];
  for (const control of controls) {
    const controlId = String(control?.control_code ?? "");
    if (!ALLOWED_CONTROLS.has(controlId)) continue;
    const mapping = Array.isArray(control?.mappings) ? control.mappings[0] : null;
    if (!mapping || typeof mapping !== "object") continue;
    out.push({
      control_id: controlId,
      control_name: String(control?.control_name ?? ""),
      evidence_source: String(mapping?.evidence_source ?? ""),
      mcp_tool: mapping?.tools ?? {}
    });
  }
  return out;
}

function getControlLogic(controlId, standard) {
  const normalizedControl = String(controlId ?? "");
  const normalizedStandard = String(standard ?? "").toUpperCase();
  const key = `${normalizedStandard}:${normalizedControl}`;
  return controlLogicCatalog[key] ?? null;
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

function normalizeExecutionMode(mode) {
  const normalized = String(mode ?? "").toLowerCase();
  if (normalized === "mcp") return "MCP";
  if (normalized === "rest") return "REST";
  return "UNKNOWN";
}

function summarizeExecution(executions) {
  const entries = (Array.isArray(executions) ? executions : [])
    .filter((entry) => entry && typeof entry === "object");
  if (entries.length === 0) {
    return {
      apiCall: "UNKNOWN",
      apiCallReason: "Execution metadata unavailable."
    };
  }

  const modes = [...new Set(entries.map((entry) => normalizeExecutionMode(entry.executionMode)).filter(Boolean))];
  const apiCall = modes.length > 0 ? modes.join("+") : "UNKNOWN";
  const reasonParts = entries
    .map((entry) => {
      const tool = String(entry?.toolName ?? "tool");
      const reason = String(entry?.reason ?? "").trim();
      return reason ? `${tool}: ${reason}` : "";
    })
    .filter(Boolean);
  const apiCallReason = reasonParts.length > 0
    ? [...new Set(reasonParts)].join(" | ")
    : "No resolution reason returned.";

  return { apiCall, apiCallReason };
}

function isRetryableToolError(message) {
  return /unknown tool|missing required parameter|required parameter/i.test(String(message ?? ""));
}

function toPublicStatus(status) {
  const normalized = String(status ?? "UNDETERMINED").toUpperCase();
  if (normalized === "COMPLIANT") return "PASS";
  if (normalized === "NON_COMPLIANT") return "FAIL";
  return normalized;
}

function toPassed(status, value) {
  if (value === true || value === false) return value;
  if (status === "PASS") return true;
  if (status === "FAIL") return false;
  return null;
}

function replaceComplianceTerms(text) {
  const source = String(text ?? "");
  if (!source) return source;
  return source
    .replace(/non[- ]compliant/gi, "failed")
    .replace(/\bcompliant\b/gi, "passed");
}

function buildFailureReason(status, verdict) {
  if (String(status) !== "FAIL") {
    return replaceComplianceTerms(verdict?.failReason ?? "");
  }

  const metadata = verdict?.metadata && typeof verdict.metadata === "object"
    ? verdict.metadata
    : {};
  const strategy = String(metadata?.strategy ?? "").toLowerCase();

  if (strategy === "branch_protection") {
    const totalChecked = Number(metadata?.totalChecked ?? 0);
    const protectedCount = Number(metadata?.protectedCount ?? 0);
    const failingBranches = Array.isArray(metadata?.failingItems)
      ? metadata.failingItems
      : Array.isArray(metadata?.unprotectedCriticalBranches)
        ? metadata.unprotectedCriticalBranches
        : [];
    return `Checks run: branch protection on ${totalChecked} branch(es). Failed checks: ${failingBranches.length} unprotected branch(es) (${failingBranches.join(", ") || "unknown"}); protected detected=${protectedCount}.`;
  }

  if (strategy === "review_process") {
    const totalChecked = Number(metadata?.totalChecked ?? 0);
    const threshold = Number(metadata?.threshold ?? 1);
    const failingItems = Array.isArray(metadata?.failingItems) ? metadata.failingItems : [];
    return `Checks run: minimum approvals >= ${threshold} across ${totalChecked} merged change(s). Failed checks: ${failingItems.length} change(s) below threshold (${failingItems.join(", ") || "unknown"}).`;
  }

  if (strategy === "security_testing") {
    const totalChecked = Number(metadata?.totalChecked ?? 0);
    const failCount = Number(metadata?.failCount ?? 0);
    const failedStatuses = Array.isArray(metadata?.failedStatuses) ? metadata.failedStatuses : [];
    return `Checks run: CI/CD security statuses across ${totalChecked} record(s). Failed checks: ${failCount} failing/canceled status result(s) (${failedStatuses.join(", ") || "unknown"}).`;
  }

  if (strategy === "vulnerabilities") {
    const violatingCount = Number(metadata?.violatingCount ?? metadata?.securityIssueCount ?? 0);
    const samples = Array.isArray(metadata?.samples) ? metadata.samples : [];
    return `Checks run: open high-severity vulnerability scan. Failed checks: ${violatingCount} violating alert(s) (${samples.join(", ") || "unknown"}).`;
  }

  if (strategy === "identity") {
    const adminLikeCount = Number(metadata?.adminLikeCount ?? 0);
    const maxAllowedAdminLike = Number(metadata?.maxAllowedAdminLike ?? 0);
    const visibility = String(metadata?.repositoryVisibility ?? "unknown");
    return `Checks run: role distribution and repository visibility. Failed checks: elevated roles=${adminLikeCount} (allowed <= ${maxAllowedAdminLike}), visibility=${visibility}.`;
  }

  return replaceComplianceTerms(verdict?.findings ?? verdict?.failReason ?? "");
}

function isGithubBranchProtectionPlanError(message) {
  const text = String(message ?? "").toLowerCase();
  return text.includes("upgrade to github pro") || text.includes("get-branch-protection");
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
      if (!ALLOWED_CONTROLS.has(String(controlId ?? ""))) {
        res.status(400).json({ error: "Only ISO27001 controls 8.9, 8.28 are supported." });
        return;
      }
      if (!owner || !repo) {
        res.status(400).json({ error: "repoName must be in 'owner/repo' format" });
        return;
      }

      const tenantId = req.tenantId;
      const plan = getControlEntry(controlId);
      if (!plan) {
        res.status(404).json({ error: `Control ${controlId} not found in ISO27001 mapping.` });
        return;
      }

      const toolNames = resolveToolNames(plan.mcp_tool, provider);
      if (toolNames.length === 0) {
        res.status(400).json({ error: `No ${provider} tool mapped for control ${controlId}.` });
        return;
      }

      const token = await this.oauthService.getAccessToken(provider, tenantId);
      const collected = await this.collectEvidence({
        toolNames,
        owner,
        repo,
        controlId,
        provider,
        token,
        preference: normalizePreference(executionPreference)
      });

      const evaluatedAt = new Date().toISOString();
      const evidencePayload = collected.evidencePayload;
      const verdict = evaluationEngine.evaluate(controlId, evidencePayload, {
        controlId,
        controlName: plan.control_name,
        evidenceSource: plan.evidence_source,
        toolName: collected.toolUsed,
        provider,
        logic: getControlLogic(controlId, ALLOWED_STANDARD)
      });
      const status = toPublicStatus(verdict.status);
      const passed = toPassed(status, verdict.passed);
      const reason = buildFailureReason(status, verdict);

      res.json({
        control: controlId,
        evaluated_at: evaluatedAt,
        description: plan.control_name,
        answer: replaceComplianceTerms(verdict.answer),
        passed,
        evidence_source: plan.evidence_source,
        tool_used: collected.toolUsed,
        api_call: collected.apiCall,
        api_call_reason: collected.apiCallReason,
        status,
        fail_reason: reason,
        evidence_snapshot: verdict.evidenceSnapshot,
        findings: replaceComplianceTerms(verdict.findings),
        metadata: verdict.metadata,
        evidence: evidencePayload,
        traceId: collected.traceId,
        report: reportFormatter.formatControlReport({
          repository: repoName,
          control: controlId,
          description: plan.control_name,
          status,
          passed,
          fail_reason: reason,
          evaluated_at: evaluatedAt,
          evidence_source: plan.evidence_source,
          tool_used: collected.toolUsed,
          api_call: collected.apiCall,
          api_call_reason: collected.apiCallReason
        })
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
      if (normalizedStandard !== ALLOWED_STANDARD) {
        res.status(400).json({ error: "Only ISO27001 standard is supported." });
        return;
      }
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
            const toolNames = resolveToolNames(item.mcp_tool, provider);
            if (toolNames.length === 0) {
              throw new Error(`No ${provider} tool mapped for control ${item.control_id}.`);
            }

            const collected = await this.collectEvidence({
              toolNames,
              owner,
              repo,
              controlId: item.control_id,
              provider,
              token,
              preference: normalizePreference(executionPreference)
            });
            const evidencePayload = collected.evidencePayload;
            const verdict = evaluationEngine.evaluate(item.control_id, evidencePayload, {
              controlId: item.control_id,
              controlName: item.control_name,
              evidenceSource: item.evidence_source,
              toolName: collected.toolUsed,
              provider,
              logic: getControlLogic(item.control_id, normalizedStandard)
            });
            const status = toPublicStatus(verdict.status);
            const passed = toPassed(status, verdict.passed);
            const reason = buildFailureReason(status, verdict);

            results.push({
              repository: fullRepoName,
              evaluated_at: new Date().toISOString(),
              control: item.control_id,
              description: item.control_name,
              answer: replaceComplianceTerms(verdict.answer),
              passed,
              evidence_source: item.evidence_source,
              tool_used: collected.toolUsed,
              api_call: collected.apiCall,
              api_call_reason: collected.apiCallReason,
              status,
              fail_reason: reason,
              evidence_snapshot: verdict.evidenceSnapshot,
              findings: replaceComplianceTerms(verdict.findings),
              metadata: verdict.metadata,
              traceId: collected.traceId ?? randomUUID()
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Evaluation failed.";
            results.push({
              repository: fullRepoName,
              evaluated_at: new Date().toISOString(),
              control: item.control_id,
              description: item.control_name,
              answer: "Unable to determine due to evaluation error.",
              passed: null,
              evidence_source: item.evidence_source,
              tool_used: resolveToolNames(item.mcp_tool, provider).join("+"),
              api_call: "UNKNOWN",
              api_call_reason: "Evaluation failed before execution mode could be resolved.",
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
          pass: results.filter((item) => item.status === "PASS").length,
          fail: results.filter((item) => item.status === "FAIL").length,
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

  collectEvidence = async ({ toolNames, owner, repo, controlId, provider, token, preference = "prefer_mcp" }) => {
    const normalizedControlId = String(controlId ?? "");
    const normalizedProvider = String(provider ?? "").toLowerCase();
    if (
      normalizedProvider === "github" &&
      normalizedControlId === "8.28" &&
      Array.isArray(toolNames) &&
      toolNames.includes("list_pull_requests")
    ) {
      return this.collectCodeReviewEvidence({ provider, owner, repo, token, preference });
    }

    if (
      normalizedProvider === "github" &&
      normalizedControlId === "8.9" &&
      Array.isArray(toolNames) &&
      toolNames.includes("get_branch_protection")
    ) {
      // Repo metadata is optional for diagnostics; branch protection evidence is the primary signal.
      let repositoryEvidence = null;
      if (toolNames.includes("get_repository")) {
        try {
          repositoryEvidence = await this.toolExecutionStrategy.executeTool({
            provider,
            toolName: "get_repository",
            params: { owner, repo },
            token,
            preference
          });
        } catch {
          repositoryEvidence = null;
        }
      }

      try {
        const protectionEvidence = await this.toolExecutionStrategy.executeTool({
          provider,
          toolName: "get_branch_protection",
          params: { owner, repo, branch: "main" },
          token,
          preference
        });
        const protectionPayload = extractEvidencePayload(protectionEvidence);
        const normalizedProtectionPayload = {
          ...(protectionPayload && typeof protectionPayload === "object" ? protectionPayload : {}),
          name: String(protectionPayload?.name ?? "main"),
          branch: String(protectionPayload?.branch ?? "main"),
          branch_protection_enabled: true
        };
        return {
          toolUsed: repositoryEvidence ? "get_repository+get_branch_protection" : "get_branch_protection",
          traceId: protectionEvidence?.traceId ?? repositoryEvidence?.traceId ?? randomUUID(),
          evidencePayload: normalizedProtectionPayload,
          ...summarizeExecution([
            repositoryEvidence
              ? {
                toolName: "get_repository",
                executionMode: repositoryEvidence?.executionMode,
                reason: repositoryEvidence?.resolution?.reason
              }
              : null,
            {
              toolName: "get_branch_protection",
              executionMode: protectionEvidence?.executionMode,
              reason: protectionEvidence?.resolution?.reason
            }
          ])
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (!isGithubBranchProtectionPlanError(message)) {
          throw error;
        }

        // GitHub may block branch-protection API on some plans/private repos; fall back to list_branches.
        const branchesEvidence = await this.toolExecutionStrategy.executeTool({
          provider,
          toolName: "list_branches",
          params: { owner, repo },
          token,
          preference
        });

        return {
          toolUsed: repositoryEvidence
            ? "get_repository+list_branches(fallback)"
            : "list_branches(fallback)",
          traceId: branchesEvidence?.traceId ?? repositoryEvidence?.traceId ?? randomUUID(),
          evidencePayload: extractEvidencePayload(branchesEvidence),
          ...summarizeExecution([
            repositoryEvidence
              ? {
                toolName: "get_repository",
                executionMode: repositoryEvidence?.executionMode,
                reason: repositoryEvidence?.resolution?.reason
              }
              : null,
            {
              toolName: "list_branches",
              executionMode: branchesEvidence?.executionMode,
              reason: branchesEvidence?.resolution?.reason
            }
          ])
        };
      }
    }

    const args = { owner, repo };
    const names = Array.isArray(toolNames) ? toolNames : [];
    const results = [];
    for (const name of names) {
      const evidence = await this.toolExecutionStrategy.executeTool({
        provider,
        toolName: name,
        params: args,
        token,
        preference
      });
      results.push({ name, evidence });
    }

    const primary = results[0];
    if (!primary) {
      throw new Error(`No tools executed for control ${normalizedControlId}.`);
    }

    return {
      toolUsed: results.map((item) => item.name).join("+"),
      traceId: primary.evidence?.traceId ?? randomUUID(),
      evidencePayload: extractEvidencePayload(primary.evidence),
      ...summarizeExecution(results.map((item) => ({
        toolName: item?.name,
        executionMode: item?.evidence?.executionMode,
        reason: item?.evidence?.resolution?.reason
      })))
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
    const mergedPrNumbers = mergedEvidence.toolUsed === "search_pull_requests"
      ? mergedPrItems
        .map((pr) => this.extractPullNumber(pr))
        .filter((value) => Number.isFinite(value))
      : mergedPrItems
        .filter((pr) => this.isMergedPullRequest(pr))
        .map((pr) => this.extractPullNumber(pr))
        .filter((value) => Number.isFinite(value));

    const dedupedPullNumbers = [...new Set(mergedPrNumbers)];
    const pullRequests = [];
    const executionEntries = [
      {
        toolName: mergedEvidence?.toolUsed,
        executionMode: mergedEvidence?.executionMode,
        reason: mergedEvidence?.reason
      }
    ];
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
      if (reviewEvidence) {
        executionEntries.push({
          toolName: reviewEvidence.toolUsed,
          executionMode: reviewEvidence.executionMode,
          reason: reviewEvidence.reason
        });
      }

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
      },
      ...summarizeExecution(executionEntries)
    };
  };

  tryToolCandidates = async (provider, candidates, token, preference) => {
    for (const candidate of candidates) {
      try {
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
          payload: extractEvidencePayload(evidence),
          executionMode: evidence?.executionMode,
          reason: evidence?.resolution?.reason
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (!isRetryableToolError(message)) {
          continue;
        }
      }
    }
    return null;
  };

  extractPullRequests = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
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
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.items)) return payload.data.items;
    if (Array.isArray(payload?.data?.reviews)) return payload.data.reviews;
    if (Array.isArray(payload?.reviews)) return payload.reviews;
    if (Array.isArray(payload?.result)) return payload.result;
    if (Array.isArray(payload?.result?.items)) return payload.result.items;
    if (Array.isArray(payload?.result?.reviews)) return payload.result.reviews;
    if (payload && typeof payload === "object") {
      const state = String(payload?.state ?? payload?.status ?? "").trim();
      if (state) return [payload];
    }
    return [];
  };
}

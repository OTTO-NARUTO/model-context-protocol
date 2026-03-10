import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { isProvider } from "../../domain/entities/provider.js";
import EvaluationEngine from "../../application/services/EvaluationEngine.js";
import { ReportFormatter } from "../../application/services/reportFormatter.js";
import { EvidenceReportCollector } from "../../application/services/evidenceReportCollector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

const evaluationEngine = new EvaluationEngine();
const reportFormatter = new ReportFormatter();
const evidenceReportCollector = new EvidenceReportCollector({ projectRoot });
const ALLOWED_STANDARD = "ISO27001";
const checksCatalog = buildChecksCatalog();
const frameworkCatalog = buildFrameworkCatalog();

function getMapping(standard) {
  const normalizedStandard = String(standard ?? "").toUpperCase();
  if (normalizedStandard !== ALLOWED_STANDARD) {
    return [];
  }
  return frameworkCatalog.controls;
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

function uniq(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function buildChecksCatalog() {
  const filePath = path.join(projectRoot, "compliance", "checks", "checks.json");
  if (!existsSync(filePath)) {
    return {};
  }

  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    parsed = null;
  }

  const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
  const out = {};
  for (const check of checks) {
    const checkId = String(check?.check_id ?? "").trim();
    if (!checkId) continue;
    out[checkId] = {
      check_id: checkId,
      description: String(check?.description ?? ""),
      tool: check?.tool,
      provider_tools: check?.provider_tools ?? {},
      evaluation_logic: check?.evaluation_logic && typeof check.evaluation_logic === "object"
        ? check.evaluation_logic
        : null
    };
  }

  return out;
}

function buildFrameworkCatalog() {
  const filePath = path.join(projectRoot, "compliance", "frameworks", "iso27001_controls.json");
  if (!existsSync(filePath)) {
    throw new Error(`Framework controls file not found at: ${filePath}`);
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
    const controlId = String(control?.control_id ?? "").trim();
    if (!controlId) continue;
    out.push({
      control_id: controlId,
      control_name: String(control?.control_name ?? ""),
      evidence_source: String(control?.evidence_source ?? "code_repo_scan"),
      checks: Array.isArray(control?.checks)
        ? control.checks.map((item) => String(item ?? "").trim()).filter(Boolean)
        : []
    });
  }
  return {
    framework: String(parsed?.framework ?? ALLOWED_STANDARD).toUpperCase(),
    controls: out
  };
}

function getCheckDefinitionById(checkId) {
  return checksCatalog[String(checkId ?? "").trim()] ?? null;
}

function resolveCheckTool(checkDefinition, provider) {
  const definition = checkDefinition && typeof checkDefinition === "object"
    ? checkDefinition
    : null;
  const providerName = String(provider ?? "").toLowerCase();

  // Primary source: transport-aware tool mapping from checks.json.
  const toolConfig = definition?.tool;
  if (toolConfig && typeof toolConfig === "object" && !Array.isArray(toolConfig)) {
    const mcpTools = resolveToolNames(toolConfig?.mcp, providerName);
    const restTools = resolveToolNames(toolConfig?.rest, providerName);
    const combined = uniq([...mcpTools, ...restTools]);
    if (combined.length > 0) {
      return combined;
    }
  }

  // Backward compatibility: direct provider mapping in tool field.
  if (definition?.tool) {
    const resolved = resolveToolNames(definition.tool, providerName);
    if (resolved.length > 0) {
      return resolved;
    }
  }

  // Backward compatibility for older check records.
  if (definition?.provider_tools && typeof definition.provider_tools === "object") {
    const byProvider = definition.provider_tools[providerName];
    const resolved = resolveToolNames(byProvider, providerName);
    if (resolved.length > 0) {
      return resolved;
    }
  }

  return [];
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
  const metadata = verdict?.metadata && typeof verdict.metadata === "object"
    ? verdict.metadata
    : {};
  const strategy = String(metadata?.strategy ?? "").toLowerCase();

  if (strategy === "branch_protection") {
    const totalChecked = Number(metadata?.totalChecked ?? 0);
    const protectedCount = Number(metadata?.protectedCount ?? 0);
    const unprotectedCount = Number(
      metadata?.unprotectedCount ??
      Math.max(0, totalChecked - protectedCount)
    );
    const failingBranches = Array.isArray(metadata?.failingItems)
      ? metadata.failingItems
      : Array.isArray(metadata?.unprotectedCriticalBranches)
        ? metadata.unprotectedCriticalBranches
        : [];
    const protectionEnabled = protectedCount > 0 ? "Yes" : "No";
    return `Checks run: branch protection on ${totalChecked} branch(es). Branch protection enabled: ${protectionEnabled}. Protected branches: ${protectedCount}. Unprotected branches: ${unprotectedCount}. Unprotected critical branches: ${failingBranches.length} (${failingBranches.join(", ") || "none"}).`;
  }

  if (String(status) !== "FAIL") {
    return replaceComplianceTerms(verdict?.failReason ?? "");
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

function extractBranchItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.values)) return payload.values;
  return [];
}

function buildControlStatusFromCheckResults(checkResults) {
  const list = Array.isArray(checkResults) ? checkResults : [];
  if (list.some((item) => String(item?.status ?? "").toUpperCase() === "FAIL")) return "FAIL";
  if (list.some((item) => String(item?.status ?? "").toUpperCase() === "ERROR")) return "ERROR";
  if (list.length > 0 && list.every((item) => String(item?.status ?? "").toUpperCase() === "PASS")) return "PASS";
  return "UNDETERMINED";
}

function buildControlReasonFromCheckResults(controlStatus, checkResults) {
  const list = Array.isArray(checkResults) ? checkResults : [];
  const selected = controlStatus === "PASS"
    ? list
    : list.filter((item) => String(item?.status ?? "").toUpperCase() === controlStatus);
  const reasons = selected
    .map((item) => {
      const checkId = String(item?.check_id ?? "check");
      const reason = String(item?.reason ?? "").trim();
      return reason ? `${checkId}: ${reason}` : "";
    })
    .filter(Boolean);
  if (reasons.length > 0) return reasons.join(" | ");
  return controlStatus === "PASS"
    ? "All checks passed for this control."
    : "Control evaluation did not return a clear failure reason.";
}

function buildCombinedApiCall(checkResults) {
  const modes = [...new Set(
    (Array.isArray(checkResults) ? checkResults : [])
      .map((item) => String(item?.api_call ?? "").trim().toUpperCase())
      .filter(Boolean)
  )];
  return modes.length > 0 ? modes.join("+") : "UNKNOWN";
}

function buildCombinedApiCallReason(checkResults) {
  const reasons = (Array.isArray(checkResults) ? checkResults : [])
    .map((item) => {
      const checkId = String(item?.check_id ?? "check");
      const reason = String(item?.api_call_reason ?? "").trim();
      return reason ? `${checkId}: ${reason}` : "";
    })
    .filter(Boolean);
  return reasons.length > 0 ? reasons.join(" | ") : "Execution metadata unavailable.";
}

function buildCombinedToolUsed(checkResults) {
  const tools = (Array.isArray(checkResults) ? checkResults : [])
    .flatMap((item) => String(item?.tool_used ?? "").split("+"))
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return [...new Set(tools)].join("+");
}

export class ComplianceController {
  constructor(oauthService, toolExecutionStrategy) {
    this.oauthService = oauthService;
    this.toolExecutionStrategy = toolExecutionStrategy;
  }

  executeControlChecks = async ({ control, provider, owner, repo, token, preference, standard }) => {
    const checkIds = Array.isArray(control?.checks) ? control.checks : [];
    if (checkIds.length === 0) {
      throw new Error(`Control ${control?.control_id} does not define checks.`);
    }

    const checkResults = [];
    for (const checkId of checkIds) {
      const check = getCheckDefinitionById(checkId);
      if (!check) {
        throw new Error(`Check '${checkId}' is not defined in checks.json.`);
      }

      const toolNames = resolveCheckTool(check, provider);
      if (toolNames.length === 0) {
        throw new Error(`No ${provider} tool mapped for check '${checkId}'.`);
      }

      const collected = await this.collectEvidence({
        toolNames,
        owner,
        repo,
        controlId: control.control_id,
        provider,
        token,
        preference
      });

      const verdict = evaluationEngine.evaluate(control.control_id, collected.evidencePayload, {
        controlId: control.control_id,
        controlName: control.control_name,
        evidenceSource: control.evidence_source,
        toolName: collected.toolUsed,
        provider,
        logic: check.evaluation_logic,
        standard
      });
      const status = toPublicStatus(verdict.status);
      const reason = buildFailureReason(status, verdict);

      checkResults.push({
        check_id: check.check_id,
        check_description: check.description,
        status,
        reason,
        answer: replaceComplianceTerms(verdict.answer),
        findings: replaceComplianceTerms(verdict.findings),
        evidence_snapshot: verdict.evidenceSnapshot,
        metadata: verdict.metadata,
        evidence: collected.evidencePayload,
        tool_used: collected.toolUsed,
        api_call: collected.apiCall,
        api_call_reason: collected.apiCallReason,
        traceId: collected.traceId ?? randomUUID()
      });
    }

    const status = buildControlStatusFromCheckResults(checkResults);
    const reason = buildControlReasonFromCheckResults(status, checkResults);
    const passed = toPassed(status, null);
    const apiCall = buildCombinedApiCall(checkResults);
    const apiCallReason = buildCombinedApiCallReason(checkResults);
    const toolUsed = buildCombinedToolUsed(checkResults);
    const evidenceSnapshot = Object.fromEntries(checkResults.map((item) => [item.check_id, item.evidence_snapshot]));
    const metadata = Object.fromEntries(checkResults.map((item) => [item.check_id, item.metadata]));
    const evidence = Object.fromEntries(checkResults.map((item) => [item.check_id, item.evidence]));
    const findings = checkResults.map((item) => `${item.check_id}: ${item.findings}`).join(" | ");
    const answer = checkResults.map((item) => `${item.check_id}: ${item.answer}`).join(" | ");

    return {
      status,
      passed,
      reason,
      answer,
      findings,
      apiCall,
      apiCallReason,
      toolUsed,
      evidenceSnapshot,
      metadata,
      evidence,
      check_results: checkResults,
      traceId: checkResults[0]?.traceId ?? randomUUID()
    };
  };

  evaluateControl = async (req, res) => {
    res.status(400).json({
      error: "Single-control evaluation is disabled. Use /api/compliance/evaluate-standard with standard='ISO27001'."
    });
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

      const controls = getMapping(normalizedStandard);
      if (controls.length === 0) {
        res.status(404).json({ error: `No repo-related controls found for ${normalizedStandard}` });
        return;
      }

      const tenantId = req.tenantId;
      const token = await this.oauthService.getAccessToken(provider, tenantId);

      const results = [];
      for (const fullRepoName of normalizedRepos) {
        const { owner, repo } = parseRepoCoordinates(fullRepoName);

        for (const item of controls) {
          try {
            const controlExecution = await this.executeControlChecks({
              control: item,
              standard: normalizedStandard,
              provider,
              owner,
              repo,
              token,
              preference: normalizePreference(executionPreference)
            });

            results.push({
              repository: fullRepoName,
              evaluated_at: new Date().toISOString(),
              control: item.control_id,
              description: item.control_name,
              answer: controlExecution.answer,
              passed: controlExecution.passed,
              evidence_source: item.evidence_source,
              tool_used: controlExecution.toolUsed,
              api_call: controlExecution.apiCall,
              api_call_reason: controlExecution.apiCallReason,
              status: controlExecution.status,
              fail_reason: controlExecution.reason,
              evidence_snapshot: controlExecution.evidenceSnapshot,
              findings: controlExecution.findings,
              metadata: controlExecution.metadata,
              check_results: controlExecution.check_results,
              traceId: controlExecution.traceId ?? randomUUID()
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
              tool_used: "",
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

      const summary = {
        repositories: normalizedRepos.length,
        total: results.length,
        pass: results.filter((item) => item.status === "PASS").length,
        fail: results.filter((item) => item.status === "FAIL").length,
        errors: results.filter((item) => item.status === "ERROR").length
      };

      res.json({
        standard: normalizedStandard,
        repository: normalizedRepos.length === 1 ? normalizedRepos[0] : undefined,
        repositories: normalizedRepos,
        timestamp: new Date().toISOString(),
        summary,
        results,
        evidence_report: await evidenceReportCollector.collectStandardEvaluation({
          standard: normalizedStandard,
          provider,
          repositories: normalizedRepos,
          results,
          summary
        }),
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

  debugMcpTools = async (req, res) => {
    const provider = String(req.params.provider ?? "");

    try {
      if (!isProvider(provider)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }

      const tenantId = req.tenantId;
      const token = await this.oauthService.getAccessToken(provider, tenantId);
      const tools = await this.toolExecutionStrategy.listMcpToolNames(provider, token);
      res.json({ provider, mcp_tools: tools });
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP tool discovery failed.";
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

      const executionEntries = [];
      if (repositoryEvidence) {
        executionEntries.push({
          toolName: "get_repository",
          executionMode: repositoryEvidence?.executionMode,
          reason: repositoryEvidence?.resolution?.reason
        });
      }

      // Primary source for branch counts/protected counts.
      let branchesEvidence = null;
      try {
        branchesEvidence = await this.toolExecutionStrategy.executeTool({
          provider,
          toolName: "list_branches",
          params: { owner, repo },
          token,
          preference
        });
      } catch {
        branchesEvidence = null;
      }

      if (branchesEvidence) {
        const branchesPayload = extractEvidencePayload(branchesEvidence);
        const branchItems = extractBranchItems(branchesPayload).map((branch) => ({
          ...(branch && typeof branch === "object" ? branch : {}),
          name: String(branch?.name ?? branch?.displayId ?? branch?.branch ?? "unknown"),
          branch_protection_enabled: Boolean(
            branch?.branch_protection_enabled ??
            branch?.protected ??
            branch?.is_protected ??
            branch?.protection?.enabled
          )
        }));

        executionEntries.push({
          toolName: "list_branches",
          executionMode: branchesEvidence?.executionMode,
          reason: branchesEvidence?.resolution?.reason
        });

        // Some providers return branch names without explicit protection flags.
        const hasAnyProtectionSignal = branchItems.some((branch) => (
          branch?.branch_protection_enabled === true ||
          branch?.protected === true ||
          branch?.is_protected === true
        ));
        if (!hasAnyProtectionSignal && branchItems.length > 0) {
          const defaultBranch = String(
            repositoryEvidence?.raw?.default_branch ??
            repositoryEvidence?.standardized?.default_branch ??
            repositoryEvidence?.result?.default_branch ??
            repositoryEvidence?.default_branch ??
            (branchItems.find((item) => String(item?.name ?? "").toLowerCase() === "main")?.name ??
              branchItems.find((item) => String(item?.name ?? "").toLowerCase() === "master")?.name ??
              branchItems[0]?.name ??
              "main")
          );
          try {
            const protectionEvidence = await this.toolExecutionStrategy.executeTool({
              provider,
              toolName: "get_branch_protection",
              params: { owner, repo, branch: defaultBranch },
              token,
              preference
            });
            executionEntries.push({
              toolName: "get_branch_protection",
              executionMode: protectionEvidence?.executionMode,
              reason: protectionEvidence?.resolution?.reason
            });

            const index = branchItems.findIndex((item) => String(item?.name ?? "").toLowerCase() === defaultBranch.toLowerCase());
            if (index >= 0) {
              branchItems[index] = {
                ...branchItems[index],
                branch_protection_enabled: true
              };
            } else {
              branchItems.push({
                name: defaultBranch,
                branch: defaultBranch,
                branch_protection_enabled: true
              });
            }
          } catch {
            // Keep list_branches evidence as-is when direct protection lookup is unavailable.
          }
        }

        return {
          toolUsed: repositoryEvidence
            ? "get_repository+list_branches"
            : "list_branches",
          traceId: branchesEvidence?.traceId ?? repositoryEvidence?.traceId ?? randomUUID(),
          evidencePayload: branchItems,
          executions: executionEntries.filter(Boolean),
          ...summarizeExecution(executionEntries)
        };
      }

      // Fallback: if list_branches is unavailable, inspect the default/main branch directly.
      const defaultBranch = String(
        repositoryEvidence?.raw?.default_branch ??
        repositoryEvidence?.standardized?.default_branch ??
        repositoryEvidence?.result?.default_branch ??
        repositoryEvidence?.default_branch ??
        "main"
      );
      try {
        const protectionEvidence = await this.toolExecutionStrategy.executeTool({
          provider,
          toolName: "get_branch_protection",
          params: { owner, repo, branch: defaultBranch },
          token,
          preference
        });
        const protectionPayload = extractEvidencePayload(protectionEvidence);
        const normalizedProtectionPayload = [{
          ...(protectionPayload && typeof protectionPayload === "object" ? protectionPayload : {}),
          name: String(protectionPayload?.name ?? defaultBranch),
          branch: String(protectionPayload?.branch ?? defaultBranch),
          branch_protection_enabled: true
        }];

        executionEntries.push({
          toolName: "get_branch_protection",
          executionMode: protectionEvidence?.executionMode,
          reason: protectionEvidence?.resolution?.reason
        });

        return {
          toolUsed: repositoryEvidence
            ? "get_repository+get_branch_protection(fallback)"
            : "get_branch_protection(fallback)",
          traceId: protectionEvidence?.traceId ?? repositoryEvidence?.traceId ?? randomUUID(),
          evidencePayload: normalizedProtectionPayload,
          executions: executionEntries.filter(Boolean),
          ...summarizeExecution(executionEntries)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (!isGithubBranchProtectionPlanError(message)) {
          throw error;
        }

        throw new Error("Unable to evaluate branch protection: neither list_branches nor get_branch_protection returned usable evidence.");
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
      executions: results.map((item) => ({
        toolName: item?.name,
        executionMode: item?.evidence?.executionMode,
        reason: item?.evidence?.resolution?.reason
      })),
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
      executions: executionEntries.filter(Boolean),
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


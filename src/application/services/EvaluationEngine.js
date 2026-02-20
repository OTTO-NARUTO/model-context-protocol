// src/application/services/EvaluationEngine.js
export default class EvaluationEngine {
  evaluate(controlId, evidenceData, context = {}) {
    const resolvedContext = {
      ...context,
      controlId: String(context?.controlId ?? controlId ?? "")
    };

    if (this._hasMcpError(evidenceData)) {
      const message = this._extractMcpErrorMessage(evidenceData);
      return {
        status: "ERROR",
        answer: "Unable to determine due to MCP tool error.",
        findings: `MCP Tool Error: ${message}`,
        metadata: { error: true, controlId: resolvedContext.controlId }
      };
    }

    const strategy = this._resolveStrategy(resolvedContext);
    const payload = this._parseMcpContent(evidenceData);

    switch (strategy) {
      case "identity":
        return this.evaluateRepositoryAccessRights(payload, resolvedContext);
      case "branch_protection":
        return this.evaluateConfigurationManagement(payload, resolvedContext);
      case "review_process":
        return this.evaluateSecureCoding(payload, resolvedContext);
      case "security_testing":
        return this.evaluateSecurityTesting(payload, resolvedContext);
      case "vulnerabilities":
        return this.evaluateVulnerabilities(payload, resolvedContext);
      default:
        return this.defaultEvaluation(resolvedContext);
    }
  }

  // JUDGE: 8.9 Configuration Management
  evaluateConfigurationManagement(data, context = {}) {
    const branches = this._asArray(data);
    if (branches.length === 0) return this.defaultEvaluation(context);

    const protectedBranches = branches.filter((branch) => this._hasProtectionSignals(branch));
    const criticalBranches = protectedBranches.filter((branch) => {
      const name = String(branch?.name ?? branch?.displayId ?? branch?.branch ?? "").toLowerCase();
      return ["main", "master", "prod", "production", "release"].some((marker) => name.includes(marker));
    });
    const pass = protectedBranches.length > 0;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? `Yes. Branch protection signals are present on ${protectedBranches.length} branch item(s).`
        : `No. No branch protection signals were detected in ${branches.length} branch item(s).`,
      findings: pass
        ? `Protected indicators found${criticalBranches.length > 0 ? ` on critical branches (${criticalBranches.length})` : ""}.`
        : "Checked branch metadata and restriction fields; none indicated enforcement.",
      metadata: {
        strategy: "branch_protection",
        controlId: controlIdFrom(context),
        totalChecked: branches.length,
        protectedCount: protectedBranches.length,
        criticalProtectedCount: criticalBranches.length
      }
    };
  }

  // JUDGE: 8.28 Secure Coding
  evaluateSecureCoding(data, context = {}) {
    const prs = this._asArray(data);
    if (prs.length === 0) return this.defaultEvaluation(context);

    const reviewed = prs.filter((pr) => {
      const requestedReviewers = this._asArray(pr?.requested_reviewers ?? pr?.pull_request?.requested_reviewers);
      const reviewers = this._asArray(pr?.reviewers);
      const approvers = this._asArray(pr?.approved_by ?? pr?.approvers);
      const approvals = Number(pr?.approvals ?? pr?.approved ?? 0);
      const reviewComments = Number(pr?.review_comments ?? pr?.review_comments_count ?? 0);

      return (
        requestedReviewers.length > 0 ||
        reviewers.length > 0 ||
        approvers.length > 0 ||
        approvals > 0 ||
        reviewComments > 0 ||
        Boolean(pr?.merged_by)
      );
    });
    const reviewCoverage = reviewed.length / prs.length;
    const pass = reviewCoverage >= 0.9;
    const unreviewedCount = prs.length - reviewed.length;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? `Yes. Review signals are present for ${reviewed.length}/${prs.length} change request(s).`
        : `No. Only ${reviewed.length}/${prs.length} change request(s) show review evidence.`,
      findings: pass
        ? "Reviewer/approval metadata indicates code review workflow is being enforced."
        : `${unreviewedCount} change request(s) lack reviewer or approval evidence.`,
      metadata: {
        strategy: "review_process",
        controlId: controlIdFrom(context),
        totalChecked: prs.length,
        reviewedCount: reviewed.length,
        reviewCoverage
      }
    };
  }

  // JUDGE: 5.18 Repository Access
  evaluateRepositoryAccessRights(data, context = {}) {
    const members = this._asArray(data);
    const q = String(context?.question ?? "").toLowerCase();
    const asksLifecycle = q.includes("provision") || q.includes("deprovision") || q.includes("regularly reviewed");

    if (members.length === 0 && typeof data === "object" && data) {
      const canAdmin = Boolean(data?.permissions?.admin || String(data?.role ?? "").toLowerCase() === "admin");
      return {
        status: "UNDETERMINED",
        answer: "Unable to fully determine repository-wide access governance from a single identity snapshot.",
        findings: canAdmin
          ? "Current identity has admin-level permissions, but collaborator population was not provided."
          : "Current identity is not admin, but repository-wide access data is missing.",
        metadata: {
          strategy: "identity",
          controlId: controlIdFrom(context),
          adminPermission: canAdmin
        }
      };
    }

    const normalizedRoles = members.map((member) => this._classifyRole(member)).filter(Boolean);
    const adminLikeCount = normalizedRoles.filter((role) => ["owner", "admin", "maintainer"].includes(role)).length;
    const unknownCount = members.length - normalizedRoles.length;
    const maxAllowedAdminLike = Math.max(2, Math.ceil(members.length * 0.2));
    const pass = adminLikeCount <= maxAllowedAdminLike && unknownCount === 0;

    if (asksLifecycle) {
      const lifecycleSignals = members.some((member) => (
        member?.created_at ||
        member?.expires_at ||
        member?.state ||
        member?.last_activity_at ||
        member?.last_login
      ));
      if (!lifecycleSignals) {
        return {
          status: "UNDETERMINED",
          answer: "Unable to determine provisioning/deprovisioning effectiveness from current evidence.",
          findings: "Membership snapshot exists, but no lifecycle or review timestamps were found.",
          metadata: {
            strategy: "identity",
            controlId: controlIdFrom(context),
            totalMembers: members.length,
            adminLikeCount
          }
        };
      }
    }

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. Access roles indicate elevated privileges are limited to a small subset of users."
        : "No. Access data suggests elevated privileges are too broad or role metadata is incomplete.",
      findings: `Analyzed ${members.length} member(s): ${adminLikeCount} elevated role(s), ${unknownCount} unknown role(s).`,
      metadata: {
        strategy: "identity",
        controlId: controlIdFrom(context),
        totalMembers: members.length,
        adminLikeCount,
        unknownCount,
        maxAllowedAdminLike
      }
    };
  }

  // JUDGE: 8.8 Vulnerabilities
  evaluateVulnerabilities(data, context = {}) {
    const issues = this._asArray(data);
    if (issues.length === 0) {
      return {
        status: "COMPLIANT",
        answer: "Yes. No open vulnerability items were returned by the evidence source.",
        findings: "The repository scan produced zero vulnerability records.",
        metadata: {
          strategy: "vulnerabilities",
          controlId: controlIdFrom(context),
          totalIssues: 0,
          securityIssueCount: 0
        }
      };
    }

    const securityAlerts = issues.filter(i => {
      const labels = this._asArray(i?.labels);
      const labelHit = labels.some(l => String(l?.name ?? l ?? "").toLowerCase().includes("security"));
      const typeHit = String(i?.type ?? i?.category ?? i?.finding_type ?? "").toLowerCase().includes("vuln");
      const severityHit = ["critical", "high"].includes(String(i?.severity ?? i?.risk ?? "").toLowerCase());
      const state = String(i?.state ?? i?.status ?? "").toLowerCase();
      const isOpen = ["open", "opened", "new", "detected"].includes(state) || state === "";
      return isOpen && (labelHit || typeHit || severityHit);
    });

    const pass = securityAlerts.length === 0;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass 
        ? `Yes. Zero open security issues found in the repository.`
        : `No. ${securityAlerts.length} open security vulnerabilities detected.`,
      findings: `Analyzed ${issues.length} total issues. ${securityAlerts.length} flagged as security risks.`,
      metadata: {
        strategy: "vulnerabilities",
        controlId: controlIdFrom(context),
        totalIssues: issues.length,
        securityIssueCount: securityAlerts.length
      }
    };
  }

  // JUDGE: 8.29 Security Testing
  evaluateSecurityTesting(data, context = {}) {
    const checks = this._asArray(data);
    if (checks.length === 0) return this.defaultEvaluation(context);

    const statuses = checks
      .map((item) => String(item?.status ?? item?.state ?? item?.conclusion ?? "").toLowerCase())
      .filter(Boolean);
    const successCount = statuses.filter((status) => ["completed", "success", "passed", "succeeded", "successful"].includes(status)).length;
    const failCount = statuses.filter((status) => ["failed", "failure", "error", "canceled", "cancelled"].includes(status)).length;
    const hasSignal = statuses.length > 0;

    if (!hasSignal) {
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine security-testing effectiveness from commit-only evidence.",
        findings: "No pipeline/check status fields were present in returned records.",
        metadata: {
          strategy: "security_testing",
          controlId: controlIdFrom(context),
          totalChecked: checks.length
        }
      };
    }

    const pass = successCount > 0;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. Recent records include successful CI/CD or security-check outcomes."
        : "No. No successful CI/CD or security-check outcomes were found.",
      findings: `Observed ${successCount} successful and ${failCount} failed/canceled status result(s).`,
      metadata: {
        strategy: "security_testing",
        controlId: controlIdFrom(context),
        totalChecked: checks.length,
        statusSignals: statuses.length,
        successCount,
        failCount
      }
    };
  }

  defaultEvaluation(context = {}) {
    const control = controlIdFrom(context);
    return {
      status: "UNDETERMINED",
      answer: "Unable to provide an accurate answer with the available evidence shape.",
      findings: "The evaluator could not match this control/tool/question to a supported judgment strategy.",
      metadata: {
        strategy: "default",
        controlId: control
      }
    };
  }

  _resolveStrategy(context = {}) {
    const evidenceSource = String(context?.evidenceSource ?? "").toLowerCase();
    const toolName = String(context?.toolName ?? "").toLowerCase();
    const question = String(context?.question ?? "").toLowerCase();

    if (evidenceSource.includes("identity")) return "identity";
    if (evidenceSource.includes("vapt") || evidenceSource.includes("vuln")) return "vulnerabilities";
    if (evidenceSource.includes("code_repo")) {
      if (this._matches(toolName, ["branch", "protect", "restriction"])) return "branch_protection";
      if (this._matches(toolName, ["pull", "merge_request", "pullrequest"])) return "review_process";
      if (this._matches(toolName, ["pipeline", "job", "commit", "check"])) return "security_testing";
    }

    if (this._matches(question, ["access", "least privilege", "provision", "deprovision"])) return "identity";
    if (this._matches(question, ["vulnerab", "alert"])) return "vulnerabilities";
    if (this._matches(question, ["branch protection", "branch", "configuration"])) return "branch_protection";
    if (this._matches(question, ["pull request", "merge request", "review", "approved"])) return "review_process";
    if (this._matches(question, ["pipeline", "ci/cd", "security check", "commit"])) return "security_testing";

    return "default";
  }

  _matches(text, markers) {
    return markers.some((marker) => text.includes(marker));
  }

  _asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.values)) return value.values;
    if (Array.isArray(value?.content)) return this._asArray(this._parseMcpContent(value.content));
    if (value && typeof value === "object") return [value];
    return [];
  }

  _hasProtectionSignals(branch) {
    if (!branch || typeof branch !== "object") return false;
    const boolFlags = [
      branch?.protected,
      branch?.is_protected,
      branch?.protection?.enabled,
      branch?.required_status_checks?.strict
    ];
    if (boolFlags.some(Boolean)) return true;

    const restrictions = this._asArray(branch?.restrictions ?? branch?.branch_restrictions ?? branch?.rules);
    return restrictions.length > 0;
  }

  _classifyRole(member) {
    if (!member || typeof member !== "object") return "";
    const permission = member?.permissions ?? {};
    if (permission?.admin === true) return "admin";
    if (permission?.maintain === true) return "maintainer";
    if (permission?.push === true || permission?.write === true) return "write";
    if (permission?.pull === true || permission?.read === true) return "read";

    const accessLevel = Number(member?.access_level ?? member?.accessLevel ?? 0);
    if (accessLevel >= 50) return "owner";
    if (accessLevel >= 40) return "maintainer";
    if (accessLevel >= 30) return "write";
    if (accessLevel >= 10) return "read";

    const role = String(member?.role ?? member?.role_name ?? member?.permission ?? member?.access ?? "").toLowerCase();
    if (!role) return "";
    if (role.includes("owner")) return "owner";
    if (role.includes("admin")) return "admin";
    if (role.includes("maintainer")) return "maintainer";
    if (role.includes("write")) return "write";
    if (role.includes("read") || role.includes("guest") || role.includes("reporter")) return "read";
    return "";
  }

  _parseMcpContent(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
      const textBlock = data.find((block) => block?.type === "text" && typeof block?.text === "string");
      if (textBlock) {
        try { return JSON.parse(textBlock.text); } catch { return data; }
      }
      return data;
    }
    if (typeof data === "object") {
      if (Array.isArray(data.content)) return this._parseMcpContent(data.content);
      return data;
    }
    return data;
  }

  _hasMcpError(data) {
    return Boolean(this._extractMcpErrorMessage(data));
  }

  _extractMcpErrorMessage(data) {
    if (!data) return "";
    if (typeof data === "object" && data.error) return String(data.error);
    if (Array.isArray(data)) {
      const block = data.find((b) => {
        const text = String(b?.text ?? "");
        return b?.type === "text" && text.toLowerCase().includes("error");
      });
      return block ? String(block.text ?? "") : "";
    }
    return "";
  }
}

function controlIdFrom(context = {}) {
  return String(context?.controlId ?? "");
}


export default class EvaluationEngine {
  evaluate(controlId, evidenceData, context = {}) {
    const resolvedContext = {
      ...context,
      controlId: String(context?.controlId ?? controlId ?? "")
    };

    if (this._hasMcpError(evidenceData)) {
      const message = this._extractMcpErrorMessage(evidenceData);
      return this._withComplianceFlag({
        status: "ERROR",
        answer: "Unable to determine due to MCP tool error.",
        findings: `MCP Tool Error: ${message}`,
        metadata: { error: true, controlId: resolvedContext.controlId }
      }, null, resolvedContext);
    }

    const payload = this._parseMcpContent(evidenceData);
    const requirementVerdict = this.evaluateByRequirementType(payload, resolvedContext);
    if (requirementVerdict) {
      return this._withComplianceFlag(requirementVerdict, payload, resolvedContext);
    }
    const strategy = this._resolveStrategy(resolvedContext, payload);

    let verdict;
    switch (strategy) {
      case "identity":
        verdict = this.evaluateRepositoryAccessRights(payload, resolvedContext);
        break;
      case "branch_protection":
        verdict = this.evaluateConfigurationManagement(payload, resolvedContext);
        break;
      case "review_process":
        verdict = this.evaluateSecureCoding(payload, resolvedContext);
        break;
      case "security_testing":
        verdict = this.evaluateSecurityTesting(payload, resolvedContext);
        break;
      case "vulnerabilities":
        verdict = this.evaluateVulnerabilities(payload, resolvedContext);
        break;
      default:
        verdict = this.defaultEvaluation(resolvedContext);
        break;
    }
    return this._withComplianceFlag(verdict, payload, resolvedContext);
  }

  evaluateByRequirementType(payload, context = {}) {
    const logic = context?.logic && typeof context.logic === "object" ? context.logic : null;
    const requirementType = String(logic?.requirementType ?? logic?.requirement_type ?? "").toLowerCase();
    if (!requirementType) {
      return null;
    }

    switch (requirementType) {
      case "max_count":
        return this.evaluateRequirementMaxCount(payload, context, logic);
      case "none_allowed":
        return this.evaluateRequirementNoneAllowed(payload, context, logic);
      case "all_must_be_true":
        return this.evaluateRequirementAllMustBeTrue(payload, context, logic);
      case "min_reviews":
        return this.evaluateRequirementMinReviews(payload, context, logic);
      case "no_failures":
        return this.evaluateRequirementNoFailures(payload, context, logic);
      default:
        return null;
    }
  }

  evaluateRequirementMaxCount(payload, context = {}, logic = {}) {
    const threshold = Number(logic?.threshold ?? 0);
    const field = String(logic?.field ?? "count");

    if (field === "admin_users") {
      const identity = this._extractIdentityEvidence(payload);
      const roles = identity.members.map((member) => this._classifyRole(member)).filter(Boolean);
      const adminUsers = roles.filter((role) => ["owner", "admin", "maintainer"].includes(role)).length;
      const pass = adminUsers <= threshold;

      return {
        status: pass ? "COMPLIANT" : "NON_COMPLIANT",
        answer: pass
          ? `Yes. Administrative users are within threshold (${adminUsers} <= ${threshold}).`
          : `No. Administrative users exceed threshold (${adminUsers} > ${threshold}).`,
        findings: pass
          ? `Admin-like users (${adminUsers}) are within allowed maximum ${threshold}.`
          : `Admin-like users (${adminUsers}) exceed allowed maximum ${threshold}.`,
        metadata: {
          strategy: "identity",
          requirementType: "max_count",
          requirementField: field,
          threshold,
          observedCount: adminUsers,
          totalMembers: identity.members.length
        }
      };
    }

    const items = this._asArray(payload);
    const observedCount = items.length;
    const pass = observedCount <= threshold;
    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? `Yes. Count is within threshold (${observedCount} <= ${threshold}).`
        : `No. Count exceeds threshold (${observedCount} > ${threshold}).`,
      findings: `Observed ${observedCount} for field '${field}' against max threshold ${threshold}.`,
      metadata: {
        strategy: "default",
        requirementType: "max_count",
        requirementField: field,
        threshold,
        observedCount
      }
    };
  }

  evaluateRequirementNoneAllowed(payload, _context = {}, logic = {}) {
    const field = String(logic?.field ?? "");
    const issues = this._asArray(payload);

    let violatingItems = [];
    if (field === "open_high_severity_alerts") {
      violatingItems = issues.filter((item) => {
        const severity = String(item?.severity ?? item?.risk ?? item?.severity_level ?? "").toLowerCase();
        const state = String(item?.state ?? item?.status ?? "").toLowerCase();
        const isOpen = ["open", "opened", "new", "detected"].includes(state) || state === "";
        return isOpen && ["high", "critical"].includes(severity);
      });
    } else {
      violatingItems = issues;
    }

    const violatingCount = violatingItems.length;
    const pass = violatingCount === 0;
    const samples = violatingItems
      .map((item) => String(item?.number ?? item?.id ?? item?.title ?? "unknown"))
      .slice(0, 10);

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. No violating items were detected."
        : `No. ${violatingCount} violating item(s) were detected.`,
      findings: pass
        ? `Requirement '${field}' passed with zero violations.`
        : `Requirement '${field}' failed with ${violatingCount} violation(s) (examples: ${samples.join(", ") || "unknown"}).`,
      metadata: {
        strategy: "vulnerabilities",
        requirementType: "none_allowed",
        requirementField: field,
        violatingCount,
        samples
      }
    };
  }

  evaluateRequirementAllMustBeTrue(payload, context = {}, logic = {}) {
    const field = String(logic?.field ?? "");
    const branches = this._asArray(payload);
    if (branches.length === 0) {
      return this.defaultEvaluation(context);
    }

    let scope = branches;
    if (field === "branch_protection_enabled") {
      const primary = branches.filter((branch) => {
        const name = String(branch?.name ?? branch?.displayId ?? branch?.branch ?? "").toLowerCase();
        return ["main", "master", "prod", "production", "release", "develop"].some((marker) => name.includes(marker));
      });
      scope = primary.length > 0 ? primary : branches;
    }

    const failing = scope
      .filter((item) => !this._hasProtectionSignals(item))
      .map((item) => String(item?.name ?? item?.displayId ?? item?.branch ?? "unknown"))
      .slice(0, 10);
    const pass = failing.length === 0;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. All required items meet the expected condition."
        : `No. ${failing.length} item(s) do not meet the expected condition.`,
      findings: pass
        ? `Requirement '${field}' satisfied for all ${scope.length} checked item(s).`
        : `Requirement '${field}' failed for: ${failing.join(", ") || "unknown"}.`,
      metadata: {
        strategy: "branch_protection",
        requirementType: "all_must_be_true",
        requirementField: field,
        totalChecked: scope.length,
        failingItems: failing
      }
    };
  }

  evaluateRequirementMinReviews(payload, context = {}, logic = {}) {
    const field = String(logic?.field ?? "");
    const threshold = Number(logic?.threshold ?? 1);
    const normalized = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;

    const hasCompositeShape = Array.isArray(normalized?.pull_requests);
    const prs = hasCompositeShape
      ? normalized.pull_requests
      : this._asArray(payload);

    if (hasCompositeShape && Number(normalized?.merged_pr_count ?? 0) === 0) {
      const policy = String(normalized?.zero_merged_policy ?? "UNDETERMINED").toUpperCase();
      const passedWhenZero = policy === "COMPLIANT";
      return {
        status: passedWhenZero ? "COMPLIANT" : "UNDETERMINED",
        answer: passedWhenZero
          ? "Yes. No merged pull requests were found, so review requirement is considered satisfied by policy."
          : "Unable to determine because no merged pull requests were found.",
        findings: `Zero merged pull requests detected. Applied zero_merged_policy=${policy}.`,
        metadata: {
          strategy: "review_process",
          requirementType: "min_reviews",
          requirementField: field,
          threshold,
          totalChecked: 0,
          failingItems: [],
          zeroMergedPolicy: policy
        }
      };
    }

    if (prs.length === 0) {
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine because pull request review evidence was not returned.",
        findings: "No pull request objects were found in the evidence payload for min_reviews evaluation.",
        metadata: {
          strategy: "review_process",
          requirementType: "min_reviews",
          requirementField: field,
          threshold,
          totalChecked: 0,
          failingItems: [],
          noEvidence: true
        }
      };
    }

    const mergedPrs = hasCompositeShape ? prs : prs.filter((pr) => {
      const state = String(pr?.state ?? "").toLowerCase();
      return Boolean(pr?.merged_at) || state === "merged" || Boolean(pr?.merged_by);
    });
    const scope = mergedPrs.length > 0 ? mergedPrs : prs;
    const failing = scope
      .filter((pr) => this._extractApprovalCount(pr) < threshold)
      .map((pr) => String(pr?.number ?? pr?.iid ?? pr?.id ?? "unknown"))
      .slice(0, 10);
    const pass = failing.length === 0;

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. Review threshold is met for all checked changes."
        : `No. ${failing.length} change(s) are below the required review threshold.`,
      findings: pass
        ? `Requirement '${field}' satisfied with minimum ${threshold} review(s).`
        : `Requirement '${field}' failed for PR/MR: ${failing.join(", ") || "unknown"} (min required: ${threshold}).`,
      metadata: {
        strategy: "review_process",
        requirementType: "min_reviews",
        requirementField: field,
        threshold,
        totalChecked: scope.length,
        failingItems: failing
      }
    };
  }

  evaluateRequirementNoFailures(payload, context = {}, logic = {}) {
    const field = String(logic?.field ?? "");
    const checks = this._asArray(payload);
    if (checks.length === 0) {
      return this.defaultEvaluation(context);
    }

    const failing = checks.filter((item) => {
      const status = String(item?.status ?? item?.state ?? item?.conclusion ?? "").toLowerCase();
      return ["failed", "failure", "error", "canceled", "cancelled"].includes(status);
    });
    const failingCount = failing.length;
    const pass = failingCount === 0;
    const samples = failing
      .map((item) => String(item?.name ?? item?.id ?? item?.key ?? "unknown"))
      .slice(0, 10);

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. No failed security checks were detected."
        : `No. ${failingCount} failed security check(s) were detected.`,
      findings: pass
        ? `Requirement '${field}' satisfied with no failed checks.`
        : `Requirement '${field}' failed with ${failingCount} failed check(s) (examples: ${samples.join(", ") || "unknown"}).`,
      metadata: {
        strategy: "security_testing",
        requirementType: "no_failures",
        requirementField: field,
        failCount: failingCount,
        failedStatuses: samples,
        totalChecked: checks.length
      }
    };
  }

  // JUDGE: 8.9 Configuration Management
  evaluateConfigurationManagement(data, context = {}) {
    const branches = this._asArray(data);
    if (branches.length === 0) return this.defaultEvaluation(context);

    const protectedBranches = branches.filter((branch) => this._hasProtectionSignals(branch));
    const unprotectedCriticalBranches = branches
      .filter((branch) => {
        const name = String(branch?.name ?? branch?.displayId ?? branch?.branch ?? "").toLowerCase();
        const isCritical = ["main", "master", "prod", "production", "release", "develop"].some((marker) => name.includes(marker));
        return isCritical && !this._hasProtectionSignals(branch);
      })
      .map((branch) => String(branch?.name ?? branch?.displayId ?? branch?.branch ?? "unknown"))
      .slice(0, 10);
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
        : `Branch protection is missing on critical branches: ${unprotectedCriticalBranches.join(", ") || "unknown"}.`,
      metadata: {
        strategy: "branch_protection",
        controlId: controlIdFrom(context),
        totalChecked: branches.length,
        protectedCount: protectedBranches.length,
        criticalProtectedCount: criticalBranches.length,
        unprotectedCriticalBranches
      }
    };
  }

  // Strategy: Review Process
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
    const unreviewedSamples = prs
      .filter((pr) => !reviewed.includes(pr))
      .map((pr) => String(pr?.number ?? pr?.iid ?? pr?.id ?? "unknown"))
      .slice(0, 10);

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? `Yes. Review signals are present for ${reviewed.length}/${prs.length} change request(s).`
        : `No. Only ${reviewed.length}/${prs.length} change request(s) show review evidence.`,
      findings: pass
        ? "Reviewer/approval metadata indicates code review workflow is being enforced."
        : `${unreviewedCount} change request(s) lack reviewer/approval evidence (examples: ${unreviewedSamples.join(", ") || "unknown"}).`,
      metadata: {
        strategy: "review_process",
        controlId: controlIdFrom(context),
        totalChecked: prs.length,
        reviewedCount: reviewed.length,
        reviewCoverage,
        unreviewedSamples
      }
    };
  }

  // Strategy: Identity and Access
  evaluateRepositoryAccessRights(data, context = {}) {
    const { members, repository, visibility, diagnostics } = this._extractIdentityEvidence(data);
    const provider = String(context?.provider ?? "").toLowerCase();

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

    if (provider === "github" && !visibility.known) {
      const missingTools = this._asArray(diagnostics?.missingRequiredTools).map((item) => String(item));
      const missingSummary = missingTools.length > 0
        ? ` Missing required GitHub tools: ${missingTools.join(", ")}.`
        : "";
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine repository-level access-rights compliance without repository visibility metadata.",
        findings: `get_repository evidence was missing or did not include visibility/private fields.${missingSummary}`,
        metadata: {
          strategy: "identity",
          controlId: controlIdFrom(context),
          totalMembers: members.length,
          visibilityKnown: false,
          diagnostics: diagnostics ?? null
        }
      };
    }

    const normalizedRoles = members.map((member) => this._classifyRole(member)).filter(Boolean);
    const knownCount = normalizedRoles.length;
    const unknownCount = members.length - knownCount;
    const adminLikeCount = normalizedRoles.filter((role) => ["owner", "admin", "maintainer"].includes(role)).length;
    const unknownRatio = members.length > 0 ? unknownCount / members.length : 0;

    if (knownCount === 0 || unknownRatio > 0.3) {
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine access-rights compliance due to incomplete role metadata.",
        findings: `Insufficient role classification data: ${unknownCount}/${members.length} member(s) have unknown role mappings.`,
        metadata: {
          strategy: "identity",
          controlId: controlIdFrom(context),
          totalMembers: members.length,
          knownCount,
          unknownCount,
          unknownRatio
        }
      };
    }

    const maxAllowedAdminLike = Math.max(1, Math.ceil(knownCount * 0.2));
    const rolePass = adminLikeCount <= maxAllowedAdminLike;
    const visibilityPass = visibility.known ? !visibility.isPublic : true;
    const pass = rolePass && visibilityPass;
    const lifecycleSignals = members.some((member) => (
      member?.created_at ||
      member?.expires_at ||
      member?.state ||
      member?.last_activity_at ||
      member?.last_login
    ));

    const failureReasons = [];
    if (!rolePass) {
      failureReasons.push(`elevated roles are high (${adminLikeCount}/${knownCount}, allowed ${maxAllowedAdminLike})`);
    }
    if (!visibilityPass) {
      failureReasons.push(`repository visibility is ${visibility.label}`);
    }

    return {
      status: pass ? "COMPLIANT" : "NON_COMPLIANT",
      answer: pass
        ? "Yes. Access roles and repository visibility indicate least-privilege expectations are met."
        : "No. Access evidence indicates either broad elevated privileges or disallowed repository exposure.",
      findings: pass
        ? `Analyzed ${members.length} member(s): ${adminLikeCount} elevated role(s), ${unknownCount} unknown role(s). Repository visibility: ${visibility.label}.`
        : `Failed because ${failureReasons.join(" and ")}.`,
      metadata: {
        strategy: "identity",
        controlId: controlIdFrom(context),
        totalMembers: members.length,
        knownCount,
        adminLikeCount,
        unknownCount,
        unknownRatio,
        maxAllowedAdminLike,
        lifecycleSignals,
        visibilityKnown: visibility.known,
        repositoryVisibility: visibility.label,
        repositoryIsPublic: visibility.isPublic
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
    const alertSamples = securityAlerts
      .map((item) => String(item?.number ?? item?.id ?? item?.title ?? "unknown"))
      .slice(0, 10);

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
        securityIssueCount: securityAlerts.length,
        alertSamples
      }
    };
  }

  
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
    const failedStatuses = statuses.filter((status) => ["failed", "failure", "error", "canceled", "cancelled"].includes(status));

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
        failCount,
        failedStatuses: failedStatuses.slice(0, 10)
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

  _resolveStrategy(context = {}, payload = null) {
    const scores = this._strategyScores(context, payload);
    let winner = "default";
    let maxScore = 0;

    for (const [strategy, score] of Object.entries(scores)) {
      if (score > maxScore) {
        winner = strategy;
        maxScore = score;
      }
    }

    return maxScore > 0 ? winner : "default";
  }

  _strategyScores(context = {}, payload = null) {
    const evidenceSource = String(context?.evidenceSource ?? "").toLowerCase();
    const toolName = String(context?.toolName ?? "").toLowerCase();
    const question = String(context?.question ?? "").toLowerCase();
    const profile = this._inferEvidenceProfile(payload);

    const scores = {
      identity: profile.identitySignals * 3,
      branch_protection: profile.branchSignals * 3,
      review_process: profile.pullRequestSignals * 3,
      security_testing: profile.pipelineSignals * 3,
      vulnerabilities: profile.vulnerabilitySignals * 3
    };

    if (evidenceSource.includes("identity")) scores.identity += 3;
    if (evidenceSource.includes("vapt") || evidenceSource.includes("vuln")) scores.vulnerabilities += 3;
    if (evidenceSource.includes("code_repo")) {
      scores.branch_protection += this._matches(toolName, ["branch", "protect", "restriction"]) ? 2 : 0;
      scores.review_process += this._matches(toolName, ["pull", "merge_request", "pullrequest"]) ? 2 : 0;
      scores.security_testing += this._matches(toolName, ["pipeline", "job", "commit", "check"]) ? 2 : 0;
    }

    // Question hints are weak tie-breakers only.
    scores.identity += this._matches(question, ["access", "least privilege", "provision", "deprovision"]) ? 1 : 0;
    scores.vulnerabilities += this._matches(question, ["vulnerab", "alert"]) ? 1 : 0;
    scores.branch_protection += this._matches(question, ["branch protection", "branch", "configuration"]) ? 1 : 0;
    scores.review_process += this._matches(question, ["pull request", "merge request", "review", "approved"]) ? 1 : 0;
    scores.security_testing += this._matches(question, ["pipeline", "ci/cd", "security check", "commit"]) ? 1 : 0;

    return scores;
  }

  _matches(text, markers) {
    return markers.some((marker) => text.includes(marker));
  }

  _extractApprovalCount(pr) {
    const approvals = Number(pr?.approvals ?? pr?.approved ?? 0);
    if (approvals > 0) return approvals;
    const approvedBy = this._asArray(pr?.approved_by ?? pr?.approvers);
    if (approvedBy.length > 0) return approvedBy.length;
    const reviews = this._asArray(pr?.reviews);
    const approvedReviews = reviews.filter((review) => {
      const state = String(review?.state ?? review?.status ?? "").toLowerCase();
      return state === "approved" || state === "approval";
    });
    if (approvedReviews.length > 0) return approvedReviews.length;
    return Boolean(pr?.merged_by) ? 1 : 0;
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
      branch?.branch_protection_enabled,
      branch?.protection?.enabled,
      branch?.required_status_checks?.strict
    ];
    if (boolFlags.some(Boolean)) return true;

    // GitHub get_branch_protection endpoint returns protection config without "protected=true".
    if (
      branch?.required_pull_request_reviews ||
      branch?.enforce_admins ||
      branch?.required_status_checks ||
      branch?.required_linear_history ||
      branch?.required_signatures ||
      branch?.allow_force_pushes === false ||
      branch?.allow_deletions === false
    ) {
      return true;
    }

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
    if (typeof data === "string") {
      const trimmed = data.trim();
      if (!trimmed) return [];
      try {
        return JSON.parse(trimmed);
      } catch {
        return data;
      }
    }
    if (Array.isArray(data)) {
      const textBlock = data.find((block) => block?.type === "text" && typeof block?.text === "string");
      if (textBlock) {
        return this._parseMcpContent(textBlock.text);
      }
      return data;
    }
    if (typeof data === "object") {
      // Normalize common MCP wrappers before evaluating.
      if (Object.prototype.hasOwnProperty.call(data, "standardized")) {
        return this._parseMcpContent(data.standardized);
      }
      if (Object.prototype.hasOwnProperty.call(data, "raw")) {
        return this._parseMcpContent(data.raw);
      }
      if (Object.prototype.hasOwnProperty.call(data, "result")) {
        return this._parseMcpContent(data.result);
      }
      if (Array.isArray(data.content)) return this._parseMcpContent(data.content);
      return data;
    }
    return data;
  }

  _extractIdentityEvidence(data) {
    const parsed = this._parseMcpContent(data);
    let members = [];
    let repository = null;
    let diagnostics = null;

    if (Array.isArray(parsed)) {
      members = parsed;
    } else if (parsed && typeof parsed === "object") {
      if ("membership" in parsed) {
        const membershipPayload = this._parseMcpContent(parsed.membership);
        members = this._extractMemberArray(membershipPayload);
      } else {
        members = this._extractMemberArray(parsed);
      }

      if ("repository" in parsed) {
        const repositoryPayload = this._parseMcpContent(parsed.repository);
        repository = Array.isArray(repositoryPayload) ? repositoryPayload[0] ?? null : repositoryPayload;
      } else if (this._looksLikeRepository(parsed)) {
        repository = parsed;
      }

      if ("diagnostics" in parsed && parsed.diagnostics && typeof parsed.diagnostics === "object") {
        diagnostics = parsed.diagnostics;
      }
    }

    return {
      members,
      repository,
      visibility: this._inferRepositoryVisibility(repository),
      diagnostics
    };
  }

  _extractMemberArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.members)) return payload.members;
    if (Array.isArray(payload.collaborators)) return payload.collaborators;
    if (Array.isArray(payload.users)) return payload.users;
    if (Array.isArray(payload.team_members)) return payload.team_members;
    return this._asArray(payload);
  }

  _looksLikeRepository(value) {
    if (!value || typeof value !== "object") return false;
    const keys = Object.keys(value).map((key) => String(key).toLowerCase());
    return ["visibility", "private", "default_branch", "full_name", "html_url"].some((marker) => keys.includes(marker));
  }

  _inferRepositoryVisibility(repository) {
    if (!repository || typeof repository !== "object") {
      return { known: false, isPublic: null, label: "unknown" };
    }

    const visibilityText = String(repository?.visibility ?? "").toLowerCase();
    if (visibilityText) {
      if (visibilityText === "public") {
        return { known: true, isPublic: true, label: "public" };
      }
      if (["private", "internal"].includes(visibilityText)) {
        return { known: true, isPublic: false, label: visibilityText };
      }
    }

    if (typeof repository?.private === "boolean") {
      return {
        known: true,
        isPublic: !repository.private,
        label: repository.private ? "private" : "public"
      };
    }

    return { known: false, isPublic: null, label: "unknown" };
  }

  _inferEvidenceProfile(data) {
    const items = this._asArray(data);
    let identitySignals = 0;
    let branchSignals = 0;
    let pullRequestSignals = 0;
    let pipelineSignals = 0;
    let vulnerabilitySignals = 0;

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      const keys = Object.keys(item).map((k) => String(k).toLowerCase());
      const keyText = keys.join(" ");

      const hasIdentity = this._matches(keyText, [
        "permissions", "access_level", "role", "members", "collaborator", "user", "username", "login"
      ]);
      const hasBranch = this._matches(keyText, [
        "branch", "protected", "protection", "restrictions", "default_branch", "required_status_checks"
      ]);
      const hasPullRequest = this._matches(keyText, [
        "pull_request", "pullrequest", "merge_request", "requested_reviewers", "approvals", "merged_by", "review"
      ]);
      const hasPipeline = this._matches(keyText, [
        "pipeline", "job", "run", "check", "conclusion", "workflow", "commit_status", "ci"
      ]);
      const hasVulnerability = this._matches(keyText, [
        "vulnerability", "alert", "severity", "cve", "dependabot", "finding", "security_advisory"
      ]);

      if (hasIdentity) identitySignals += 1;
      if (hasBranch) branchSignals += 1;
      if (hasPullRequest) pullRequestSignals += 1;
      if (hasPipeline) pipelineSignals += 1;
      if (hasVulnerability) vulnerabilitySignals += 1;

      const labels = this._asArray(item?.labels).map((l) => String(l?.name ?? l ?? "").toLowerCase());
      if (labels.some((name) => name.includes("security"))) {
        vulnerabilitySignals += 1;
      }
    }

    return {
      identitySignals,
      branchSignals,
      pullRequestSignals,
      pipelineSignals,
      vulnerabilitySignals
    };
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

  _withComplianceFlag(verdict, payload = null, context = {}) {
    const status = String(verdict?.status ?? "").toUpperCase();
    const passed = status === "COMPLIANT"
      ? true
      : status === "NON_COMPLIANT"
        ? false
        : null;
    const baseAnswer = String(verdict?.answer ?? "").trim();
    const baseFindings = String(verdict?.findings ?? "").trim();
    const dynamicNarrative = this._buildDynamicNarrative(status, verdict?.metadata ?? {}, context);
    const answer = dynamicNarrative.answer || baseAnswer;
    const findings = dynamicNarrative.findings || baseFindings;
    const failReason = passed === true
      ? ""
      : (findings || "Evaluation could not confirm a pass result from the available evidence.");
    const evidenceSnapshot = this._sanitizeSnapshot(this._buildEvidenceSnapshot(payload, verdict?.metadata ?? {}));
    return {
      ...verdict,
      answer,
      findings,
      passed,
      compliant: passed,
      failReason,
      evidenceSnapshot
    };
  }

  _buildDynamicNarrative(status, metadata = {}, context = {}) {
    const controlId = String(context?.controlId ?? "").trim();
    const controlName = String(context?.controlName ?? "").trim();
    const provider = String(context?.provider ?? "").trim();
    const evidenceSource = String(context?.evidenceSource ?? "").trim();
    const descriptor = controlId
      ? `Control ${controlId}${controlName ? ` (${controlName})` : ""}`
      : "Selected control";
    const providerText = provider ? ` for ${provider}` : "";
    const metricSummary = this._summarizeMetrics(metadata);
    const question = String(context?.question ?? "").trim();
    const questionText = question ? ` Question checked: ${question}.` : "";
    const evidenceText = evidenceSource ? ` Evidence source: ${evidenceSource}.` : "";

    if (status === "COMPLIANT") {
      return {
        answer: `${descriptor}${providerText} passed.${metricSummary ? ` ${metricSummary}.` : ""}${questionText}`,
        findings: `${descriptor} passed with status PASS.${metricSummary ? ` ${metricSummary}.` : ""}${evidenceText}`
      };
    }

    if (status === "NON_COMPLIANT") {
      return {
        answer: `${descriptor}${providerText} failed.${metricSummary ? ` ${metricSummary}.` : ""}${questionText}`,
        findings: `${descriptor} failed with status FAIL.${metricSummary ? ` ${metricSummary}.` : ""}${evidenceText}`
      };
    }

    if (status === "ERROR") {
      return {
        answer: `${descriptor}${providerText} could not be evaluated due to an execution error.${questionText}`,
        findings: `${descriptor} evaluation returned ERROR.${metricSummary ? ` ${metricSummary}.` : ""}${evidenceText}`
      };
    }

    return {
      answer: `${descriptor}${providerText} is undetermined with the current evidence.${metricSummary ? ` ${metricSummary}.` : ""}${questionText}`,
      findings: `${descriptor} returned UNDETERMINED because evidence was incomplete or ambiguous.${metricSummary ? ` ${metricSummary}.` : ""}${evidenceText}`
    };
  }

  _summarizeMetrics(metadata = {}) {
    const strategy = String(metadata?.strategy ?? "").toLowerCase();

    if (strategy === "identity") {
      const totalMembers = Number(metadata?.totalMembers ?? 0);
      const adminLikeCount = Number(metadata?.adminLikeCount ?? 0);
      const maxAllowedAdminLike = Number(metadata?.maxAllowedAdminLike ?? 0);
      const unknownCount = Number(metadata?.unknownCount ?? 0);
      const repositoryVisibility = String(metadata?.repositoryVisibility ?? "unknown");
      return `members=${totalMembers}, elevated_roles=${adminLikeCount}, allowed_elevated=${maxAllowedAdminLike}, unknown_roles=${unknownCount}, visibility=${repositoryVisibility}`;
    }

    if (strategy === "branch_protection") {
      const totalChecked = Number(metadata?.totalChecked ?? 0);
      const protectedCount = Number(metadata?.protectedCount ?? 0);
      const criticalMissing = Array.isArray(metadata?.unprotectedCriticalBranches)
        ? metadata.unprotectedCriticalBranches.length
        : 0;
      return `checked_branches=${totalChecked}, protected_branches=${protectedCount}, unprotected_critical=${criticalMissing}`;
    }

    if (strategy === "review_process") {
      const totalChecked = Number(metadata?.totalChecked ?? 0);
      const reviewedCount = Number(metadata?.reviewedCount ?? 0);
      const threshold = Number(metadata?.threshold ?? 0);
      const coverageRaw = Number(metadata?.reviewCoverage ?? 0);
      const reviewCoverage = Number.isFinite(coverageRaw) ? Math.round(coverageRaw * 100) : 0;
      return `checked_changes=${totalChecked}, reviewed_changes=${reviewedCount}, review_coverage=${reviewCoverage}%, min_reviews=${threshold}`;
    }

    if (strategy === "security_testing") {
      const totalChecked = Number(metadata?.totalChecked ?? 0);
      const successCount = Number(metadata?.successCount ?? 0);
      const failCount = Number(metadata?.failCount ?? 0);
      return `checked_records=${totalChecked}, successful_checks=${successCount}, failed_checks=${failCount}`;
    }

    if (strategy === "vulnerabilities") {
      const totalIssues = Number(metadata?.totalIssues ?? metadata?.totalChecked ?? 0);
      const securityIssueCount = Number(metadata?.securityIssueCount ?? metadata?.violatingCount ?? 0);
      return `total_issues=${totalIssues}, violating_security_issues=${securityIssueCount}`;
    }

    if (
      Object.prototype.hasOwnProperty.call(metadata, "observedCount") ||
      Object.prototype.hasOwnProperty.call(metadata, "threshold")
    ) {
      const observedCount = Number(metadata?.observedCount ?? 0);
      const threshold = Number(metadata?.threshold ?? 0);
      return `observed=${observedCount}, threshold=${threshold}`;
    }

    return "";
  }

  _buildEvidenceSnapshot(payload, metadata = {}) {
    const strategy = String(metadata?.strategy ?? "").toLowerCase();
    const items = this._asArray(payload);

    if (strategy === "identity") {
      return {
        total_members: Number(metadata?.totalMembers ?? items.length ?? 0),
        elevated_roles: Number(metadata?.adminLikeCount ?? 0),
        unknown_roles: Number(metadata?.unknownCount ?? 0),
        repository_visibility: String(metadata?.repositoryVisibility ?? "unknown")
      };
    }

    if (strategy === "branch_protection") {
      return {
        total_branches: Number(metadata?.totalChecked ?? items.length ?? 0),
        protected_branches: Number(metadata?.protectedCount ?? 0),
        unprotected_critical_branches: Array.isArray(metadata?.unprotectedCriticalBranches)
          ? metadata.unprotectedCriticalBranches
          : []
      };
    }

    if (strategy === "review_process") {
      return {
        total_changes: Number(metadata?.totalChecked ?? items.length ?? 0),
        reviewed_changes: Number(metadata?.reviewedCount ?? 0),
        review_coverage: Number(metadata?.reviewCoverage ?? 0),
        unreviewed_samples: Array.isArray(metadata?.unreviewedSamples) ? metadata.unreviewedSamples : []
      };
    }

    if (strategy === "security_testing") {
      return {
        total_records: Number(metadata?.totalChecked ?? items.length ?? 0),
        success_count: Number(metadata?.successCount ?? 0),
        fail_count: Number(metadata?.failCount ?? 0),
        failed_statuses: Array.isArray(metadata?.failedStatuses) ? metadata.failedStatuses : []
      };
    }

    if (strategy === "vulnerabilities") {
      return {
        total_issues: Number(metadata?.totalIssues ?? items.length ?? 0),
        security_issue_count: Number(metadata?.securityIssueCount ?? 0),
        alert_samples: Array.isArray(metadata?.alertSamples) ? metadata.alertSamples : []
      };
    }

    return {
      records: items.length
    };
  }

  _sanitizeSnapshot(value, depth = 0) {
    const MAX_DEPTH = 3;
    const MAX_ARRAY = 10;
    const MAX_STRING = 160;

    if (value === null || value === undefined) return value;
    if (depth > MAX_DEPTH) return "[truncated]";

    if (typeof value === "string") {
      const compact = value.replace(/\s+/g, " ").trim();
      return compact.length > MAX_STRING ? `${compact.slice(0, MAX_STRING)}...` : compact;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY)
        .map((item) => this._sanitizeSnapshot(item, depth + 1));
    }

    if (typeof value === "object") {
      const out = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        out[key] = this._sanitizeSnapshot(entry, depth + 1);
      }
      return out;
    }

    return String(value);
  }
}

function controlIdFrom(context = {}) {
  return String(context?.controlId ?? "");
}

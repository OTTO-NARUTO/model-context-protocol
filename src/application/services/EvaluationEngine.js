// src/application/services/EvaluationEngine.js
export default class EvaluationEngine {
  constructor() {
    this.rules = {
      "8.28": this.evaluateSecureCoding.bind(this),
      "8.29": this.evaluateSecurityTesting.bind(this),
      "8.9": this.evaluateConfigurationManagement.bind(this),
      "8.8": this.evaluateVulnerabilities.bind(this),
      "8.2": this.evaluateAccessRights.bind(this),
      "5.18": this.evaluateRepositoryAccessRights.bind(this),
      "CC6.1": this.evaluateLogicalAccess.bind(this),
      DEFAULT: this.defaultEvaluation.bind(this)
    };
  }

  evaluate(controlId, evidenceData) {
    if (this._hasMcpError(evidenceData)) {
      const message = this._extractMcpErrorMessage(evidenceData);
      return {
        status: "ERROR",
        answer: "Unable to determine due to MCP tool error.",
        findings: `MCP Tool Error: ${message}`,
        metadata: { error: true }
      };
    }

    const rule = this.rules[controlId] || this.rules.DEFAULT;
    return rule(evidenceData);
  }

  evaluateSecureCoding(data) {
    const prs = this._parseMcpContent(data);
    if (!Array.isArray(prs)) {
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine due to invalid data format.",
        findings: "Invalid data format",
        metadata: {}
      };
    }

    const failingPrs = prs.filter((pr) => {
      const requested = pr?.pull_request?.requested_reviewers;
      return !Array.isArray(requested) || requested.length === 0;
    });

    return {
      status: failingPrs.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
      answer:
        failingPrs.length === 0
          ? "Yes, pull requests have reviewers assigned."
          : "No, some pull requests are missing reviewers.",
      findings:
        failingPrs.length > 0
          ? `Found ${failingPrs.length} PRs without reviewers.`
          : "All PRs have reviewers assigned.",
      metadata: { totalChecked: prs.length, failedCount: failingPrs.length }
    };
  }

  evaluateAccessRights(data) {
    const users = this._parseMcpContent(data);
    if (!Array.isArray(users)) {
      return {
        status: "UNDETERMINED",
        answer: "Unable to determine due to invalid data format.",
        findings: "Invalid data format",
        metadata: {}
      };
    }

    const admins = users.filter((u) => u?.permissions?.admin === true || u?.access_level >= 50);
    const limit = 3;

    return {
      status: admins.length <= limit ? "COMPLIANT" : "NON_COMPLIANT",
      answer:
        admins.length <= limit
          ? "Yes, administrative access is within the defined limit."
          : "No, administrative access exceeds the defined limit.",
      findings: `Detected ${admins.length} admins (Limit: ${limit}).`,
      metadata: { totalChecked: users.length, adminCount: admins.length, limit }
    };
  }

  evaluateLogicalAccess(data) {
    return this.evaluateAccessRights(data);
  }

  evaluateRepositoryAccessRights(data) {
    const payload = this._parseMcpContent(data);
    const canAdmin = Boolean(payload?.permissions?.admin);

    return {
      status: canAdmin ? "COMPLIANT" : "NON_COMPLIANT",
      answer: canAdmin
        ? "Yes, required repository admin access is verified."
        : "No, required repository admin access is not verified.",
      findings: canAdmin
        ? "Admin access is restricted and verified."
        : "Elevated permissions not found for current context.",
      metadata: { adminPermission: canAdmin }
    };
  }

  evaluateConfigurationManagement(data) {
    const payload = this._parseMcpContent(data);
    const branches = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.values)
        ? payload.values
        : Array.isArray(payload?.branches)
          ? payload.branches
          : [];

    const protectedBranches = branches.filter((branch) => {
      if (branch?.protected === true) {
        return true;
      }
      if (branch?.protection === true) {
        return true;
      }
      return false;
    });

    return {
      status: protectedBranches.length > 0 ? "COMPLIANT" : "NON_COMPLIANT",
      answer:
        protectedBranches.length > 0
          ? "Yes, branch protection rules are active."
          : "No, critical branches are not protected.",
      findings: `Found ${protectedBranches.length} protected branches.`,
      metadata: { totalChecked: branches.length, protectedCount: protectedBranches.length }
    };
  }

  evaluateSecurityTesting(data) {
    const payload = this._parseMcpContent(data);
    const checks = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.workflow_runs)
        ? payload.workflow_runs
        : Array.isArray(payload?.pipelines)
          ? payload.pipelines
          : Array.isArray(payload?.values)
            ? payload.values
            : [];

    const hasChecks = checks.some((item) => {
      if (item?.status === "completed") {
        return true;
      }
      if (Array.isArray(item?.check_suites) && item.check_suites.length > 0) {
        return true;
      }
      if (typeof item?.pipeline_id !== "undefined") {
        return true;
      }
      return false;
    });

    return {
      status: hasChecks ? "COMPLIANT" : "NON_COMPLIANT",
      answer: hasChecks
        ? "Yes, recent commits show CI/CD or security check activity."
        : "No, recent commits do not show CI/CD or security check activity.",
      findings: hasChecks
        ? "Recent commits show CI/CD check activity."
        : "No active security checks found on recent commits.",
      metadata: { totalChecked: checks.length, hasChecks }
    };
  }

  evaluateVulnerabilities(data) {
    const payload = this._parseMcpContent(data);
    const issues = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

    const securityIssues = issues.filter((issue) => {
      const isOpen = !issue?.state || String(issue.state).toLowerCase() === "open";
      if (!isOpen) {
        return false;
      }

      const labels = Array.isArray(issue?.labels) ? issue.labels : [];
      return labels.some((label) => {
        const labelName =
          typeof label === "string"
            ? label
            : typeof label?.name === "string"
              ? label.name
              : "";
        return labelName.toLowerCase().includes("security");
      });
    });

    return {
      status: securityIssues.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
      answer:
        securityIssues.length === 0
          ? "Yes, there are no open security issues."
          : "No, open security issues were found.",
      findings: `Found ${securityIssues.length} open security issues.`,
      metadata: { totalIssues: issues.length, securityIssueCount: securityIssues.length }
    };
  }

  defaultEvaluation() {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
      answer: "Manual review is required for this control.",
      findings: "Automated rule not yet defined for this control. Raw data available.",
      metadata: {}
    };
  }

  _parseMcpContent(data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      const textBlock = data.find((block) => block?.type === "text" && typeof block?.text === "string");
      if (textBlock) {
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return data;
        }
      }
      return data;
    }

    if (typeof data === "object") {
      if (Array.isArray(data.content)) {
        return this._parseMcpContent(data.content);
      }
      if (Array.isArray(data.items)) {
        return data.items;
      }
      return data;
    }

    return data;
  }

  _hasMcpError(data) {
    if (!data) {
      return false;
    }

    if (typeof data === "object" && data.isError === true) {
      return true;
    }

    const message = this._extractMcpErrorMessage(data);
    return Boolean(message);
  }

  _extractMcpErrorMessage(data) {
    if (!data) {
      return "";
    }

    if (typeof data === "string") {
      return data.toLowerCase().includes("error") ? data : "";
    }

    if (Array.isArray(data)) {
      const textBlock = data.find((block) => block?.type === "text" && typeof block?.text === "string");
      if (!textBlock) {
        return "";
      }
      return textBlock.text.toLowerCase().includes("error") ? textBlock.text : "";
    }

    if (typeof data === "object") {
      if (typeof data.error === "string" && data.error) {
        return data.error;
      }
      if (Array.isArray(data.content)) {
        return this._extractMcpErrorMessage(data.content);
      }
    }

    return "";
  }
}

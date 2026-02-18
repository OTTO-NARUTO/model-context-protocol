// src/application/services/EvaluationEngine.js
export default class EvaluationEngine {
  constructor() {
    this.rules = {
      "8.28": this.evaluateSecureCoding.bind(this),
      "8.2": this.evaluateAccessRights.bind(this),
      "5.18": this.evaluateAccessRights.bind(this),
      "CC6.1": this.evaluateLogicalAccess.bind(this),
      DEFAULT: this.defaultEvaluation.bind(this)
    };
  }

  evaluate(controlId, evidenceData) {
    const rule = this.rules[controlId] || this.rules.DEFAULT;
    return rule(evidenceData);
  }

  evaluateSecureCoding(data) {
    const prs = this._parseMcpContent(data);
    if (!Array.isArray(prs)) {
      return { status: "UNDETERMINED", findings: "Invalid data format", metadata: {} };
    }

    const failingPrs = prs.filter((pr) => {
      const requested = pr?.pull_request?.requested_reviewers;
      return !Array.isArray(requested) || requested.length === 0;
    });

    return {
      status: failingPrs.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
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
      return { status: "UNDETERMINED", findings: "Invalid data format", metadata: {} };
    }

    const admins = users.filter((u) => u?.permissions?.admin === true || u?.access_level >= 50);
    const limit = 3;

    return {
      status: admins.length <= limit ? "COMPLIANT" : "NON_COMPLIANT",
      findings: `Detected ${admins.length} admins (Limit: ${limit}).`,
      metadata: { totalChecked: users.length, adminCount: admins.length, limit }
    };
  }

  evaluateLogicalAccess(data) {
    return this.evaluateAccessRights(data);
  }

  defaultEvaluation() {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
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
}

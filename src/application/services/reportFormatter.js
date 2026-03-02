const DEFAULT_REASON = "\u2014";

function normalizeStatus(status) {
  const normalized = String(status ?? "UNDETERMINED").toUpperCase();
  if (normalized === "COMPLIANT") return "PASS";
  if (normalized === "NON_COMPLIANT") return "FAIL";
  return normalized;
}

export class ReportFormatter {
  formatControlResult(result) {
    const status = normalizeStatus(result?.status);
    const passed = result?.passed === true
      ? true
      : result?.passed === false
        ? false
        : status === "PASS"
          ? true
          : status === "FAIL"
            ? false
            : null;

    return {
      repository: String(result?.repository ?? ""),
      control_id: String(result?.control ?? result?.control_id ?? ""),
      control_name: String(result?.description ?? result?.control_name ?? ""),
      status,
      passed,
      reason: String(result?.fail_reason ?? "").trim() || DEFAULT_REASON,
      api_call: String(result?.api_call ?? "UNKNOWN"),
      api_call_reason: String(result?.api_call_reason ?? ""),
      evaluated_at: String(result?.evaluated_at ?? ""),
      evidence_source: String(result?.evidence_source ?? ""),
      tool_used: String(result?.tool_used ?? "")
    };
  }

  formatControlReport(result) {
    const row = this.formatControlResult(result);
    return {
      headers: this.tableHeaders(),
      rows: [row],
      summary: this.summarize([row])
    };
  }

  formatStandardReport(results) {
    const rows = (Array.isArray(results) ? results : []).map((item) => this.formatControlResult(item));
    return {
      headers: this.tableHeaders(),
      rows,
      summary: this.summarize(rows)
    };
  }

  tableHeaders() {
    return [
      "Repository",
      "Control ID",
      "Control Name",
      "Status",
      "API Call",
      "Reason",
      "Evaluated At"
    ];
  }

  summarize(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return {
      total: list.length,
      pass: list.filter((item) => item.status === "PASS").length,
      fail: list.filter((item) => item.status === "FAIL").length,
      undetermined: list.filter((item) => item.status === "UNDETERMINED").length,
      errors: list.filter((item) => item.status === "ERROR").length
    };
  }
}

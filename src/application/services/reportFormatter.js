const DEFAULT_REASON = "\u2014";

export class ReportFormatter {
  formatControlResult(result) {
    return {
      repository: String(result?.repository ?? ""),
      control_id: String(result?.control ?? result?.control_id ?? ""),
      control_name: String(result?.description ?? result?.control_name ?? ""),
      question: String(result?.question ?? ""),
      status: String(result?.status ?? "UNDETERMINED").toUpperCase(),
      compliant: result?.compliant === true ? true : result?.compliant === false ? false : null,
      reason: String(result?.fail_reason ?? "").trim() || DEFAULT_REASON,
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
      "Reason",
      "Evaluated At"
    ];
  }

  summarize(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return {
      total: list.length,
      compliant: list.filter((item) => item.status === "COMPLIANT").length,
      non_compliant: list.filter((item) => item.status === "NON_COMPLIANT").length,
      undetermined: list.filter((item) => item.status === "UNDETERMINED").length,
      errors: list.filter((item) => item.status === "ERROR").length
    };
  }
}


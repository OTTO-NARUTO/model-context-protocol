import path from "path";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";

function toSafeFilePart(value) {
  return String(value ?? "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

export class EvidenceReportCollector {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.baseDir = path.join(this.projectRoot, "evidence-collector", "reports");
  }

  async collectStandardEvaluation(payload = {}) {
    const timestamp = new Date().toISOString();
    const standard = String(payload?.standard ?? "UNKNOWN");
    const provider = String(payload?.provider ?? "unknown");
    const repositories = Array.isArray(payload?.repositories) ? payload.repositories : [];
    const results = Array.isArray(payload?.results) ? payload.results : [];

    const failedControls = results
      .filter((item) => ["FAIL", "ERROR"].includes(String(item?.status ?? "").toUpperCase()))
      .map((item) => ({
        repository: String(item?.repository ?? ""),
        control: String(item?.control ?? ""),
        control_name: String(item?.description ?? ""),
        status: String(item?.status ?? ""),
        why_failed: String(item?.fail_reason ?? item?.findings ?? item?.answer ?? "No failure reason provided."),
        api_call: String(item?.api_call ?? "UNKNOWN"),
        api_call_reason: String(item?.api_call_reason ?? ""),
        evidence_snapshot: item?.evidence_snapshot ?? null,
        metadata: item?.metadata ?? null,
        trace_id: String(item?.traceId ?? "")
      }));

    const report = {
      report_type: "EVIDENCE_FAILURE_REPORT",
      generated_at: timestamp,
      standard,
      provider,
      repositories,
      summary: payload?.summary ?? {},
      total_results: results.length,
      failed_or_error_count: failedControls.length,
      failed_controls: failedControls,
      all_results: results.map((item) => ({
        repository: String(item?.repository ?? ""),
        control: String(item?.control ?? ""),
        control_name: String(item?.description ?? ""),
        status: String(item?.status ?? ""),
        reason: String(item?.fail_reason ?? item?.findings ?? item?.answer ?? ""),
        evidence_snapshot: item?.evidence_snapshot ?? null
      }))
    };

    return this.writeReport({
      report,
      prefix: "standard",
      provider,
      scope: standard
    });
  }

  async collectControlEvaluation(payload = {}) {
    const timestamp = new Date().toISOString();
    const report = {
      report_type: "EVIDENCE_CONTROL_REPORT",
      generated_at: timestamp,
      standard: String(payload?.standard ?? "ISO27001"),
      provider: String(payload?.provider ?? "unknown"),
      repository: String(payload?.repository ?? ""),
      control: String(payload?.control ?? ""),
      control_name: String(payload?.control_name ?? ""),
      status: String(payload?.status ?? ""),
      why_failed: String(payload?.fail_reason ?? payload?.findings ?? payload?.answer ?? "No failure reason provided."),
      api_call: String(payload?.api_call ?? "UNKNOWN"),
      api_call_reason: String(payload?.api_call_reason ?? ""),
      evidence_snapshot: payload?.evidence_snapshot ?? null,
      metadata: payload?.metadata ?? null,
      trace_id: String(payload?.trace_id ?? "")
    };

    return this.writeReport({
      report,
      prefix: "control",
      provider: payload?.provider,
      scope: payload?.control
    });
  }

  async writeReport({ report, prefix, provider, scope }) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const fileName = [
      toSafeFilePart(prefix),
      toSafeFilePart(provider),
      toSafeFilePart(scope),
      Date.now(),
      randomUUID().slice(0, 8)
    ].join("_") + ".json";
    const absolutePath = path.join(this.baseDir, fileName);
    await fs.writeFile(absolutePath, JSON.stringify(report, null, 2), "utf-8");

    return {
      file_name: fileName,
      file_path: absolutePath,
      download_url: `/downloads/evidence-reports/${encodeURIComponent(fileName)}`
    };
  }
}

/**
 * EvidenceMappingTool
 * Responsibility: Maps compliance controls to specific MCP tool calls.
 */
export default class EvidenceMappingTool {
  constructor(isoRepoData, soc2RepoData) {
    this.controls = [
      ...((isoRepoData?.controls ?? []).map((c) => ({ ...c, standard: "ISO27001" }))),
      ...((soc2RepoData?.controls ?? []).map((c) => ({ ...c, standard: "SOC2" })))
    ];
  }

  getMapping(controlCode, provider) {
    const normalizedProvider = String(provider ?? "").toLowerCase();
    const control = this.controls.find((c) => c.control_code === controlCode);

    if (!control) {
      throw new Error(`Control ${controlCode} not found in repository mappings.`);
    }

    const mapping = (control.mappings ?? []).find((m) => m?.tools?.[normalizedProvider]);
    if (!mapping) {
      throw new Error(`No ${provider} tool mapped for control ${controlCode}`);
    }

    return {
      controlName: control.control_name,
      evidenceSource: mapping.evidence_source,
      mcpMethod: mapping.tools[normalizedProvider],
      params: {
        evidence_type: mapping.evidence_source
      }
    };
  }
}

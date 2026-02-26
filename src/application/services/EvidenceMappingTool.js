export default class EvidenceMappingTool {
  constructor(isoRepoData, soc2RepoData) {
    this.controls = [
      ...this.normalizeControls(isoRepoData, "ISO27001"),
      ...this.normalizeControls(soc2RepoData, "SOC2")
    ];
  }

  getMapping(controlCode, provider) {
    const normalizedProvider = String(provider ?? "").toLowerCase();
    const control = this.controls.find((c) => c.controlId === controlCode);

    if (!control) {
      throw new Error(`Control ${controlCode} not found in repository mappings.`);
    }

    const toolName = this.resolveToolName(control.mcpTool, normalizedProvider);
    if (!toolName) {
      throw new Error(`No ${provider} tool mapped for control ${controlCode}`);
    }

    return {
      controlName: control.controlName,
      question: control.question,
      evidenceSource: control.evidenceSource,
      mcpMethod: toolName,
      params: {
        evidence_type: control.evidenceSource
      }
    };
  }

  getMappingsByStandard(standard, provider) {
    const normalizedProvider = String(provider ?? "").toLowerCase();
    const normalizedStandard = String(standard ?? "").toUpperCase();

    return this.controls
      .filter((control) => String(control?.standard ?? "").toUpperCase() === normalizedStandard)
      .map((control) => {
        const toolName = this.resolveToolName(control.mcpTool, normalizedProvider);
        if (!toolName) {
          return null;
        }

        return {
          controlId: control.controlId,
          controlName: control.controlName,
          question: control.question,
          evidenceSource: control.evidenceSource,
          mcpMethod: toolName,
          params: {
            evidence_type: control.evidenceSource
          }
        };
      })
      .filter(Boolean);
  }

  /**
   * Returns control codes for a given compliance standard.
   * Example inputs: ISO27001, SOC2 (case-insensitive)
   */
  getControlCodesByStandard(standard) {
    const normalizedStandard = String(standard ?? "").toUpperCase();

    return this.controls
      .filter((control) => String(control?.standard ?? "").toUpperCase() === normalizedStandard)
      .map((control) => control.controlId);
  }

  normalizeControls(rawData, standard) {
    const list = Array.isArray(rawData) ? rawData : Array.isArray(rawData?.controls) ? rawData.controls : [];

    return list.map((item) => {
      const controlId = String(item.control_id ?? item.control_code ?? "");
      const controlName = String(item.control_name ?? "");
      const question = String(item.question ?? "");

      let evidenceSource = "";
      let mcpTool = "";
      if (item.evidence_source || item.mcp_tool) {
        evidenceSource = String(item.evidence_source ?? "");
        mcpTool = item.mcp_tool ?? "";
      } else {
        const firstMapping = Array.isArray(item.mappings) ? item.mappings[0] : null;
        evidenceSource = String(firstMapping?.evidence_source ?? "");
        mcpTool = firstMapping?.tools ?? "";
      }

      return {
        standard,
        controlId,
        controlName,
        question,
        evidenceSource,
        mcpTool
      };
    });
  }

  resolveToolName(mcpTool, provider) {
    if (typeof mcpTool === "string") {
      return mcpTool;
    }
    if (mcpTool && typeof mcpTool === "object") {
      const value = mcpTool[provider];
      return typeof value === "string" ? value : "";
    }
    return "";
  }
}

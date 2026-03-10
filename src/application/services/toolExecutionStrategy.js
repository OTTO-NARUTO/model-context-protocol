import { ResponseNormalizer } from "./responseNormalizer.js";

export class ToolExecutionStrategy {
  constructor(mcpClient, restClient, toolResolver) {
    this.mcpClient = mcpClient;
    this.restClient = restClient;
    this.toolResolver = toolResolver;
    this.responseNormalizer = new ResponseNormalizer();
  }

  async executeTool({ provider, toolName, params = {}, token, preference = "prefer_mcp" }) {
    const mcpExposedTools = await this.listMcpToolNames(provider, token);
    const decision = this.toolResolver.resolve({
      provider,
      toolName,
      mcpExposedTools,
      preference
    });

    if (decision.mode === "mcp") {
      const evidence = await this.mcpClient.callTool(provider, decision.mcpToolName, params, token);
      return {
        ...this.normalizeEvidence(evidence),
        executionMode: "mcp",
        resolution: decision,
        requestedToolName: toolName,
        executedToolName: decision.mcpToolName
      };
    }

    if (decision.mode === "rest") {
      const evidence = await this.restClient.callTool(provider, decision.restToolName, params, token);
      return {
        ...this.normalizeEvidence(evidence),
        executionMode: "rest",
        resolution: decision,
        requestedToolName: toolName,
        executedToolName: decision.restToolName
      };
    }

    throw new Error(`Tool resolution failed for '${provider}/${toolName}': ${decision.reason}`);
  }

  async listTools(provider, token) {
    const [mcpToolNames, providerTools, restContractTools] = await Promise.all([
      this.listMcpToolNames(provider, token),
      Promise.resolve(this.toolResolver.listProviderTools(provider)),
      Promise.resolve(this.restClient.listTools(provider).map((item) => String(item?.name ?? "")))
    ]);

    const mcpSet = new Set(mcpToolNames);
    const restContractSet = new Set(restContractTools);
    const all = providerTools.all;

    return all.map((toolName) => {
      const mapping = providerTools.mappingByTool?.[toolName] ?? { mcpToolName: "", restToolName: "" };
      const decision = this.toolResolver.resolve({
        provider,
        toolName,
        mcpExposedTools: mcpToolNames,
        preference: "prefer_mcp"
      });

      return {
        name: toolName,
        mcp_tool_name: mapping.mcpToolName,
        rest_tool_name: mapping.restToolName,
        mcp_exposed: Boolean(mapping.mcpToolName) && mcpSet.has(mapping.mcpToolName),
        mcp_mapped: Boolean(mapping.mcpToolName),
        rest_supported: Boolean(mapping.restToolName) || restContractSet.has(mapping.restToolName),
        selected_mode: decision.mode,
        reason: decision.reason
      };
    });
  }

  async listMcpToolNames(provider, token) {
    try {
      const tools = await this.mcpClient.listTools(provider, token);
      return tools.map((item) => String(item?.name ?? "")).filter(Boolean);
    } catch {
      return [];
    }
  }

  normalizeEvidence(evidence) {
    const payload = this.responseNormalizer.normalize(evidence?.standardized ?? evidence?.raw ?? evidence);
    return {
      ...evidence,
      raw: payload,
      standardized: payload
    };
  }
}

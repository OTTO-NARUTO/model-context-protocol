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
      const evidence = await this.mcpClient.callTool(provider, toolName, params, token);
      return {
        ...this.normalizeEvidence(evidence),
        executionMode: "mcp",
        resolution: decision
      };
    }

    if (decision.mode === "rest") {
      const evidence = await this.restClient.callTool(provider, toolName, params, token);
      return {
        ...this.normalizeEvidence(evidence),
        executionMode: "rest",
        resolution: decision
      };
    }

    throw new Error(`Tool resolution failed for '${provider}/${toolName}': ${decision.reason}`);
  }

  async listTools(provider, token) {
    const [mcpToolNames, registryTools, restTools] = await Promise.all([
      this.listMcpToolNames(provider, token),
      Promise.resolve(this.toolResolver.listProviderTools(provider)),
      Promise.resolve(this.restClient.listTools(provider).map((item) => String(item?.name ?? "")))
    ]);

    const mcpSet = new Set(mcpToolNames);
    const registryMcpSet = new Set(registryTools.mcp);
    const restSet = new Set([...registryTools.rest, ...restTools]);
    const all = [...new Set([...registryTools.all, ...mcpToolNames, ...restTools])];

    return all.map((toolName) => {
      const decision = this.toolResolver.resolve({
        provider,
        toolName,
        mcpExposedTools: mcpToolNames,
        preference: "prefer_mcp"
      });
      return {
        name: toolName,
        mcp_exposed: mcpSet.has(toolName),
        mcp_supported_in_registry: registryMcpSet.has(toolName),
        rest_supported: restSet.has(toolName),
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

import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { env } from "../../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

export class ToolResolver {
  constructor() {
    this.registry = this.loadRegistry();
  }

  resolve({ provider, toolName, mcpExposedTools = [], preference = "prefer_mcp" }) {
    const providerName = String(provider ?? "").toLowerCase();
    const tool = String(toolName ?? "");
    const support = this.getSupport(providerName);
    const mcpSet = new Set(support.mcp);
    const restSet = new Set(support.rest);
    const exposedSet = new Set(mcpExposedTools.map((item) => String(item)));

    const supportsMcp = mcpSet.has(tool) || exposedSet.has(tool);
    const supportsRest = restSet.has(tool);
    const exposedByMcp = exposedSet.has(tool);

    const mode = this.pickMode({
      preference,
      supportsMcp,
      supportsRest,
      exposedByMcp
    });

    return {
      mode,
      supportsMcp,
      supportsRest,
      exposedByMcp,
      fallbackAllowed: supportsRest,
      reason: this.explain(mode, { supportsMcp, supportsRest, exposedByMcp, preference })
    };
  }

  listProviderTools(provider) {
    const support = this.getSupport(provider);
    const allTools = [...new Set([...support.mcp, ...support.rest])];
    return {
      mcp: [...support.mcp],
      rest: [...support.rest],
      all: allTools
    };
  }

  getSupport(provider) {
    const providers = this.registry?.providers ?? {};
    const config = providers[String(provider ?? "").toLowerCase()] ?? {};
    const mcp = Array.isArray(config?.mcp) ? config.mcp.map((item) => String(item)) : [];
    const rest = Array.isArray(config?.rest) ? config.rest.map((item) => String(item)) : [];

    return { mcp, rest };
  }

  pickMode({ preference, supportsMcp, supportsRest, exposedByMcp }) {
    const normalizedPreference = String(preference ?? "prefer_mcp").toLowerCase();
    const canUseMcp = supportsMcp && exposedByMcp;
    const canUseRest = supportsRest;

    if (normalizedPreference === "mcp_only") return canUseMcp ? "mcp" : "none";
    if (normalizedPreference === "rest_only") return canUseRest ? "rest" : "none";

    if (normalizedPreference === "prefer_rest") {
      if (canUseRest) return "rest";
      if (canUseMcp) return "mcp";
      return "none";
    }

    if (canUseMcp) return "mcp";
    if (canUseRest) return "rest";
    return "none";
  }

  explain(mode, { supportsMcp, supportsRest, exposedByMcp, preference }) {
    if (mode === "mcp") {
      return "Tool is exposed by MCP and selected by execution preference.";
    }
    if (mode === "rest") {
      if (supportsMcp && !exposedByMcp) {
        return "MCP registry supports the tool but it is not exposed; REST fallback selected.";
      }
      return "REST selected by registry support and execution preference.";
    }
    return `No executable strategy found (supportsMcp=${supportsMcp}, exposedByMcp=${exposedByMcp}, supportsRest=${supportsRest}, preference=${preference}).`;
  }

  loadRegistry() {
    const registryPath = path.resolve(projectRoot, env.PROVIDER_TOOL_SUPPORT_PATH);
    const payload = readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : {};
  }
}


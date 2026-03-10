import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

function asStringOrEmpty(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asToolList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asStringOrEmpty(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    const normalized = asStringOrEmpty(value);
    return normalized ? [normalized] : [];
  }
  return [];
}

export class ToolResolver {
  constructor() {
    this.toolMappings = this.loadToolMappings();
  }

  resolve({ provider, toolName, mcpExposedTools = [], preference = "prefer_mcp" }) {
    const providerName = String(provider ?? "").toLowerCase();
    const canonicalToolName = String(toolName ?? "").trim();
    const mapping = this.getProviderToolMapping(providerName, canonicalToolName);
    const mcpToolName = mapping.mcpToolName;
    const restToolName = mapping.restToolName;

    const exposedSet = new Set(mcpExposedTools.map((item) => String(item)));
    const supportsMcp = Boolean(mcpToolName);
    const supportsRest = Boolean(restToolName);
    const exposedByMcp = Boolean(mcpToolName) && exposedSet.has(mcpToolName);

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
      requestedToolName: canonicalToolName,
      mcpToolName,
      restToolName,
      reason: this.explain(mode, {
        preference,
        supportsMcp,
        supportsRest,
        exposedByMcp,
        canonicalToolName,
        mcpToolName,
        restToolName
      })
    };
  }

  listProviderTools(provider) {
    const providerName = String(provider ?? "").toLowerCase();
    const mappingConfig = this.getProviderToolsConfig(providerName);
    const mappingByTool = {};

    for (const [toolName, rawMapping] of Object.entries(mappingConfig)) {
      mappingByTool[toolName] = this.normalizeMapping(rawMapping);
    }

    const all = Object.keys(mappingByTool);
    const mcp = all.filter((toolName) => Boolean(mappingByTool[toolName]?.mcpToolName));
    const rest = all.filter((toolName) => Boolean(mappingByTool[toolName]?.restToolName));

    return {
      mcp,
      rest,
      all,
      mappingByTool
    };
  }

  getProviderToolMapping(provider, toolName) {
    const providerName = String(provider ?? "").toLowerCase();
    const canonicalToolName = String(toolName ?? "").trim();
    const mappingConfig = this.getProviderToolsConfig(providerName);
    const mapped = this.normalizeMapping(mappingConfig[canonicalToolName]);

    return mapped;
  }

  getProviderToolsConfig(provider) {
    const providers = this.toolMappings?.providers ?? {};
    const providerConfig = providers[String(provider ?? "").toLowerCase()] ?? {};
    const tools = providerConfig?.tools;
    return tools && typeof tools === "object" ? tools : {};
  }

  normalizeMapping(value) {
    if (!value || typeof value !== "object") {
      return { mcpToolName: "", restToolName: "" };
    }

    return {
      mcpToolName: asStringOrEmpty(value.mcp),
      restToolName: asStringOrEmpty(value.rest)
    };
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

  explain(mode, {
    preference,
    supportsMcp,
    supportsRest,
    exposedByMcp,
    canonicalToolName,
    mcpToolName,
    restToolName
  }) {
    if (mode === "mcp") {
      return `MCP selected for '${canonicalToolName}' using mapped tool '${mcpToolName}'.`;
    }
    if (mode === "rest") {
      if (supportsMcp && !exposedByMcp) {
        return `MCP mapping exists ('${mcpToolName}') but tool is not exposed; REST fallback '${restToolName}' selected.`;
      }
      return `REST selected for '${canonicalToolName}' using mapped tool '${restToolName}'.`;
    }
    return `No executable strategy found for '${canonicalToolName}' (mcp='${mcpToolName || "n/a"}', rest='${restToolName || "n/a"}', supportsMcp=${supportsMcp}, exposedByMcp=${exposedByMcp}, supportsRest=${supportsRest}, preference=${preference}).`;
  }

  loadToolMappings() {
    const checksPath = path.resolve(projectRoot, "compliance", "checks", "checks.json");
    const payload = readFileSync(checksPath, "utf-8");
    const parsed = JSON.parse(payload);
    const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
    const providers = {
      github: { tools: {} },
      gitlab: { tools: {} },
      bitbucket: { tools: {} }
    };

    for (const check of checks) {
      const toolConfig = check?.tool;
      if (!toolConfig || typeof toolConfig !== "object" || Array.isArray(toolConfig)) {
        continue;
      }

      for (const providerName of Object.keys(providers)) {
        const mcpNames = asToolList(toolConfig?.mcp?.[providerName]);
        const restNames = asToolList(toolConfig?.rest?.[providerName]);

        for (const toolName of mcpNames) {
          if (!providers[providerName].tools[toolName]) {
            providers[providerName].tools[toolName] = { mcp: "", rest: "" };
          }
          providers[providerName].tools[toolName].mcp = toolName;
        }

        for (const toolName of restNames) {
          if (!providers[providerName].tools[toolName]) {
            providers[providerName].tools[toolName] = { mcp: "", rest: "" };
          }
          providers[providerName].tools[toolName].rest = toolName;
        }

        // Backward compatibility: treat provider-level list as both mcp+rest.
        const legacyNames = asToolList(toolConfig?.[providerName]);
        for (const toolName of legacyNames) {
          if (!providers[providerName].tools[toolName]) {
            providers[providerName].tools[toolName] = { mcp: "", rest: "" };
          }
          if (!providers[providerName].tools[toolName].mcp) {
            providers[providerName].tools[toolName].mcp = toolName;
          }
          if (!providers[providerName].tools[toolName].rest) {
            providers[providerName].tools[toolName].rest = toolName;
          }
        }
      }
    }

    return { providers };
  }
}

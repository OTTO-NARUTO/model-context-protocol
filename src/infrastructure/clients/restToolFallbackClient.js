import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { env } from "../../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../");

const DEFAULT_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json"
};

export class RestToolFallbackClient {
  constructor() {
    this.contracts = this.loadContracts();
  }

  listTools(provider) {
    const providerConfig = this.getProviderConfig(provider);
    if (!providerConfig) {
      return [];
    }

    const tools = providerConfig.tools && typeof providerConfig.tools === "object"
      ? providerConfig.tools
      : {};

    return Object.keys(tools).map((name) => ({
      name,
      description: "REST fallback contract"
    }));
  }

  hasTool(provider, toolName) {
    return Boolean(this.getToolContract(provider, toolName));
  }

  async callTool(provider, toolName, params = {}, token) {
    if (!token) {
      throw new Error("Missing provider access token.");
    }

    const providerName = String(provider ?? "").toLowerCase();
    const providerConfig = this.getProviderConfig(providerName);
    if (!providerConfig) {
      throw new Error(`No REST fallback provider config found for ${providerName}.`);
    }

    const tool = this.getToolContract(providerName, toolName);
    if (!tool) {
      throw new Error(`No REST fallback contract found for tool '${toolName}' on provider '${providerName}'.`);
    }

    const context = this.buildContext(params, tool);
    const method = String(tool.method ?? "GET").toUpperCase();
    const baseUrl = this.getBaseApiUrl(providerName);
    const pathName = this.resolveTemplate(String(tool.path ?? ""), context, true);
    const query = this.resolveObject(tool.query, context);
    const body = this.resolveObject(tool.body, context);
    const headers = {
      ...DEFAULT_HEADERS,
      ...this.authHeaders(providerConfig, token),
      ...this.resolveObject(tool.headers, context)
    };
    const url = this.buildUrl(baseUrl, pathName, query);
    const requestId = randomUUID();

    const response = await fetch(url, {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body ?? {}) })
    });

    const rawText = await response.text();
    const parsed = this.parseResponseBody(rawText);
    if (!response.ok) {
      const errorBody = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      throw new Error(
        `REST fallback failed for ${providerName}/${toolName} (${response.status}): ${errorBody}`
      );
    }

    return {
      traceId: requestId,
      raw: parsed,
      standardized: parsed,
      transport: "rest-fallback",
      tool: toolName
    };
  }

  loadContracts() {
    const contractPath = path.resolve(projectRoot, env.REST_TOOL_CONTRACTS_PATH);
    const payload = readFileSync(contractPath, "utf-8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : {};
  }

  getProviderConfig(provider) {
    const providers = this.contracts?.providers;
    if (!providers || typeof providers !== "object") {
      return null;
    }
    return providers[String(provider ?? "").toLowerCase()] ?? null;
  }

  getToolContract(provider, toolName) {
    const providerConfig = this.getProviderConfig(provider);
    if (!providerConfig) {
      return null;
    }
    const tools = providerConfig.tools && typeof providerConfig.tools === "object"
      ? providerConfig.tools
      : {};
    return tools[String(toolName ?? "")] ?? null;
  }

  getBaseApiUrl(provider) {
    if (provider === "github") return env.GITHUB_API_BASE_URL;
    if (provider === "gitlab") return env.GITLAB_API_BASE_URL;
    if (provider === "bitbucket") return env.BITBUCKET_API_BASE_URL;
    return "";
  }

  authHeaders(providerConfig, token) {
    const authType = String(providerConfig?.auth ?? "bearer").toLowerCase();
    if (authType === "token") {
      return { Authorization: `token ${token}` };
    }
    return { Authorization: `Bearer ${token}` };
  }

  buildContext(params, tool) {
    const base = params && typeof params === "object" ? { ...params } : {};
    const owner = String(base.owner ?? "");
    const repo = String(base.repo ?? "");
    const projectPath = base.projectPath ?? (owner && repo ? `${owner}/${repo}` : "");
    const defaults = tool?.defaults && typeof tool.defaults === "object" ? tool.defaults : {};

    return {
      ...defaults,
      ...base,
      owner,
      repo,
      projectPath
    };
  }

  resolveObject(value, context) {
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveObject(item, context));
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined || entry === null) continue;
        result[key] = this.resolveObject(entry, context);
      }
      return result;
    }
    if (typeof value === "string") {
      return this.resolveTemplate(value, context, false);
    }
    return value;
  }

  resolveTemplate(input, context, encodeValues) {
    return String(input).replace(/\{([^}]+)\}/g, (_match, token) => {
      const value = context?.[token];
      const normalized = value === undefined || value === null ? "" : String(value);
      return encodeValues ? encodeURIComponent(normalized) : normalized;
    });
  }

  buildUrl(baseUrl, pathName, query) {
    const base = new URL(this.ensureTrailingSlash(baseUrl));
    const normalizedPath = String(pathName ?? "").replace(/^\/+/, "");
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    base.pathname = `${basePath}${normalizedPath}`;
    const url = base;
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  ensureTrailingSlash(value) {
    const input = String(value ?? "");
    return input.endsWith("/") ? input : `${input}/`;
  }

  parseResponseBody(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
}

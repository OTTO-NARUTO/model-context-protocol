import { randomUUID } from "crypto";
import { env } from "../../config/env.js";

export class McpClient {
  async sendRequest(provider, method, params = {}, token) {
    const url = this.getMcpUrl(provider);
    if (!url) {
      throw new Error(`MCP URL is not configured for provider ${provider}.`);
    }

    const requestId = randomUUID();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method,
        params
      })
    });

    const text = await response.text();
    console.log("RAW MCP TEXT:", text);
    if (!response.ok) {
      throw new Error(`MCP request failed (${response.status}): ${text}`);
    }

    const parsed = this.parseJsonOrSse(text);
    console.log("RAW MCP PARSED:", JSON.stringify(parsed, null, 2));
    if (parsed?.error && typeof parsed.error === "object") {
      const message = typeof parsed.error.message === "string" ? parsed.error.message : "MCP returned error";
      throw new Error(message);
    }

    return parsed?.result ?? parsed;
  }

  async callTool(provider, toolName, params, token) {
    if (!token) {
      throw new Error("Missing provider access token.");
    }

    const requestId = randomUUID();
    const parsed = await this.sendRequest(
      provider,
      "tools/call",
      {
        name: toolName,
        arguments: params ?? {},
        stream: false
      },
      token
    );
    return this.normalizeResponse(parsed, requestId);
  }

  async listTools(provider, token) {
    const result = await this.sendRequest(provider, "tools/list", {}, token);
    const tools = Array.isArray(result?.tools) ? result.tools : [];

    return tools.map((tool) => ({
      name: String(tool?.name ?? ""),
      description: String(tool?.description ?? "")
    }));
  }

  getMcpUrl(provider) {
    if (provider === "github") {
      return env.GITHUB_MCP_URL;
    }
    if (provider === "gitlab") {
      return env.GITLAB_MCP_URL;
    }
    if (provider === "bitbucket") {
      return env.BITBUCKET_MCP_URL;
    }
    return "";
  }

  parseJsonOrSse(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return this.parseSsePayload(trimmed);
    }
  }

  parseSsePayload(text) {
    if (!text.includes("data:")) {
      return text;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        continue;
      }
    }

    return text;
  }

  normalizeResponse(body, requestId) {
    if (!body || typeof body !== "object") {
      return { traceId: requestId, raw: body, standardized: body };
    }

    if (body.error && typeof body.error === "object") {
      const message = typeof body.error.message === "string" ? body.error.message : "MCP returned error";
      throw new Error(message);
    }

    const result = body.result && typeof body.result === "object" ? body.result : body;
    if (result?.isError) {
      const blocks = Array.isArray(result?.content) ? result.content : [];
      const firstText = blocks.find((block) => typeof block?.text === "string");
      const message = String(firstText?.text ?? "MCP tool returned an error response.");
      throw new Error(message);
    }

    return {
      traceId: typeof result.traceId === "string" ? result.traceId : requestId,
      raw: result.raw ?? result,
      standardized: result.standardized ?? result.raw ?? result
    };
  }
}

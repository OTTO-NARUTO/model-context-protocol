import { randomUUID } from "crypto";
import { oauthProviders } from "../../infrastructure/providers/oauthProviders.js";

export class OAuthService {
  constructor(db, encryption) {
    this.db = db;
    this.encryption = encryption;
  }

  async getConnectUrl(provider, tenantId) {
    const config = oauthProviders[provider];
    if (!config.clientId || !config.clientSecret) {
      throw new Error(`OAuth credentials missing for provider ${provider}`);
    }

    const state = randomUUID();
    await this.db.saveOAuthState({
      state,
      tenantId,
      provider,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleCallback(provider, code, state) {
    const stateRecord = await this.db.getOAuthState(state);
    if (!stateRecord) {
      throw new Error("Invalid or expired OAuth state.");
    }
    if (stateRecord.provider !== provider) {
      throw new Error("OAuth state provider mismatch.");
    }
    if (stateRecord.expiresAt.getTime() < Date.now()) {
      await this.db.deleteOAuthState(state);
      throw new Error("OAuth state expired.");
    }
    await this.db.deleteOAuthState(state);

    const config = oauthProviders[provider];
    const token = await this.exchangeCodeForToken(provider, code, config.clientId, config.clientSecret, config.redirectUri, config.tokenUrl);
    if (!token.access_token) {
      const providerError = token.error_description || token.error || "access_token missing from provider response";
      throw new Error(`OAuth token response invalid for ${provider}: ${providerError}`);
    }

    const expiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : undefined;

    await this.db.upsertToken({
      tenantId: stateRecord.tenantId,
      provider,
      accessTokenEncrypted: this.encryption.encrypt(token.access_token),
      refreshTokenEncrypted: token.refresh_token
        ? this.encryption.encrypt(token.refresh_token)
        : undefined,
      tokenType: token.token_type,
      scope: token.scope,
      expiresAt
    });

    return { tenantId: stateRecord.tenantId };
  }

  async disconnect(provider, tenantId) {
    await this.db.deleteToken(tenantId, provider);
  }

  async status(provider, tenantId) {
    const token = await this.db.getToken(tenantId, provider);
    return { connected: Boolean(token) };
  }

  async getAccessToken(provider, tenantId) {
    const token = await this.db.getToken(tenantId, provider);
    if (!token) {
      throw new Error(`No OAuth token found for ${provider} in tenant ${tenantId}.`);
    }
    return this.encryption.decrypt(token.accessTokenEncrypted);
  }

  async listRepos(provider, tenantId) {
    const token = await this.getAccessToken(provider, tenantId);
    const providerConfig = oauthProviders[provider];

    const headers = {
      Authorization: `Bearer ${token}`
    };

    if (provider === "github") {
      headers.Accept = "application/vnd.github+json";
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    }

    const response = await fetch(providerConfig.reposApiUrl, { headers });
    if (!response.ok) {
      throw new Error(`Repository fetch failed for ${provider} with status ${response.status}`);
    }

    const body = await response.json();
    return normalizeRepos(provider, body);
  }

  async exchangeCodeForToken(provider, code, clientId, clientSecret, redirectUri, tokenUrl) {
    if (provider === "bitbucket") {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OAuth token exchange failed for ${provider} with status ${response.status}: ${detail}`);
      }
      return await this.parseTokenResponse(response);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OAuth token exchange failed for ${provider} with status ${response.status}: ${detail}`);
    }
    return await this.parseTokenResponse(response);
  }

  async parseTokenResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    if (contentType.includes("application/json")) {
      return JSON.parse(bodyText);
    }

    const params = new URLSearchParams(bodyText);
    if (params.has("access_token") || params.has("error")) {
      return {
        access_token: params.get("access_token") ?? undefined,
        refresh_token: params.get("refresh_token") ?? undefined,
        token_type: params.get("token_type") ?? undefined,
        scope: params.get("scope") ?? undefined,
        error: params.get("error") ?? undefined,
        error_description: params.get("error_description") ?? undefined
      };
    }

    throw new Error(`Unsupported OAuth token response format: ${contentType || "unknown content-type"}`);
  }
}

function normalizeRepos(provider, body) {
  if (provider === "github" && Array.isArray(body)) {
    return body.map((item) => ({ id: String(item.id), name: item.full_name }));
  }

  if (provider === "gitlab" && Array.isArray(body)) {
    return body.map((item) => ({ id: String(item.id), name: item.path_with_namespace }));
  }

  if (provider === "bitbucket" && body && typeof body === "object" && Array.isArray(body.values)) {
    return body.values.map((item) => ({ id: String(item.uuid), name: item.full_name }));
  }

  return [];
}

import { isProvider } from "../../domain/entities/provider.js";
import { env } from "../../config/env.js";

export class AuthController {
  constructor(oauthService) {
    this.oauthService = oauthService;
  }

  connect = async (req, res) => {
    try {
      const providerValue = getSingleParam(req.params.provider);
      if (!isProvider(providerValue)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      const tenantId = req.tenantId;
      const url = await this.oauthService.getConnectUrl(providerValue, tenantId);
      res.redirect(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connect failed.";
      res.status(500).json({ error: message });
    }
  };

  callback = async (req, res) => {
    try {
      const providerValue = getSingleParam(req.params.provider);
      if (!isProvider(providerValue)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state) {
        res.status(400).json({ error: "OAuth callback requires code and state." });
        return;
      }
      const output = await this.oauthService.handleCallback(providerValue, code, state);
      const redirect = new URL(`/dashboard/${providerValue}`, env.FRONTEND_BASE_URL);
      redirect.searchParams.set("connected", "true");
      redirect.searchParams.set("tenant", output.tenantId);
      res.redirect(redirect.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth callback failed.";
      res.status(500).json({ error: message });
    }
  };

  disconnect = async (req, res) => {
    try {
      const providerValue = getSingleParam(req.params.provider);
      if (!isProvider(providerValue)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      const tenantId = req.tenantId;
      await this.oauthService.disconnect(providerValue, tenantId);
      res.json({ provider: providerValue, connected: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Disconnect failed.";
      res.status(500).json({ error: message });
    }
  };

  status = async (req, res) => {
    try {
      const providerValue = getSingleParam(req.params.provider);
      if (!isProvider(providerValue)) {
        res.status(400).json({ error: "Invalid provider." });
        return;
      }
      const tenantId = req.tenantId;
      const status = await this.oauthService.status(providerValue, tenantId);
      res.json({ provider: providerValue, ...status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Status check failed.";
      res.status(500).json({ error: message });
    }
  };

  repos = async (req, res) => {
    try {
      const providerValue = String(req.query.provider ?? "");
      if (!isProvider(providerValue)) {
        res.status(400).json({ error: "Invalid provider query value." });
        return;
      }
      const tenantId = req.tenantId;
      const repos = await this.oauthService.listRepos(providerValue, tenantId);
      res.json({ provider: providerValue, repos });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repo list failed.";
      if (message.includes("No OAuth token found")) {
        res.status(401).json({ error: "Connect the provider first.", repos: [] });
        return;
      }
      res.status(500).json({ error: message });
    }
  };
}

function getSingleParam(value) {
  if (!value) {
    return "";
  }
  return Array.isArray(value) ? value[0] ?? "" : value;
}

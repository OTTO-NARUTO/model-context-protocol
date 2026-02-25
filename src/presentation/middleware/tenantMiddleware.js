import { env } from "../../config/env.js";
import { parseCookieHeader, verifyTenantSessionToken } from "../../infrastructure/security/tenantSessionUtil.js";

export function tenantMiddleware(req, res, next) {
  const isOAuthCallback = /^\/auth\/[^/]+\/callback$/.test(req.path);
  if (isOAuthCallback) {
    req.tenantId = "oauth-callback";
    next();
    return;
  }

  const isOAuthConnect = /^\/auth\/[^/]+\/connect$/.test(req.path);
  const cookies = parseCookieHeader(req.header("cookie"));
  const sessionToken = cookies.tenant_session;
  const verified = verifyTenantSessionToken(sessionToken, env.TENANT_SESSION_SECRET);
  if (verified?.tenantId) {
    req.tenantId = verified.tenantId;
    next();
    return;
  }

  if (isOAuthConnect) {
    // Connect endpoint can bootstrap a new tenant session if none exists.
    req.tenantId = "";
    next();
    return;
  }

  res.status(401).json({ error: "Valid tenant session is required." });
}

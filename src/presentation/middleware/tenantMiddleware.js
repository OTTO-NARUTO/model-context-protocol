export function tenantMiddleware(req, res, next) {
  const tenantFromHeader = req.header("x-tenant-id");
  const tenantFromQuery = typeof req.query.tenant === "string" ? req.query.tenant.trim() : undefined;

  const tenantId = tenantFromHeader ?? tenantFromQuery;
  if (tenantId) {
    req.tenantId = tenantId;
    next();
    return;
  }

  const isOAuthCallback = /^\/auth\/[^/]+\/callback$/.test(req.path);
  if (isOAuthCallback) {
    req.tenantId = "oauth-callback";
    next();
    return;
  }

  res.status(400).json({ error: "x-tenant-id header or tenant query is required." });
}

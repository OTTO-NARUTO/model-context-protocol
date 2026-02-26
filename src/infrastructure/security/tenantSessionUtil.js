import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function toBase64Url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf-8");
  return buffer.toString("base64url");
}

function fromBase64Url(input) {
  return Buffer.from(String(input), "base64url");
}

function signPayload(payloadSegment, secret) {
  return toBase64Url(createHmac("sha256", secret).update(payloadSegment).digest());
}

export function createTenantSessionToken(tenantId, secret, ttlMinutes) {
  const now = Date.now();
  const expiresAt = now + Number(ttlMinutes) * 60 * 1000;
  const payload = {
    tid: String(tenantId),
    iat: now,
    exp: expiresAt,
    nonce: randomBytes(16).toString("hex")
  };

  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadSegment, secret);
  return `${payloadSegment}.${signature}`;
}

export function verifyTenantSessionToken(token, secret) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadSegment, signatureSegment] = parts;
  const expectedSignature = signPayload(payloadSegment, secret);
  const left = Buffer.from(signatureSegment, "utf-8");
  const right = Buffer.from(expectedSignature, "utf-8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf-8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }
  const tenantId = String(payload.tid ?? "");
  const expiresAt = Number(payload.exp ?? 0);
  if (!tenantId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  return {
    tenantId,
    expiresAt
  };
}

export function parseCookieHeader(cookieHeader) {
  const out = {};
  const source = String(cookieHeader ?? "");
  if (!source) {
    return out;
  }

  for (const pair of source.split(";")) {
    const [rawKey, ...rawValue] = pair.split("=");
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    out[key] = decodeURIComponent(rawValue.join("=").trim());
  }
  return out;
}

export function buildTenantSessionCookie(token, maxAgeMs, secure) {
  const segments = [
    `tenant_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(1, Math.floor(maxAgeMs / 1000))}`
  ];
  if (secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

export function clearTenantSessionCookie(secure) {
  const segments = [
    "tenant_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

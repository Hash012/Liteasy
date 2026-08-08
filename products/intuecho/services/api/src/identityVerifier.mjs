export class IdentityVerificationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function initialsFor(name) {
  const characters = [...String(name ?? "").trim()].filter((character) => !/\s/u.test(character));
  return characters.slice(0, 2).join("").toLocaleUpperCase("zh-CN") || "?";
}

export function createIdentityVerifier({
  endpoint = process.env.LITEASY_IDENTITY_ENDPOINT,
  endpointPath = "/v1/account/session",
  expectedAudience = "intuecho-web",
  useBearer = false,
  fetchImpl = fetch
} = {}) {
  const normalizedEndpoint = String(endpoint ?? "").replace(/\/+$/, "");

  return async function verifyIdentity(sessionId) {
    if (!normalizedEndpoint) {
      throw new IdentityVerificationError(
        "IDENTITY_SERVICE_UNAVAILABLE",
        "身份服务尚未配置，请稍后重试。",
        503
      );
    }

    let response;
    try {
      response = await fetchImpl(`${normalizedEndpoint}${endpointPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(useBearer ? { Authorization: `Bearer ${sessionId}` } : {})
        },
        body: JSON.stringify({ sessionId, audience: expectedAudience }),
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new IdentityVerificationError(
        "IDENTITY_SERVICE_UNAVAILABLE",
        "身份服务暂时不可用，请稍后重试。",
        503
      );
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const statusCode = response.status === 403 ? 403 : 401;
      throw new IdentityVerificationError(
        statusCode === 403 ? "INVALID_SESSION_AUDIENCE" : "INVALID_SESSION",
        statusCode === 403 ? "当前会话不适用于 Intuecho。" : "登录会话无效或已过期。",
        statusCode
      );
    }

    const session = body?.session;
    if (
      session?.audience !== expectedAudience ||
      typeof session.userId !== "string" ||
      typeof session.name !== "string"
    ) {
      throw new IdentityVerificationError(
        "INVALID_IDENTITY_RESPONSE",
        "身份服务返回了无效会话。",
        503
      );
    }

    return {
      id: session.userId,
      name: session.name,
      initials: initialsFor(session.name)
    };
  };
}

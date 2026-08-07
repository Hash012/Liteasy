import type { IdentitySession } from "./api";

const audience = "intuecho-web";
const endpoint = import.meta.env.VITE_LITEASY_IDENTITY_URL ?? "http://127.0.0.1:8787";
const storageKey = "intuecho.auth.development-session.v1";

function loopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  } catch {
    return false;
  }
}

function store(session: IdentitySession | null) {
  if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  else localStorage.removeItem(storageKey);
}

function read() {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return null;
    const session = JSON.parse(value) as IdentitySession;
    return session.audience === audience && session.sessionId && session.userId ? session : null;
  } catch {
    return null;
  }
}

async function request(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${endpoint}${path}`, {
    body: JSON.stringify({ ...body, audience }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "身份服务请求失败");
  if (payload.session?.audience !== audience) throw new Error("身份服务返回了错误的会话类型");
  store(payload.session);
  return payload.session as IdentitySession;
}

export const developmentIdentity = {
  available(apiUrl: string) {
    return import.meta.env.DEV && loopbackUrl(apiUrl) && loopbackUrl(endpoint);
  },
  clear() {
    store(null);
  },
  login(email: string, password: string) {
    return request("/v1/account/login", { email, password });
  },
  read,
  register(displayName: string, email: string, password: string) {
    return request("/v1/account/register", { displayName, email, password });
  },
  async restore() {
    const session = read();
    if (!session) return null;
    try {
      return await request("/v1/account/session", { sessionId: session.sessionId });
    } catch (error) {
      store(null);
      throw error;
    }
  },
  async logout() {
    const session = read();
    store(null);
    if (!session) return;
    await fetch(`${endpoint}/v1/account/logout`, {
      body: JSON.stringify({ sessionId: session.sessionId }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }).catch(() => undefined);
  }
};

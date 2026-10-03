export const clientAudiences = ["intuecho-web", "liteasy-admin", "liteasy-desktop", "liteasy-mobile"];

export function validateIsolatedRefreshConfig(value) {
  const forbidden = () => { throw new Error("isolated_identity_test_required"); };
  if (value?.schema !== "liteasy.isolated-refresh-test/v1" || value.disposableTestInstance !== true
    || !/^[a-f0-9]{16}$/.test(value.runId ?? "")) forbidden();
  let origin;
  try {
    const parsed = new URL(value.origin);
    if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "[::1]"].includes(parsed.hostname)
      || Number(parsed.port) < 1024 || !parsed.port || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash) forbidden();
    origin = parsed.origin;
  } catch { forbidden(); }
  if (typeof value.subjectId !== "string" || !value.subjectId || !value.admin?.clientId || !value.admin?.clientSecret
    || !Array.isArray(value.sessions) || new Set(value.sessions.map((item) => item.clientId)).size !== value.sessions.length) forbidden();
  for (const session of value.sessions) if (!clientAudiences.includes(session.clientId) || typeof session.refreshToken !== "string" || !session.refreshToken) forbidden();
  const realm = `liteasy-review-${value.runId}`;
  return { ...value, origin, tokenUrl: `${origin}/realms/${realm}/protocol/openid-connect/token`,
    userInfoUrl: `${origin}/realms/${realm}/protocol/openid-connect/userinfo`, apiUrl: `${origin}/admin/realms/${realm}` };
}

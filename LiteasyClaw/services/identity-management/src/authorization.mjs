import { IdentityManagementError } from "./keycloakClient.mjs";

function values(value) {
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}

export async function authorizeManagementRequest(header, config, fetchImpl = fetch) {
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header.trim()) : null;
  if (!match) throw new IdentityManagementError("management_authentication_required", 401);
  const basic = Buffer.from(
    `${config.verifier.clientId}:${config.verifier.clientSecret}`,
    "utf8"
  ).toString("base64");
  let response;
  try {
    response = await fetchImpl(config.verifier.url, {
      body: new URLSearchParams({ token: match[1], token_type_hint: "access_token" }),
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new IdentityManagementError("identity_introspection_unavailable");
  }
  if (!response.ok) throw new IdentityManagementError("identity_introspection_unavailable");
  let body;
  try {
    body = await response.json();
  } catch {
    throw new IdentityManagementError("identity_introspection_invalid_response");
  }
  const clientId = body.client_id ?? body.azp;
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/) : [];
  if (
    body.active !== true ||
    body.iss !== config.issuer ||
    clientId !== config.callerClientId ||
    !values(body.aud).includes(config.audience) ||
    !scopes.includes("accounts:write") ||
    !scopes.includes("sessions:revoke")
  ) {
    throw new IdentityManagementError("management_authorization_denied", 403);
  }
  return Object.freeze({ clientId, issuer: body.iss });
}

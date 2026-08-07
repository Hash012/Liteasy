import { ProductionIdentityError } from "./productionIdentity.mjs";

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new ProductionIdentityError("admin_authorization_invalid_response", 503);
  }
}

export function createPlatformAdminAuthorizer({ baseUrl, fetchImpl = fetch }) {
  const normalized = String(baseUrl ?? "").replace(/\/+$/, "");
  if (!normalized) throw new Error("intuecho_admin_api_missing");
  return {
    async assertPlatformAdmin(identity) {
      let response;
      try {
        response = await fetchImpl(`${normalized}/v1/admin/me`, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${identity.token}`
          },
          signal: AbortSignal.timeout(5_000)
        });
      } catch {
        throw new ProductionIdentityError("admin_authorization_unavailable", 503);
      }
      const body = await parseJson(response);
      if (!response.ok) {
        if (response.status === 401) throw new ProductionIdentityError("authentication_required", 401);
        if (response.status === 403) throw new ProductionIdentityError("platform_admin_required", 403);
        throw new ProductionIdentityError("admin_authorization_unavailable", 503);
      }
      if (
        body?.principal?.subjectId !== identity.subject ||
        !Array.isArray(body.principal.roles) ||
        !body.principal.roles.includes("platform_admin")
      ) {
        throw new ProductionIdentityError("platform_admin_required", 403);
      }
      return Object.freeze({ subject: identity.subject });
    },
    async readiness() {
      let response;
      try {
        response = await fetchImpl(`${normalized}/readyz`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5_000)
        });
      } catch {
        throw new ProductionIdentityError("admin_authorization_unavailable", 503);
      }
      const body = await parseJson(response);
      if (!response.ok || body?.status !== "ready") {
        throw new ProductionIdentityError("admin_authorization_unavailable", 503);
      }
      return { ready: true };
    }
  };
}

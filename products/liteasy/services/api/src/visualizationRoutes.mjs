import { requireFreshMfa } from "./identityVerifier.mjs";
import { normalizeVisualizationAuditQuery, VisualizationServiceError } from "./visualizationService.mjs";

const adminReadQueryKeys = new Map([
  ["/v1/admin/visualization/providers", new Set()],
  ["/v1/admin/visualization/quota-policies", new Set(["limit", "subjectId"])],
  ["/v1/admin/visualization/usage", new Set(["limit", "subjectId"])],
  ["/v1/admin/visualization/audit", new Set(["action", "from", "limit", "subjectId", "to"])]
]);

function adminReadInput(url) {
  const allowed = adminReadQueryKeys.get(url.pathname);
  const input = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed?.has(key) || Object.hasOwn(input, key)) {
      throw new VisualizationServiceError("visualization_query_invalid");
    }
    input[key] = value;
  }
  return url.pathname === "/v1/admin/visualization/audit"
    ? normalizeVisualizationAuditQuery(input)
    : input;
}

async function desktopIdentity(runtime, request) {
  return runtime.identityVerifier.verifyAuthorizationHeader(
    request.headers.authorization,
    "liteasy-desktop"
  );
}

async function adminPrincipal(runtime, request, { fresh = false } = {}) {
  const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
    request.headers.authorization,
    "liteasy-admin"
  );
  if (fresh) requireFreshMfa(identity);
  return runtime.platformAdminRepository.principal(identity);
}

export async function handleVisualizationRequest({
  config,
  readJsonBody,
  request,
  response,
  runtime,
  sendJson,
  traceId,
  url
}) {
  if (request.method === "GET" && url.pathname === "/v1/account/capabilities") {
    const identity = await desktopIdentity(runtime, request);
    const developerDiagnostics = config.environment !== "production" &&
      await runtime.platformAdminRepository.hasRole(identity.subject, "developer_diagnostics");
    const multimodalVisualization = await runtime.visualizationService.accountCapability(identity.subject);
    sendJson(response, 200, { developerDiagnostics, multimodalVisualization });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/v1/account/preferences/multimodal-visualization/set") {
    const identity = await desktopIdentity(runtime, request);
    const body = await readJsonBody(request);
    sendJson(response, 200, await runtime.visualizationService.setPreference(identity.subject, {
      ...body,
      traceId
    }));
    return true;
  }

  const adminReads = new Map([
    ["/v1/admin/visualization/providers", "listProviderRoutes"],
    ["/v1/admin/visualization/quota-policies", "listQuotaPolicies"],
    ["/v1/admin/visualization/usage", "listUsage"],
    ["/v1/admin/visualization/audit", "listAudit"]
  ]);
  if (request.method === "GET" && adminReads.has(url.pathname)) {
    const principal = await adminPrincipal(runtime, request);
    const input = adminReadInput(url);
    sendJson(response, 200, await runtime.visualizationService[adminReads.get(url.pathname)](principal, input));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/visualization/entitlements/get") {
    const principal = await adminPrincipal(runtime, request);
    sendJson(response, 200, await runtime.visualizationService.getEntitlement(
      principal,
      await readJsonBody(request)
    ));
    return true;
  }

  const adminMutations = new Map([
    ["/v1/admin/visualization/providers/save", "saveProviderRoute"],
    ["/v1/admin/visualization/providers/test", "testProviderRoute"],
    ["/v1/admin/visualization/entitlements/set", "setEntitlement"],
    ["/v1/admin/visualization/quota-policies/set", "setQuotaPolicy"]
  ]);
  if (request.method === "POST" && adminMutations.has(url.pathname)) {
    const principal = await adminPrincipal(runtime, request, { fresh: true });
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const input = { ...await readJsonBody(request), traceId };
    sendJson(response, 200, await runtime.visualizationService[adminMutations.get(url.pathname)](
      principal,
      input,
      controller.signal
    ));
    return true;
  }

  if (request.method === "POST" && new Set([
    "/v1/internal/visualization/generate",
    "/v1/internal/visualization/submit"
  ]).has(url.pathname)) {
    await runtime.identityVerifier.verifyServiceAuthorizationHeader(
      request.headers.authorization,
      {
        clientId: config.identity.visualizationServiceClientId,
        requiredScope: "visualization:generate"
      }
    );
    const body = await readJsonBody(request, 12 * 1024 * 1024);
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const method = url.pathname.endsWith("/submit") ? "submit" : "generate";
    sendJson(response, 200, await runtime.visualizationService[method](
      body.subjectId,
      body.input,
      { signal: controller.signal, traceId }
    ));
    return true;
  }

  return false;
}

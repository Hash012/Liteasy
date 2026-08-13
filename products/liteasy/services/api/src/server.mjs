import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  loadCloudConfig,
  publicAdminIdentityConfig,
  publicCloudConfig,
  publicDesktopIdentityConfig
} from "./config.mjs";
import { AccountLifecycleError } from "./accountLifecycleError.mjs";
import { ExternalRetrievalError } from "./externalRetrievalConnectors.mjs";
import { IdentityError, requireFreshMfa } from "./identityVerifier.mjs";
import { IntuechoLiteratureClientError } from "./intuechoLiteratureClient.mjs";
import { authorizeLibraryScope, LibraryAuthorizationError } from "./libraryAuthorization.mjs";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { MarketingApplicationError } from "./marketingApplicationRepository.mjs";
import { ModelProxyError } from "./modelProxyService.mjs";
import { PdfUploadError } from "./pdfUploadService.mjs";
import { PlatformAdminError } from "./platformAdminRepository.mjs";
import { startCloudRuntime } from "./runtime.mjs";
import { VisualizationServiceError } from "./visualizationService.mjs";
import { handleVisualizationRequest } from "./visualizationRoutes.mjs";

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...(response.liteasyCorsOrigin ? {
      "access-control-allow-origin": response.liteasyCorsOrigin,
      vary: "Origin"
    } : {}),
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function applyCorsOrigin(request, response, config) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || !config.allowedOrigins.includes(origin)) {
    throw new LibraryAuthorizationError("origin_forbidden", 403);
  }
  response.liteasyCorsOrigin = origin;
}

function sendCorsPreflight(response) {
  response.writeHead(204, {
    "access-control-allow-headers": [
      "authorization",
      "content-type",
      "x-idempotency-key",
      "x-liteasy-duplicate-action",
      "x-liteasy-document-id",
      "x-liteasy-expected-revision",
      "x-liteasy-file-name",
      "x-liteasy-folder-id",
      "x-liteasy-scope-id",
      "x-liteasy-scope-type",
      "x-liteasy-session-id"
    ].join(", "),
    "access-control-allow-methods": "DELETE, GET, PATCH, POST, OPTIONS",
    "access-control-allow-origin": response.liteasyCorsOrigin,
    "access-control-max-age": "600",
    vary: "Origin"
  });
  response.end();
}

async function sendPdfStream(response, object, fileName, mode) {
  response.writeHead(200, {
    ...(response.liteasyCorsOrigin ? {
      "access-control-allow-origin": response.liteasyCorsOrigin,
      vary: "Origin"
    } : {}),
    "cache-control": "no-store",
    "content-disposition": `${mode === "export" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "content-length": String(object.byteLength),
    "content-type": "application/pdf",
    "x-content-type-options": "nosniff"
  });
  await pipeline(object.body, response);
}

async function sendPrivateRasterStream(response, object) {
  response.writeHead(200, {
    ...(response.liteasyCorsOrigin ? {
      "access-control-allow-origin": response.liteasyCorsOrigin,
      vary: "Origin"
    } : {}),
    "cache-control": "private, no-store",
    "content-length": String(object.byteLength),
    "content-type": "image/png",
    "x-content-type-options": "nosniff"
  });
  await pipeline(object.body, response);
}

async function readJsonBody(request, maximumBytes = 1024 * 1024) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new LibraryRepositoryError("request_content_type_invalid", 415);
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maximumBytes) throw new LibraryRepositoryError("request_body_too_large", 413);
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value;
  } catch {
    throw new LibraryRepositoryError("request_json_invalid", 400);
  }
}

function requireMarketingSecret(request, config) {
  const supplied = request.headers["x-liteasy-marketing-secret"];
  const expected = config.marketing?.applicationSecret;
  if (typeof supplied !== "string" || typeof expected !== "string") {
    throw new MarketingApplicationError("marketing_service_authentication_required", 401);
  }
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(suppliedHash, expectedHash)) {
    throw new MarketingApplicationError("marketing_service_authentication_required", 401);
  }
}

function errorMessage(code) {
  const messages = {
    access_token_invalid: "Your session is invalid. Sign in again.",
    agent_artifact_id_invalid: "The Agent artifact identifier is invalid.",
    agent_artifact_invalid: "The Agent artifact is invalid and was not saved.",
    agent_artifact_not_found: "The Agent artifact is unavailable for this account.",
    agent_artifact_title_invalid: "Enter an Agent artifact title between 1 and 160 characters.",
    agent_artifact_too_large: "The Agent artifact exceeds the storage limit.",
    authentication_required: "Sign in to access cloud resources.",
    identity_service_unavailable: "Identity verification is temporarily unavailable. Retry later.",
    identity_subject_invalid: "请输入 Keycloak 用户详情中的有效用户 ID，不要填写邮箱或用户名。",
    idempotency_key_invalid: "操作标识无效，请刷新页面后重试。",
    service_client_mismatch: "The calling service identity is not authorized.",
    service_scope_required: "The calling service lacks the required authorization scope.",
    external_pdf_grant_not_found: "The external PDF authorization expired or is unavailable. Search again and retry.",
    external_pdf_header_invalid: "The external resource is not a valid PDF.",
    external_pdf_network_forbidden: "The external PDF location is not allowed.",
    external_pdf_redirect_invalid: "The external PDF redirected to an invalid location.",
    external_pdf_timeout: "The external PDF download timed out. Retry later.",
    external_pdf_too_large: "The external PDF exceeds the download limit.",
    external_pdf_type_invalid: "The external resource is not served as a PDF.",
    external_pdf_upstream_unavailable: "The external PDF is temporarily unavailable.",
    external_retrieval_provider_response_invalid: "A literature provider returned an invalid response. Retry later.",
    external_retrieval_provider_response_too_large: "A literature provider returned too much data. Narrow the query and retry.",
    external_retrieval_provider_timeout: "A literature provider timed out. Retry later.",
    external_retrieval_provider_unavailable: "A literature provider is temporarily unavailable.",
    external_retrieval_unavailable: "No configured literature source is currently available.",
    INVALID_LITERATURE_QUERY: "The literature identity request is invalid.",
    LITERATURE_CANDIDATE_NOT_FOUND: "The literature candidate is no longer available.",
    LITERATURE_CORROBORATION_REQUIRED: "The literature candidate requires another independent source.",
    LITERATURE_IDENTITY_CONFLICT: "The literature identifiers conflict with an existing record.",
    LITERATURE_PROVIDER_UNAVAILABLE: "The literature identity provider is temporarily unavailable.",
    LITERATURE_RATE_LIMITED: "Too many literature identity requests were submitted. Retry later.",
    intuecho_literature_response_invalid: "The literature authority returned an invalid response.",
    intuecho_literature_unavailable: "The literature authority is temporarily unavailable.",
    literature_projection_not_confirmed: "The literature projection is not confirmed at that revision.",
    external_retrieval_relation_request_invalid: "The paper relation request is invalid.",
    external_retrieval_relation_paper_invalid: "The paper relation request contains an invalid paper.",
    external_retrieval_relation_limit_invalid: "Select no more than 24 papers for relation analysis.",
    external_retrieval_relation_identity_conflict: "The paper relation request contains conflicting paper identities.",
    paper_relation_provider_unavailable: "A configured literature provider could not return paper relations.",
    last_platform_admin_required: "At least one active platform administrator must remain.",
    library_name_exists: "An item with this name already exists in the target folder.",
    library_revision_conflict: "The library changed. Refresh it and retry.",
    model_policy_not_configured: "The model policy is not configured.",
    model_policy_revision_conflict: "The model policy changed. Refresh it and retry.",
    model_not_allowed: "The requested model is not enabled by the current deployment.",
    model_output_format_invalid: "The requested structured output format is invalid.",
    model_output_format_too_large: "The requested structured output format is too large.",
    model_prompt_invalid: "Enter a valid prompt and retry.",
    model_prompt_too_large: "The model input is too large. Reduce the selected content and retry.",
    model_provider_not_allowed: "The requested model provider is not enabled by the current policy.",
    model_provider_rate_limited: "The model service is busy. Retry later.",
    model_provider_rejected: "The model provider could not process this request. Retry or contact support with the trace ID.",
    model_provider_response_invalid: "The model provider returned an invalid response. Retry later.",
    model_provider_timeout: "The model provider timed out. Retry later.",
    model_provider_unavailable: "The model provider is not configured or is temporarily unavailable.",
    model_request_aborted: "The model request was cancelled.",
    model_request_invalid: "The model request is invalid.",
    pdf_security_rejected: "The PDF was rejected by the security policy.",
    recommendation_candidate_invalid: "The recommendation candidate is invalid.",
    recommendation_candidate_not_found: "The recommendation candidate is no longer available.",
    recommendation_pdf_unavailable: "No downloadable PDF is currently available for this recommendation.",
    pdf_security_scanner_unavailable: "PDF security scanning is temporarily unavailable. Retry later.",
    organization_invitation_required: "This invitation is not available to the signed-in account.",
    organization_invitation_not_pending: "This invitation is no longer available.",
    organization_membership_required: "You no longer have access to this organization.",
    organization_revision_conflict: "The organization changed. Refresh it and retry.",
    organization_status_invalid: "The organization status is invalid.",
    organization_role_forbidden: "Your organization role does not allow this operation.",
    platform_admin_required: "Platform administrator access is required.",
    platform_role_already_granted: "该用户已经拥有这个平台角色。",
    platform_role_grant_not_found: "找不到该平台角色授权，请刷新页面后重试。",
    platform_role_invalid: "平台角色无效，请刷新管理页面后重试。",
    platform_role_required: "This account has no active platform role.",
    admin_reason_invalid: "请输入至少 8 个字符的操作原因。",
    production_diagnostics_forbidden: "Developer diagnostics cannot be enabled in production.",
    quota_revision_conflict: "The storage quota changed. Refresh it and retry.",
    quota_scope_not_found: "The quota target is not available.",
    retrieval_source_name_exists: "A retrieval source already uses this name.",
    retrieval_source_connector_exists: "This retrieval connector is already configured.",
    retrieval_source_revision_conflict: "The retrieval source changed. Refresh it and retry.",
    recommendation_cache_scope_invalid: "The recommendation cache scope is invalid. Refresh and retry.",
    recommendation_documents_invalid: "Select up to three valid documents and retry.",
    recommendation_feedback_invalid: "The recommendation feedback is invalid.",
    recommendation_provider_response_invalid: "The literature provider returned an invalid response. Retry later.",
    recommendation_provider_timeout: "The literature provider timed out. Retry later.",
    recommendation_provider_unavailable: "The literature provider is temporarily unavailable. Retry later.",
    research_profile_invalid: "The recommendation research profile is invalid.",
    session_revoked: "Your session has ended. Sign in again.",
    support_access_required: "A current support access grant is required.",
    account_lifecycle_in_progress: "This account change is already running. Retry shortly.",
    account_lifecycle_pending_retry: "The account is disabled, but deletion is incomplete. Retry with the same operation key.",
    account_owns_organization: "Transfer or delete organizations owned by this account first.",
    admin_self_disable_forbidden: "The current administrator cannot disable or delete their own account.",
    identity_session_revocation_unconfirmed: "The identity service did not confirm complete session revocation.",
    storage_publish_failed: "The PDF could not be committed to storage. Retry with the same operation.",
    storage_security_scan_required: "The PDF has no valid security scan proof and cannot be published."
  };
  return messages[code] ?? "The request could not be completed.";
}

function sendError(response, error, traceId) {
  const known = error instanceof AccountLifecycleError ||
    error instanceof ExternalRetrievalError ||
    error instanceof IdentityError ||
    error instanceof IntuechoLiteratureClientError ||
    error instanceof LibraryAuthorizationError ||
    error instanceof LibraryRepositoryError ||
    error instanceof MarketingApplicationError ||
    error instanceof ModelProxyError ||
    error instanceof PdfUploadError ||
    error instanceof PlatformAdminError ||
    error instanceof VisualizationServiceError;
  const code = known ? error.code : "internal_error";
  const status = known ? error.status : 500;
  if (!known) console.error(`[cloud] ${traceId}`, error);
  sendJson(response, status, { code, message: errorMessage(code), traceId });
}

function modelStreamHeaders(response) {
  response.writeHead(200, {
    ...(response.liteasyCorsOrigin ? {
      "access-control-allow-origin": response.liteasyCorsOrigin,
      vary: "Origin"
    } : {}),
    "cache-control": "no-store",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
}

async function sendModelStream(response, stream, provider, traceId) {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new ModelProxyError("model_provider_response_invalid", 502);
  let answer = "";
  let started = false;
  try {
    modelStreamHeaders(response);
    started = true;
    let current = first;
    while (!current.done) {
      answer += current.value;
      response.write(`${JSON.stringify({ delta: current.value, type: "delta" })}\n`);
      current = await iterator.next();
    }
    response.end(`${JSON.stringify({
      answer,
      execution: { backend: "cloud", mode: "live", provider },
      type: "completed"
    })}\n`);
  } catch (error) {
    if (!started) throw error;
    const known = error instanceof ModelProxyError;
    const code = known ? error.code : "internal_error";
    if (!known) console.error(`[cloud] ${traceId}`, error);
    response.end(`${JSON.stringify({ code, message: errorMessage(code), traceId, type: "error" })}\n`);
  }
}

export function createCloudRequestHandler(runtime, config) {
  return async (request, response) => {
    const traceId = `trace_${randomUUID()}`;
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      applyCorsOrigin(request, response, config);
      if (request.method === "OPTIONS") {
        if (!response.liteasyCorsOrigin) throw new LibraryAuthorizationError("origin_required", 403);
        sendCorsPreflight(response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        sendJson(response, 200, {
          deployment: publicCloudConfig(config),
          readiness: runtime.readiness,
          status: "ready"
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/identity/desktop-config") {
        sendJson(response, 200, publicDesktopIdentityConfig(config));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/identity/admin-config") {
        sendJson(response, 200, publicAdminIdentityConfig(config));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/internal/marketing/applications") {
        requireMarketingSecret(request, config);
        sendJson(response, 201, await runtime.marketingApplicationRepository.create(
          await readJsonBody(request, 32 * 1024)
        ));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/internal/marketing/installer-downloaded") {
        requireMarketingSecret(request, config);
        const body = await readJsonBody(request, 4 * 1024);
        sendJson(response, 200, await runtime.marketingApplicationRepository.markInstallerDownloaded(
          body.applicationId
        ));
        return;
      }

      if (await handleVisualizationRequest({
        config,
        readJsonBody,
        request,
        response,
        runtime,
        sendJson,
        traceId,
        url
      })) return;

      const rasterAssetMatch = url.pathname.match(/^\/v1\/account\/visualization\/assets\/([a-f0-9]{64})$/);
      if (request.method === "GET" && rasterAssetMatch) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const object = await runtime.visualizationService.openRasterAsset(identity.subject, rasterAssetMatch[1]);
        await sendPrivateRasterStream(response, object);
        return;
      }

      if (runtime.literatureAuthorityClient && (
        (request.method === "POST" && new Set([
          "/v1/literature:confirm",
          "/v1/literature:resolve",
          "/v1/literature:verify"
        ]).has(url.pathname)) ||
        (request.method === "GET" && /^\/v1\/literature\/[^/]+\/relations$/.test(url.pathname))
      )) {
        await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        if (request.method === "GET") {
          const encodedLiteratureId = url.pathname.slice("/v1/literature/".length, -"/relations".length);
          let literatureId;
          try {
            literatureId = decodeURIComponent(encodedLiteratureId);
          } catch {
            throw new IntuechoLiteratureClientError("INVALID_LITERATURE_QUERY", 400);
          }
          sendJson(response, 200, await runtime.literatureAuthorityClient.relations(literatureId));
          return;
        }
        const body = await readJsonBody(request);
        const result = url.pathname.endsWith(":resolve")
          ? await runtime.literatureAuthorityClient.resolve(body)
          : url.pathname.endsWith(":confirm")
            ? await runtime.literatureAuthorityClient.confirm(body)
            : { literature: await runtime.literatureAuthorityClient.verifyProjection(body) };
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/internal/intuecho/organizations/access",
        "/v1/internal/intuecho/organizations/invitations",
        "/v1/internal/intuecho/organizations/memberships"
      ]).has(url.pathname)) {
        const serviceIdentity = await runtime.identityVerifier.verifyServiceAuthorizationHeader(
          request.headers.authorization,
          {
            clientId: config.identity.intuechoServiceClientId,
            requiredScope: "organization:authorize"
          }
        );
        const body = await readJsonBody(request);
        if (url.pathname.endsWith("/memberships")) {
          sendJson(response, 200, await runtime.organizationGovernanceRepository.listForIntuecho({
            userSubject: body.userSubject
          }));
          return;
        }
        if (url.pathname.endsWith("/access")) {
          sendJson(response, 200, await runtime.organizationGovernanceRepository.authorizeIntuechoAccess({
            organizationId: body.organizationId,
            userSubject: body.userSubject
          }));
          return;
        }
        sendJson(response, 201, await runtime.organizationGovernanceRepository.inviteFromIntuecho(
          serviceIdentity,
          {
            actorSubject: body.actorSubject,
            idempotencyKey: body.idempotencyKey,
            organizationId: body.organizationId,
            role: body.role,
            targetSubject: body.targetSubject,
            traceId
          }
        ));
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/model-policy") {
        await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        sendJson(response, 200, await runtime.platformAdminRepository.loadModelPolicy());
        return;
      }

      if (
        url.pathname === "/v1/agent-artifacts" ||
        url.pathname.startsWith("/v1/agent-artifacts/")
      ) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const artifactId = url.pathname.startsWith("/v1/agent-artifacts/")
          ? url.pathname.slice("/v1/agent-artifacts/".length)
          : undefined;
        if (request.method === "GET" && artifactId === undefined) {
          sendJson(response, 200, await runtime.agentArtifactRepository.list(identity.subject));
          return;
        }
        if (request.method === "POST" && artifactId === undefined) {
          const body = await readJsonBody(request, 12 * 1024 * 1024);
          sendJson(response, 201, await runtime.agentArtifactRepository.save(
            identity.subject,
            body,
            traceId
          ));
          return;
        }
        if (request.method === "PATCH" && artifactId !== undefined) {
          const body = await readJsonBody(request);
          sendJson(response, 200, await runtime.agentArtifactRepository.rename(
            identity.subject,
            artifactId,
            body.title,
            traceId
          ));
          return;
        }
        if (request.method === "DELETE" && artifactId !== undefined) {
          sendJson(response, 200, await runtime.agentArtifactRepository.remove(
            identity.subject,
            artifactId,
            traceId
          ));
          return;
        }
      }

      if (request.method === "POST" && new Set([
        "/v1/model/generate",
        "/v1/model/generate-stream"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        const context = {
          signal: controller.signal,
          subjectId: identity.subject,
          traceId
        };
        if (url.pathname.endsWith("generate-stream")) {
          await sendModelStream(
            response,
            runtime.modelProxyService.generateStream(body, context),
            body.provider,
            traceId
          );
          return;
        }
        sendJson(response, 200, await runtime.modelProxyService.generate(body, context));
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/research/external-knowledge",
        "/v1/research/external-pdf",
        "/v1/research/paper-relations"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const principal = { subjectId: identity.subject };
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        const result = url.pathname.endsWith("external-pdf")
          ? await runtime.externalKnowledgeService.download(principal, body, controller.signal)
          : url.pathname.endsWith("paper-relations")
            ? await runtime.externalKnowledgeService.relations(principal, body, controller.signal)
            : await runtime.externalKnowledgeService.search(principal, body, controller.signal);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/me") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        );
        let principal;
        try {
          principal = await runtime.platformAdminRepository.principal(identity);
        } catch (error) {
          if (!(error instanceof PlatformAdminError) || error.code !== "platform_role_required") throw error;
          requireFreshMfa(identity);
          principal = await runtime.platformAdminRepository.principal(identity, {
            activatePending: true,
            traceId
          });
        }
        sendJson(response, 200, {
          authentication: {
            fresh: Number.isFinite(identity.authTime) && Date.now() / 1000 - identity.authTime <= 300,
            methods: identity.authenticationMethods
          },
          principal
        });
        return;
      }

      const adminMutationRoutes = new Map([
        ["/v1/admin/roles/grant", "grantRole"],
        ["/v1/admin/roles/revoke", "revokeRole"],
        ["/v1/admin/model-policy/set", "setModelPolicy"],
        ["/v1/admin/organizations/status", "setOrganizationStatus"],
        ["/v1/admin/quotas/set", "setQuota"],
        ["/v1/admin/retrieval-sources/remove", "removeRetrievalSource"],
        ["/v1/admin/retrieval-sources/save", "saveRetrievalSource"],
        ["/v1/admin/support-access/grant", "grantSupportAccess"],
        ["/v1/admin/support-access/revoke", "revokeSupportAccess"]
      ]);
      if (request.method === "POST" && adminMutationRoutes.has(url.pathname)) {
        const identity = requireFreshMfa(await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        ));
        const principal = await runtime.platformAdminRepository.principal(identity);
        const body = await readJsonBody(request);
        const method = adminMutationRoutes.get(url.pathname);
        sendJson(response, 200, await runtime.platformAdminRepository[method](principal, {
          ...body,
          traceId
        }));
        return;
      }

      if (request.method === "GET" && new Set([
        "/v1/admin/governance",
        "/v1/admin/model-policy",
        "/v1/admin/retrieval-sources"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        );
        const principal = await runtime.platformAdminRepository.principal(identity);
        const result = url.pathname.endsWith("model-policy")
          ? await runtime.platformAdminRepository.getModelPolicy(principal)
          : url.pathname.endsWith("governance")
            ? await runtime.platformAdminRepository.listGovernance(principal)
            : await runtime.platformAdminRepository.listRetrievalSources(principal);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/quotas/get") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        );
        const principal = await runtime.platformAdminRepository.principal(identity);
        sendJson(response, 200, await runtime.platformAdminRepository.getQuota(
          principal,
          await readJsonBody(request)
        ));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/accounts/status") {
        const identity = requireFreshMfa(await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        ));
        const principal = await runtime.platformAdminRepository.principal(identity);
        sendJson(response, 200, await runtime.accountLifecycleService.setStatus(
          principal,
          identity,
          { ...await readJsonBody(request), traceId }
        ));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/audit/list") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        );
        const principal = await runtime.platformAdminRepository.principal(identity);
        sendJson(response, 200, await runtime.platformAdminRepository.listAudit(
          principal,
          await readJsonBody(request)
        ));
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/marketing-applications") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        );
        const principal = await runtime.platformAdminRepository.principal(identity);
        sendJson(response, 200, await runtime.marketingApplicationRepository.list(principal, {
          before: url.searchParams.get("before") || undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/support/documents/download") {
        const identity = requireFreshMfa(await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-admin"
        ));
        const principal = await runtime.platformAdminRepository.principal(identity);
        const body = await readJsonBody(request);
        const scope = await runtime.platformAdminRepository.resolveSupportScope(principal, body);
        const document = await runtime.libraryRepository.getDownloadablePdf(scope, body.documentId);
        const object = await runtime.objectStore.openObject(document.storageKey);
        if (
          object.byteLength !== document.byteLength ||
          object.mediaType !== "application/pdf" ||
          object.metadata.sha256 !== document.contentHash
        ) {
          throw new LibraryRepositoryError("storage_object_integrity_mismatch", 500);
        }
        await runtime.libraryRepository.recordDocumentAccess(scope, {
          action: "support_document_accessed",
          actorId: identity.subject,
          documentId: document.documentId,
          reason: scope.grant.reason,
          supportGrantId: scope.grant.grantId,
          traceId
        });
        await sendPdfStream(response, object, document.fileName, "download");
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/library/entries/metadata",
        "/v1/library/folders/create",
        "/v1/library/tree"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const capability = url.pathname === "/v1/library/tree" ? "read" : "upload";
        const scope = await authorizeLibraryScope(runtime.pool, identity, body, capability);
        if (url.pathname === "/v1/library/tree") {
          sendJson(response, 200, await runtime.libraryRepository.getTree(scope, body.status));
          return;
        }
        const input = { ...body, actorId: identity.subject, traceId };
        if (url.pathname === "/v1/library/folders/create") {
          sendJson(response, 200, await runtime.libraryRepository.createFolder(scope, input));
          return;
        }
        sendJson(response, 200, await runtime.libraryRepository.createMetadataEntry(scope, input));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/library/documents/upload") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        if ((request.headers["content-type"] ?? "").toLowerCase() !== "application/pdf") {
          throw new LibraryRepositoryError("request_content_type_invalid", 415);
        }
        const scope = await authorizeLibraryScope(runtime.pool, identity, {
          scopeId: request.headers["x-liteasy-scope-id"],
          scopeType: request.headers["x-liteasy-scope-type"]
        }, "upload");
        let fileName;
        try {
          fileName = decodeURIComponent(request.headers["x-liteasy-file-name"] ?? "");
        } catch {
          throw new LibraryRepositoryError("library_pdf_file_name_invalid");
        }
        const duplicateAction = request.headers["x-liteasy-duplicate-action"];
        if (duplicateAction && !new Set(["cancel", "save_copy"]).has(duplicateAction)) {
          throw new LibraryRepositoryError("library_duplicate_action_invalid");
        }
        const expectedRevision = Number(request.headers["x-liteasy-expected-revision"]);
        const operationKey = request.headers["x-idempotency-key"];
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new LibraryRepositoryError("library_revision_invalid");
        }
        if (typeof operationKey !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(operationKey)) {
          throw new LibraryRepositoryError("idempotency_key_invalid");
        }
        if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".pdf") || /[\u0000-\u001f/\\]/.test(fileName)) {
          throw new LibraryRepositoryError("library_pdf_file_name_invalid");
        }
        sendJson(response, 200, await runtime.pdfUploadService.upload(scope, {
          actorId: identity.subject,
          duplicateAction,
          expectedRevision,
          fileName,
          folderId: request.headers["x-liteasy-folder-id"],
          idempotencyKey: operationKey,
          operationId: randomUUID(),
          readable: request,
          traceId
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/library/entries/attach-pdf") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        if ((request.headers["content-type"] ?? "").toLowerCase() !== "application/pdf") {
          throw new LibraryRepositoryError("request_content_type_invalid", 415);
        }
        const scope = await authorizeLibraryScope(runtime.pool, identity, {
          scopeId: request.headers["x-liteasy-scope-id"],
          scopeType: request.headers["x-liteasy-scope-type"]
        }, "upload");
        let fileName;
        try {
          fileName = decodeURIComponent(request.headers["x-liteasy-file-name"] ?? "");
        } catch {
          throw new LibraryRepositoryError("library_pdf_file_name_invalid");
        }
        const expectedRevision = Number(request.headers["x-liteasy-expected-revision"]);
        const idempotencyKey = request.headers["x-idempotency-key"];
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new LibraryRepositoryError("library_revision_invalid");
        }
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
          throw new LibraryRepositoryError("idempotency_key_invalid");
        }
        if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".pdf") || /[\u0000-\u001f/\\]/.test(fileName)) {
          throw new LibraryRepositoryError("library_pdf_file_name_invalid");
        }
        sendJson(response, 200, await runtime.pdfUploadService.attach(scope, {
          actorId: identity.subject,
          documentId: request.headers["x-liteasy-document-id"],
          expectedRevision,
          fileName,
          idempotencyKey,
          operationId: randomUUID(),
          readable: request,
          traceId
        }));
        return;
      }

      const libraryMutationRoutes = new Map([
        ["/v1/library/documents/update", ["manage", "updateEntry"]],
        ["/v1/library/documents/trash", ["manage", "trashEntry"]],
        ["/v1/library/documents/restore", ["manage", "restoreEntry"]],
        ["/v1/library/entries/purge", ["manage", "purgeEntry"]],
        ["/v1/library/folders/update", ["manage", "updateFolder"]],
        ["/v1/library/folders/trash", ["manage", "trashFolder"]],
        ["/v1/library/folders/restore", ["manage", "restoreFolder"]],
        ["/v1/library/folders/purge", ["manage", "purgeFolder"]],
        ["/v1/library/trash/empty", ["manage", "emptyTrash"]]
      ]);
      if (request.method === "POST" && libraryMutationRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const [capability, repositoryMethod] = libraryMutationRoutes.get(url.pathname);
        const scope = await authorizeLibraryScope(runtime.pool, identity, body, capability);
        sendJson(response, 200, await runtime.libraryRepository[repositoryMethod](scope, {
          ...body,
          actorId: identity.subject,
          traceId
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/library/entries/copy") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const sourceScope = await authorizeLibraryScope(
          runtime.pool,
          identity,
          body.source,
          body.source?.scopeType === "organization" ? "export" : "read"
        );
        const targetScope = await authorizeLibraryScope(runtime.pool, identity, body.target, "upload");
        sendJson(response, 200, await runtime.libraryRepository.copyEntry(sourceScope, targetScope, {
          actorId: identity.subject,
          documentId: body.documentId,
          expectedRevision: body.expectedRevision,
          folderId: body.target?.folderId,
          idempotencyKey: body.idempotencyKey,
          traceId
        }));
        return;
      }

      const organizationReadRoutes = new Map([
        ["/v1/org/list", "list"],
        ["/v1/org/summary", "summary"],
        ["/v1/org/invitations/list", "listInvitations"]
      ]);
      if (request.method === "POST" && organizationReadRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const method = organizationReadRoutes.get(url.pathname);
        const result = method === "list"
          ? await runtime.organizationGovernanceRepository.list(identity)
          : await runtime.organizationGovernanceRepository[method](identity, body);
        sendJson(response, 200, result);
        return;
      }

      const organizationMutationRoutes = new Map([
        ["/v1/org/create", "create"],
        ["/v1/org/invite", "invite"],
        ["/v1/org/join", "acceptInvitation"],
        ["/v1/org/leave", "leave"],
        ["/v1/org/invitations/revoke", "revokeInvitation"],
        ["/v1/org/members/role", "changeMemberRole"],
        ["/v1/org/members/status", "setMemberStatus"],
        ["/v1/org/owner/transfer", "transferOwnership"]
      ]);
      if (request.method === "POST" && organizationMutationRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const method = organizationMutationRoutes.get(url.pathname);
        sendJson(response, 200, await runtime.organizationGovernanceRepository[method](identity, {
          ...body,
          traceId
        }));
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/org/storage-policy",
        "/v1/org/storage-policy/update"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const updating = url.pathname.endsWith("/update");
        const scope = await authorizeLibraryScope(runtime.pool, identity, {
          scopeId: body.organizationId,
          scopeType: "organization"
        }, updating ? "manage" : "read");
        if (updating) {
          sendJson(response, 200, await runtime.organizationPolicyRepository.update(scope, {
            ...body,
            actorId: identity.subject,
            traceId
          }));
        } else {
          sendJson(response, 200, await runtime.organizationPolicyRepository.get(scope));
        }
        return;
      }

      const teamAnnotationRoutes = new Map([
        ["/v1/org/annotations/list", "list"],
        ["/v1/org/annotations/create", "create"],
        ["/v1/org/annotations/update", "update"],
        ["/v1/org/annotations/delete", "remove"]
      ]);
      if (request.method === "POST" && teamAnnotationRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const scope = await authorizeLibraryScope(runtime.pool, identity, {
          scopeId: body.organizationId,
          scopeType: "organization"
        }, "read");
        const method = teamAnnotationRoutes.get(url.pathname);
        sendJson(response, 200, await runtime.teamAnnotationRepository[method](scope, {
          ...body,
          actorId: identity.subject,
          traceId
        }));
        return;
      }

      const personalizationRoutes = new Map([
        ["/v1/profile/get", "get"],
        ["/v1/profile/save", "saveProfile"],
        ["/v1/profile/clear", "clear"],
        ["/v1/personalization/settings", "get"],
        ["/v1/personalization/settings/update", "setEnabled"],
        ["/v1/personalization/signal", "recordSignal"],
        ["/v1/documents/metadata-sync", "syncLocalManifest"]
      ]);
      if (request.method === "POST" && personalizationRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const method = personalizationRoutes.get(url.pathname);
        const result = method === "get"
          ? await runtime.personalizationRepository.get(identity.subject)
          : await runtime.personalizationRepository[method](identity.subject, {
            ...body,
            actorId: identity.subject,
            traceId
          });
        sendJson(response, 200, url.pathname === "/v1/documents/metadata-sync"
          ? { result }
          : result);
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/recommendations",
        "/v1/recommendations/pdf-grant"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const result = url.pathname.endsWith("pdf-grant")
          ? await runtime.recommendationService.issuePdfGrant(identity.subject, body)
          : await runtime.recommendationService.generate(identity.subject, { ...body, traceId });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/recommendations/feedback") {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        sendJson(response, 200, await runtime.recommendationRepository.recordFeedback(identity.subject, {
          ...body,
          traceId
        }));
        return;
      }

      const recommendationCacheRoutes = new Map([
        ["/v1/recommendation-cache/get", "getCache"],
        ["/v1/recommendation-cache/put", "putCache"],
        ["/v1/recommendation-cache/clear", "clearCache"]
      ]);
      if (request.method === "POST" && recommendationCacheRoutes.has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const method = recommendationCacheRoutes.get(url.pathname);
        sendJson(response, 200, await runtime.recommendationRepository[method](identity.subject, body));
        return;
      }

      if (request.method === "POST" && new Set([
        "/v1/library/documents/authorize",
        "/v1/library/documents/download",
        "/v1/library/documents/export"
      ]).has(url.pathname)) {
        const identity = await runtime.identityVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
          "liteasy-desktop"
        );
        const body = await readJsonBody(request);
        const accessCapability = url.pathname.endsWith("/authorize") ? "read" : "export";
        const mode = url.pathname.endsWith("/export") ? "export" : "download";
        const scope = await authorizeLibraryScope(
          runtime.pool,
          identity,
          body,
          accessCapability
        );
        const document = await runtime.libraryRepository.getDownloadablePdf(scope, body.documentId);
        const auditAction = url.pathname.endsWith("/authorize")
          ? "authorize_pdf_read"
          : mode === "export"
            ? "export_pdf"
            : "download_pdf";
        await runtime.libraryRepository.recordDocumentAccess(scope, {
          action: auditAction,
          actorId: identity.subject,
          documentId: document.documentId,
          traceId
        });
        if (url.pathname.endsWith("/authorize")) {
          const serverNow = new Date();
          sendJson(response, 200, {
            document: {
              byteLength: document.byteLength,
              contentHash: document.contentHash,
              documentId: document.documentId,
              entryKind: "pdf",
              fileName: document.fileName,
              metadata: document.metadata,
              scopeId: scope.scopeId,
              scopeType: scope.scopeType,
              status: "active",
              title: document.title
            },
            expiresAt: new Date(serverNow.getTime() + 5 * 60 * 1000).toISOString(),
            revision: document.revision,
            serverNow: serverNow.toISOString()
          });
          return;
        }
        const object = await runtime.objectStore.openObject(document.storageKey);
        if (
          object.byteLength !== document.byteLength ||
          object.mediaType !== "application/pdf" ||
          object.metadata.sha256 !== document.contentHash
        ) {
          throw new LibraryRepositoryError("storage_object_integrity_mismatch", 500);
        }
        await sendPdfStream(response, object, document.fileName, mode);
        return;
      }

      sendJson(response, 404, {
        code: "route_not_found",
        message: "The requested service route does not exist.",
        traceId
      });
    } catch (error) {
      sendError(response, error, traceId);
    }
  };
}

export async function startCloudServer(config = loadCloudConfig(), dependencies = {}) {
  const runtime = await startCloudRuntime(config, dependencies);
  const server = http.createServer(createCloudRequestHandler(runtime, config));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  return {
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await runtime.close();
    },
    runtime,
    server
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadCloudConfig();
  const service = await startCloudServer(config);
  process.stdout.write(`Liteasy cloud listening on http://${config.host}:${config.port}\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await service.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

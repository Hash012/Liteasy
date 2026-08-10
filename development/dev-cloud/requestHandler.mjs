import { buildAdminConsoleHtml } from "./adminConsole.mjs";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { AuthError, createAuthService } from "./auth/authService.mjs";
import { createMfaService } from "./auth/mfa.mjs";
import { createRateLimiter } from "./auth/rateLimiter.mjs";
import {
  buildPublicRuntimeSummary,
  defaultConfig,
  getPublicOrigin
} from "./config.mjs";
import {
  buildCollectionListPayload,
  buildCollectionSavePayload
} from "./payloads/collectionPayloads.mjs";
import {
  buildRecommendationCacheClearPayload,
  buildRecommendationCacheGetPayload,
  buildRecommendationCachePutPayload
} from "./payloads/recommendationCachePayloads.mjs";
import {
  buildRecommendationFeedbackPayload,
  getRecommendationFeedback
} from "./payloads/recommendationFeedbackPayloads.mjs";
import {
  buildModelAuditPayload,
  buildProviderRegistry,
  buildStreamingProviderRegistry,
  generateAnswer,
  generateAnswerStream
} from "./payloads/modelPayloads.mjs";
import {
  buildOrganizationCreatePayload,
  buildOrganizationGovernancePayload,
  buildOrganizationInvitePayload,
  buildOrganizationJoinPayload,
  buildOrganizationLeavePayload,
  buildOrganizationListPayload,
  buildOrganizationMemberRolePayload,
  buildOrganizationMemberStatusPayload,
  buildOrganizationOwnershipTransferPayload,
  buildOrganizationSharedLibraryManifestPayload,
  buildOrganizationStoragePolicyPayload,
  buildOrganizationStoragePolicyUpdatePayload,
  buildOrganizationSummaryPayload
} from "./payloads/organizationPayloads.mjs";
import {
  buildPolicyPayload,
  buildPolicyUpdatePayload
} from "./payloads/policyPayloads.mjs";
import {
  buildLiveRecommendationPayload,
  normalizeRecommendationResearchProfile
} from "./payloads/recommendationPayloads.mjs";
import { applyRecommendationEmbeddingScores } from "./payloads/recommendationEmbeddingPayloads.mjs";
import { applyRecommendationExternalReranker } from "./payloads/recommendationRerankerPayloads.mjs";
import { createAccountRepository } from "./db/accountRepository.mjs";
import { createAuthSessionRepository } from "./db/authSessionRepository.mjs";
import { createDatabase } from "./db/database.mjs";
import { createCollectionRepository } from "./db/collectionRepository.mjs";
import {
  createPlatformAdminRepository,
  PlatformAuthorizationError
} from "./db/platformAdminRepository.mjs";
import { createExternalKnowledgeRunRepository } from "./db/externalKnowledgeRunRepository.mjs";
import { createGrobidParseCacheRepository } from "./db/grobidParseCacheRepository.mjs";
import {
  createLibraryStorageRepository,
  LibraryStorageError
} from "./db/libraryStorageRepository.mjs";
import { IntuechoLiteratureClient } from "../../products/liteasy/services/api/src/intuechoLiteratureClient.mjs";
import {
  LiteratureMetadataValidationError,
  normalizeLiteratureMetadata,
  normalizeLiteratureProjectionReference
} from "../../products/liteasy/services/api/src/literatureMetadata.mjs";
import { assertDevCloudDeploymentBoundary } from "./deploymentBoundary.mjs";
import {
  createOrganizationRepository,
  OrganizationRepositoryError
} from "./db/organizationRepository.mjs";
import {
  createRecommendationCandidateRepository,
  listRecommendationCandidateSources,
  loadRecommendationCandidate,
  setRecommendationCandidateRepository,
  updateRecommendationCandidateStatus,
  upsertRecommendationCandidates
} from "./db/recommendationCandidateRepository.mjs";
import { createExternalPdfGrantRepository } from "./db/externalPdfGrantRepository.mjs";
import {
  clearRecommendationCacheForSession,
  createRecommendationCacheRepository,
  setRecommendationCacheRepository
} from "./db/recommendationCacheRepository.mjs";
import {
  createRecommendationFeedbackRepository,
  setRecommendationFeedbackRepository
} from "./db/recommendationFeedbackRepository.mjs";
import { createAgentArtifactRepository } from "./agentArtifactRepository.mjs";
import {
  createMineruExtractionCacheKey,
  createMineruExtractionRepository
} from "./mineruExtractionRepository.mjs";
import {
  createPersonalizationRepository,
  PersonalizationValidationError
} from "./db/personalizationRepository.mjs";
import {
  WorkRepositoryError,
  createWorkRepository
} from "./db/workRepository.mjs";
import {
  createConceptRepository,
  loadDisciplineCatalog
} from "./db/conceptRepository.mjs";
import {
  buildConceptListPayload,
  buildConceptListQuery,
  buildConceptPayload,
  normalizeConceptCode
} from "./payloads/conceptPayloads.mjs";
import {
  TagRepositoryError,
  createTagRepository
} from "./db/tagRepository.mjs";
import {
  buildTagListQuery,
  buildTagPayload,
  buildWorkIndexRequest,
  buildWorkIndexSnapshot,
  buildWorksForTagPayload,
  normalizeTagId
} from "./payloads/tagPayloads.mjs";
import {
  buildWorkResolutionRequest,
  buildWorkResolutionSnapshot
} from "./payloads/identityResolutionPayloads.mjs";
import {
  ExternalKnowledgeError,
  searchExternalKnowledge
} from "./payloads/externalKnowledgePayloads.mjs";
import {
  buildPaperRelationPayload,
  PaperRelationValidationError
} from "./payloads/paperRelationPayloads.mjs";
import { fetchSecurePdf, SecurePdfFetchError } from "./securePdfFetch.mjs";
import { extractPdfWithMineru } from "./mineruPdfExtraction.mjs";
import {
  fingerprintPdf,
  GrobidParseError,
  grobidParserVersion,
  isPdfBytes,
  parsePdfWithGrobid
} from "./grobidClient.mjs";

// 深度论文分析会携带多篇论文的分层证据和 SubAgent 区段报告。
// 仍保留明确上限以防止本地开发服务被无界请求占满内存。
const maximumJsonBodyBytes = 512 * 1024;
// MinerU figures are persisted with generated artifacts and can contain several
// megabytes of base64 image data.
const maximumAgentArtifactBodyBytes = 12 * 1024 * 1024;
const maximumMineruPdfBytes = 24 * 1024 * 1024;
const maximumMineruRequestBytes = Math.ceil(maximumMineruPdfBytes * 1.38);
const maximumPdfParseBodyBytes = 40 * 1024 * 1024;
const maximumLibraryPdfBytes = 256 * 1024 * 1024;

const availableEndpoints = [
  "GET /",
  "GET /healthz",
  "GET /admin",
  "GET /admin/",
  "GET /v1/model-policy",
  "GET /v1/admin/model-policy",
  "POST /v1/admin/model-policy",
  "GET /v1/admin/governance-dashboard",
  "POST /v1/admin/session",
  "GET /v1/admin/retrieval-sources",
  "POST /v1/admin/retrieval-sources",
  "POST /v1/admin/retrieval-sources/remove",
  "GET /v1/admin/forum/posts",
  "POST /v1/admin/forum/posts/moderate",
  "POST /v1/account/login",
  "POST /v1/account/logout",
  "POST /v1/account/change-bootstrap-password",
  "POST /v1/account/register",
  "POST /v1/account/session",
  "GET /v1/account/capabilities",
  "POST /v1/model/generate",
  "POST /v1/model/generate-stream",
  "POST /v1/model/audit",
  "GET /v1/agent-artifacts",
  "POST /v1/agent-artifacts",
  "PATCH /v1/agent-artifacts/:artifactId",
  "DELETE /v1/agent-artifacts/:artifactId",
  "POST /v1/recommendations",
  "POST /v1/recommendations/feedback",
  "POST /v1/recommendations/pdf-grant",
  "POST /v1/research/external-knowledge",
  "POST /v1/research/paper-relations",
  "POST /v1/research/external-pdf",
  "POST /v1/pdf/mineru-extract",
  "POST /v1/works/resolve",
  "GET /v1/concepts",
  "GET /v1/concepts/:code",
  "POST /v1/works/:workId/index",
  "GET /v1/tags",
  "GET /v1/tags/:id",
  "GET /v1/tags/:id/works",
  "POST /v1/research/parse-pdf",
  "POST /v1/profile/get",
  "POST /v1/profile/save",
  "POST /v1/profile/clear",
  "POST /v1/personalization/settings",
  "POST /v1/personalization/settings/update",
  "POST /v1/personalization/signal",
  "POST /v1/recommendation-cache/get",
  "POST /v1/recommendation-cache/put",
  "POST /v1/recommendation-cache/clear",
  "POST /v1/documents/metadata-sync",
  "POST /v1/org/create",
  "POST /v1/org/join",
  "POST /v1/org/invite",
  "POST /v1/org/leave",
  "POST /v1/org/list",
  "POST /v1/org/members/role",
  "POST /v1/org/members/status",
  "POST /v1/org/owner/transfer",
  "POST /v1/org/summary",
  "POST /v1/org/shared-library/manifest",
  "POST /v1/org/governance-summary",
  "POST /v1/org/storage-policy",
  "POST /v1/org/storage-policy/update",
  "POST /v1/library/tree",
  "POST /v1/library/documents/upload",
  "POST /v1/library/documents/list",
  "POST /v1/library/entries/metadata",
  "POST /v1/library/entries/attach-pdf",
  "POST /v1/library/entries/copy",
  "POST /v1/library/entries/purge",
  "POST /v1/library/documents/trash",
  "POST /v1/library/documents/restore",
  "POST /v1/library/documents/update",
  "POST /v1/library/documents/authorize",
  "POST /v1/library/documents/download",
  "POST /v1/library/documents/export",
  "POST /v1/library/folders/create",
  "POST /v1/library/folders/update",
  "POST /v1/library/folders/trash",
  "POST /v1/library/folders/restore",
  "POST /v1/library/folders/purge",
  "POST /v1/library/trash/empty",
  "POST /v1/library/quota",
  "POST /v1/org/team-annotations/list",
  "POST /v1/org/team-annotations/upload",
  "POST /v1/org/team-annotations/withdraw",
  "POST /v1/org/annotations/list",
  "POST /v1/org/annotations/create",
  "POST /v1/org/annotations/update",
  "POST /v1/org/annotations/delete",
  "POST /v1/admin/storage-quota",
  "POST /v1/admin/accounts/status",
  "POST /v1/admin/support-access/grant",
  "POST /v1/admin/support-access/revoke",
  "POST /v1/admin/support-access/document"
];

const endpointMethods = new Map(
  availableEndpoints.map((endpoint) => {
    const [method, path] = endpoint.split(" ");
    return [path, method];
  })
);

function buildCorsHeaders(request) {
  const origin = request.headers.origin;
  const isLoopbackOrigin = (() => {
    if (typeof origin !== "string") {
      return false;
    }

    try {
      const parsedOrigin = new URL(origin);
      return (
        (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") &&
        (parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "localhost")
      );
    } catch {
      return false;
    }
  })();
  const configuredOrigins = request.liteasyAllowedOrigins;
  const isConfiguredOrigin =
    configuredOrigins instanceof Set &&
    typeof origin === "string" &&
    configuredOrigins.has(origin);
  const isDesktopOrigin = new Set(["http://tauri.localhost", "tauri://localhost"]).has(origin);
  const allowOrigin =
    typeof origin !== "string"
      ? "*"
      : isLoopbackOrigin || isDesktopOrigin || isConfiguredOrigin
        ? origin
        : undefined;

  const headers = {
    "Access-Control-Allow-Headers": [
      "Authorization",
      "Content-Type",
      "X-Liteasy-Duplicate-Action",
      "X-Liteasy-File-Name",
      "X-Liteasy-Folder-Id",
      "X-Liteasy-Scope-Id",
      "X-Liteasy-Scope-Type",
      "X-Liteasy-Session-Id"
    ].join(", "),
    "Access-Control-Allow-Methods": "DELETE,GET,PATCH,POST,OPTIONS",
    Vary: "Origin"
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

function writeCorsPreflight(request, response) {
  response.writeHead(204, buildCorsHeaders(request));
  response.end();
}

function configuredOpenAlexMailto(config, customConfig) {
  const configured = typeof customConfig.openAlexMailto === "string" && customConfig.openAlexMailto.trim()
    ? customConfig.openAlexMailto.trim()
    : (typeof config.openAlexMailto === "string" ? config.openAlexMailto.trim() : "");
  return configured;
}

function configuredOpenAlexServiceKey(config, customConfig) {
  const configuredKey = typeof customConfig.openAlexApiKey === "string" && customConfig.openAlexApiKey.trim()
    ? customConfig.openAlexApiKey.trim()
    : (typeof config.openAlexApiKey === "string" ? config.openAlexApiKey.trim() : "");
  if (configuredKey) {
    return configuredKey;
  }

  // A custom transport is a server-owned connector used by integration tests and
  // deployments with an authenticated upstream wrapper. It is never a browser input.
  return customConfig.openAlexEnabled !== false && typeof customConfig.openAlexTransport === "function"
    ? "server-configured-connector"
    : "";
}

function writeJson(request, response, statusCode, payload) {
  const traceId = request.liteasyTraceId ?? `trace_${randomUUID()}`;
  request.liteasyTraceId = traceId;
  const responsePayload = statusCode >= 400
    ? {
        code: typeof payload?.code === "string"
          ? payload.code
          : typeof payload?.error === "string"
            ? payload.error
            : "request_failed",
        message: typeof payload?.message === "string"
          ? payload.message
          : "请求未完成，请稍后重试。",
        traceId
      }
    : payload;
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  response.end(JSON.stringify(responsePayload));
}

function writePdf(request, response, bytes) {
  response.writeHead(200, {
    ...buildCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": "application/pdf",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  response.end(bytes);
}

async function writeNdjsonStream(request, response, stream) {
  const traceId = request.liteasyTraceId ?? `trace_${randomUUID()}`;
  request.liteasyTraceId = traceId;
  response.writeHead(200, {
    ...buildCorsHeaders(request),
    "Cache-Control": "no-store, no-transform",
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });
  try {
    for await (const event of stream) {
      response.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    console.error(`Model stream failed (${traceId})`, error);
    response.write(`${JSON.stringify({
      code: "model_stream_failed",
      message: "模型流式响应中断，请重试。",
      traceId,
      type: "error"
    })}\n`);
  } finally {
    response.end();
  }
}

function writeHtml(request, response, statusCode, html) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

async function readJsonBody(request, maximumBytes = maximumJsonBodyBytes) {
  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      const error = new Error("request_body_too_large");
      error.code = "REQUEST_BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (rawBody.length === 0) {
    return {};
  }

  return JSON.parse(rawBody);
}

async function writeLibraryPdf(request, response, stored) {
  response.writeHead(200, {
    ...buildCorsHeaders(request),
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(stored.document.fileName)}`,
    "Content-Length": stored.byteLength,
    "Content-Type": "application/pdf"
  });
  const stream = fs.createReadStream(stored.filePath);
  try {
    for await (const chunk of stream) {
      response.write(chunk);
    }
    response.end();
  } catch (error) {
    const traceId = request.liteasyTraceId ?? `trace_${randomUUID()}`;
    request.liteasyTraceId = traceId;
    console.error(`Library PDF stream failed (${traceId})`, error);
    if (typeof response.destroy === "function") response.destroy();
    else response.end();
  }
}

async function readBinaryBody(request, maximumBytes) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      const error = new Error("request_body_too_large");
      error.code = "REQUEST_BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const suspiciousPdfMarkers = [
  Buffer.from("/JavaScript"),
  Buffer.from("/Launch"),
  Buffer.from("/EmbeddedFile"),
  Buffer.from("/RichMedia")
];

async function stageBinaryBody(request, maximumBytes, libraryStorageRepository) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    const error = new Error("request_body_too_large");
    error.code = "REQUEST_BODY_TOO_LARGE";
    throw error;
  }
  const stagedPath = libraryStorageRepository.createUploadStagingPath();
  let descriptor;
  try {
    descriptor = fs.openSync(stagedPath, "r+");
  } catch (error) {
    libraryStorageRepository.discardStagedUpload(stagedPath);
    throw error;
  }
  const hasher = createHash("sha256");
  const maximumMarkerLength = Math.max(...suspiciousPdfMarkers.map((marker) => marker.length));
  let byteLength = 0;
  let header = Buffer.alloc(0);
  let suspicious = false;
  let tail = Buffer.alloc(0);
  let descriptorClosed = false;
  try {
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        const error = new Error("request_body_too_large");
        error.code = "REQUEST_BODY_TOO_LARGE";
        throw error;
      }
      if (header.length < 5) {
        header = Buffer.concat([header, chunk]).subarray(0, 5);
      }
      const scanWindow = Buffer.concat([tail, chunk]);
      suspicious ||= suspiciousPdfMarkers.some((marker) => scanWindow.includes(marker));
      tail = scanWindow.subarray(Math.max(0, scanWindow.length - maximumMarkerLength + 1));
      hasher.update(chunk);
      fs.writeSync(descriptor, chunk);
    }
    fs.fsyncSync(descriptor);
    return {
      byteLength,
      contentHash: hasher.digest("hex"),
      header,
      stagedPath,
      suspicious
    };
  } catch (error) {
    fs.closeSync(descriptor);
    descriptorClosed = true;
    libraryStorageRepository.discardStagedUpload(stagedPath);
    throw error;
  } finally {
    if (!descriptorClosed) fs.closeSync(descriptor);
  }
}

function requirePdfUploadHeaders(request, response) {
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/pdf")) {
    writeJson(request, response, 415, {
      error: "invalid_pdf_content_type",
      message: "文献正文只接受 application/pdf。"
    });
    return false;
  }
  const rawName = request.headers["x-liteasy-file-name"];
  let fileName;
  try {
    fileName = decodeURIComponent(typeof rawName === "string" ? rawName : "");
  } catch {
    fileName = "";
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    writeJson(request, response, 400, {
      error: "invalid_pdf_file_name",
      message: "文献正文必须使用 PDF 文件名。"
    });
    return false;
  }
  return fileName;
}

async function validateLibraryPdfSecurity(staged, customConfig) {
  if (staged.byteLength === 0 || !staged.header.equals(Buffer.from("%PDF-"))) {
    const error = new Error("invalid_pdf");
    error.code = "invalid_pdf";
    throw error;
  }
  if (staged.suspicious) {
    const error = new Error("unsafe_pdf_content");
    error.code = "unsafe_pdf_content";
    throw error;
  }
  if (typeof customConfig.scanLibraryPdf === "function") {
    const result = await customConfig.scanLibraryPdf({
      byteLength: staged.byteLength,
      contentHash: staged.contentHash,
      mediaType: "application/pdf",
      stagedPath: staged.stagedPath
    });
    if (result !== true && result?.clean !== true) {
      const error = new Error("unsafe_pdf_content");
      error.code = "unsafe_pdf_content";
      throw error;
    }
  } else if (customConfig.environment === "production") {
    const error = new Error("pdf_security_scanner_unavailable");
    error.code = "pdf_security_scanner_unavailable";
    throw error;
  }
}

async function readJsonOrWriteError(
  request,
  response,
  maximumBytes = maximumJsonBodyBytes
) {
  try {
    return await readJsonBody(request, maximumBytes);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "REQUEST_BODY_TOO_LARGE") {
      writeJson(request, response, 413, {
        error: "request_body_too_large",
        message: "请求内容过大。"
      });
      return null;
    }

    writeJson(request, response, 400, {
      error: "invalid_json"
    });
    return null;
  }
}

function getClientKey(request, action) {
  const address = request.socket?.remoteAddress ?? "local";
  return `${action}:${address}`;
}

function getClientLabel(request) {
  const userAgent = request.headers["user-agent"];
  return typeof userAgent === "string" ? userAgent.slice(0, 200) : "Liteasy desktop";
}

function writeAuthError(request, response, error) {
  if (error instanceof AuthError) {
    writeJson(request, response, error.statusCode, {
      error: error.code,
      message: error.message
    });
    return true;
  }

  return false;
}

function authorizeAccountScopedBody(request, response, body, authService) {
  const authorization = request.headers.authorization;
  const bearerSession = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const sessionId = bearerSession || (
    typeof body === "object" && body !== null && typeof body.sessionId === "string"
      ? body.sessionId
      : ""
  );

  try {
    const session = authService.validateSession(sessionId);
    body.sessionId = `user:${session.userId}`;
    return session;
  } catch (error) {
    if (!writeAuthError(request, response, error)) {
      writeJson(request, response, 401, {
        error: "invalid_session",
        message: "登录会话无效或已过期。"
      });
    }
    return false;
  }
}

function authorizeLibraryScope(request, response, body, authService, organizationRepository) {
  if (!authorizeAccountScopedBody(request, response, body, authService)) return null;
  const actorId = body.sessionId;
  const scopeType = body.scopeType === "organization" ? "organization" : "user";
  const scopeId = scopeType === "user" ? (body.scopeId || actorId) : body.scopeId;
  if (scopeType === "user") {
    if (scopeId !== actorId) {
      writeJson(request, response, 403, { error: "personal_library_forbidden" });
      return null;
    }
    return { actorId, role: "owner", scopeId, scopeType };
  }
  const role = organizationRepository.getMemberRole(scopeId, actorId);
  if (!role) {
    writeJson(request, response, 403, { error: "organization_membership_required" });
    return null;
  }
  return {
    actorId,
    recordLibraryAudit: (operationKind, metadata) => organizationRepository.recordLibraryAudit(
      scopeId,
      actorId,
      operationKind,
      metadata
    ),
    role,
    scopeId,
    scopeType
  };
}

function canManageOrganizationLibrary(scope) {
  return scope.scopeType === "user" || scope.role === "owner" || scope.role === "admin";
}

function writeLibraryStorageError(request, response, error) {
  if (error instanceof LibraryStorageError) {
    writeJson(request, response, error.statusCode, { error: error.code, message: error.message });
    return;
  }
  writeJson(request, response, 500, {
    error: "library_storage_failed",
    message: "文献库操作未完成，请使用错误编号联系支持。"
  });
}

function libraryMutationKey(request, body = {}) {
  const header = request.headers["x-idempotency-key"];
  return typeof header === "string" && header.trim()
    ? header.trim()
    : typeof body.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";
}

function executeLibraryMutation(
  request,
  repository,
  scope,
  body,
  operationKind,
  operation
) {
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new LibraryStorageError(
      "invalid_library_revision",
      "A valid expected library revision is required."
    );
  }
  const { sessionId: _sessionId, ...requestInput } = body;
  const result = repository.runIdempotent(
    scope.actorId,
    libraryMutationKey(request, body),
    operationKind,
    () => {
      const value = operation();
      if (typeof scope.recordLibraryAudit === "function") {
        const resultNode = value?.entry ?? value?.document ?? value?.folder ?? value?.result;
        scope.recordLibraryAudit(operationKind, {
          resourceId: resultNode?.documentId ?? resultNode?.folderId ?? body.documentId ?? body.folderId ?? null
        });
      }
      return value;
    },
    requestInput
  );
  return {
    ...result.value,
    replayed: result.replayed,
    revision: repository.getRevision(scope.scopeType, scope.scopeId)
  };
}

function createLiteratureProjectionVerifier(config, customVerifier) {
  if (customVerifier) return customVerifier;
  const projection = config.intuechoLiteratureProjection;
  if (!projection || [
    projection.apiUrl,
    projection.audience,
    projection.clientId,
    projection.clientSecret,
    projection.scope,
    projection.tokenUrl
  ].some((value) => typeof value !== "string" || !value.trim())) return null;
  return new IntuechoLiteratureClient(projection);
}

async function verifyLiteratureProjection(verifier, value) {
  let reference;
  try {
    reference = normalizeLiteratureProjectionReference(value);
  } catch (error) {
    if (error instanceof LiteratureMetadataValidationError) {
      throw new LibraryStorageError("literature_metadata_invalid", "Literature metadata is invalid.");
    }
    throw error;
  }
  if (!verifier) {
    throw new LibraryStorageError(
      "literature_projection_verifier_unavailable",
      "Literature projection verification is unavailable.",
      503
    );
  }
  let literature;
  try {
    literature = normalizeLiteratureMetadata(await verifier.verifyProjection(reference));
  } catch (error) {
    if (error?.code === "literature_projection_not_confirmed") {
      throw new LibraryStorageError(error.code, "Literature projection is not confirmed.", 409);
    }
    throw new LibraryStorageError(
      "intuecho_literature_unavailable",
      "Literature projection verification is unavailable.",
      503
    );
  }
  if (literature.literatureId !== reference.literatureId || literature.revision !== reference.revision) {
    throw new LibraryStorageError(
      "literature_projection_verification_mismatch",
      "Literature projection verification did not match the requested revision.",
      503
    );
  }
  return literature;
}

function writeOrganizationError(request, response, error) {
  if (error instanceof OrganizationRepositoryError) {
    writeJson(request, response, error.statusCode, {
      error: error.code,
      message: error.code
    });
    return;
  }
  throw error;
}

function authorizePlatformAdmin(
  request,
  response,
  authService,
  platformAdminRepository,
  { requireFreshMfa = false } = {}
) {
  const authorization = request.headers.authorization;
  const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  try {
    const session = authService.validateSession(token, "liteasy-admin");
    const ownerKey = `user:${session.userId}`;
    platformAdminRepository.requirePlatformAdmin(ownerKey);
    if (requireFreshMfa) {
      const verifiedAt = Date.parse(session.mfaVerifiedAt ?? "");
      if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 15 * 60 * 1000) {
        throw new PlatformAuthorizationError("fresh_mfa_required", 403);
      }
    }
    return { ownerKey, session };
  } catch (error) {
    if (error instanceof AuthError) {
      writeAuthError(request, response, error);
    } else if (error instanceof PlatformAuthorizationError) {
      writeJson(request, response, error.statusCode, {
        error: error.code,
        message: error.code
      });
    } else {
      writeJson(request, response, 401, {
        error: "admin_authentication_required",
        message: "需要管理员登录。"
      });
    }
    return null;
  }
}

function requireAdminReason(request, response, body, message = "高风险管理操作必须填写原因。") {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    writeJson(request, response, 400, {
      error: "admin_reason_required",
      message
    });
    return null;
  }
  return reason;
}

function personalizedRecommendationBody(body, preferences) {
  const currentProfile = body.researchProfile && typeof body.researchProfile === "object"
    ? body.researchProfile
    : {};
  const disciplineTopics = Array.isArray(preferences.profile?.disciplines)
    ? preferences.profile.disciplines.flatMap((discipline) => [
        discipline?.name,
        discipline?.description
      ])
    : [];
  const behaviorTopics = Array.isArray(preferences.terms)
    ? preferences.terms
        .filter((term) => typeof term?.term === "string" && term.weight > 0)
        .map((term) => term.term)
    : [];
  const topics = [...new Set([
    ...(Array.isArray(currentProfile.topics) ? currentProfile.topics : []),
    ...disciplineTopics,
    ...behaviorTopics
  ].filter((topic) => typeof topic === "string" && topic.trim()))].slice(0, 12);
  const researchProfile = {
    datasets: Array.isArray(currentProfile.datasets) ? currentProfile.datasets : [],
    languages: Array.isArray(currentProfile.languages) ? currentProfile.languages : [],
    methods: Array.isArray(currentProfile.methods) ? currentProfile.methods : [],
    topics
  };

  return {
    ...body,
    ...(Object.values(researchProfile).some((items) => items.length > 0)
      ? { researchProfile }
      : {})
  };
}

function withoutSuppressedRecommendations(payload, preferences) {
  const suppressed = new Set(
    Array.isArray(preferences.suppressedRecommendationIds)
      ? preferences.suppressedRecommendationIds
      : []
  );
  return {
    ...payload,
    recommendations: Array.isArray(payload.recommendations)
      ? payload.recommendations.filter((recommendation) => !suppressed.has(recommendation.id))
      : []
  };
}

function withoutRecommendationPrivateFields(payload) {
  return {
    ...payload,
    recommendations: Array.isArray(payload.recommendations)
      ? payload.recommendations.map(({ fullTextUrl: _fullTextUrl, ...recommendation }) => recommendation)
      : []
  };
}

function withConfiguredOpenAIModel(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  const provider = typeof body.provider === "string" ? body.provider : "openai";
  const hasModel = typeof body.model === "string" && body.model.trim().length > 0;
  return provider === "openai" && !hasModel
    ? { ...body, model: config.openaiModel }
    : body;
}

export function createDevCloudRequestHandler(customConfig = {}) {
  assertDevCloudDeploymentBoundary({ requestedEnvironment: customConfig.environment });
  const config = {
    ...defaultConfig,
    ...customConfig
  };
  const runtimeSummary = buildPublicRuntimeSummary(config, {
    pid: customConfig.runtimePid,
    startedAt: customConfig.runtimeStartedAt
  });
  const providers = {
    ...buildProviderRegistry(config),
    ...(customConfig.providers ?? {})
  };
  const streamingProviders = {
    ...buildStreamingProviderRegistry(config),
    ...(customConfig.streamingProviders ?? {})
  };
  const database = customConfig.database ?? createDatabase({
    databasePath: customConfig.databasePath
  });
  const externalKnowledgeRunRepository =
    customConfig.externalKnowledgeRunRepository ?? createExternalKnowledgeRunRepository(database);
  const externalPdfGrantRepository =
    customConfig.externalPdfGrantRepository ?? createExternalPdfGrantRepository(database, {
      grantLifetimeMs: customConfig.externalPdfGrantLifetimeMs,
      now: customConfig.now
    });
  const grobidParseCacheRepository =
    customConfig.grobidParseCacheRepository ?? createGrobidParseCacheRepository(database);
  const personalizationRepository =
    customConfig.personalizationRepository ?? createPersonalizationRepository(database);
  const workRepository =
    customConfig.workRepository ?? createWorkRepository(database);
  const conceptRepository =
    customConfig.conceptRepository ?? createConceptRepository(database);
  if (customConfig.seedDisciplineCatalog !== false && conceptRepository.countBySource("discipline_catalog") === 0) {
    const catalog = loadDisciplineCatalog();
    conceptRepository.seedDisciplineCatalog(catalog.items);
  }
  const tagRepository =
    customConfig.tagRepository ?? createTagRepository(database);
  const externalKnowledgeSearch =
    customConfig.searchExternalKnowledge ?? searchExternalKnowledge;
  setRecommendationCandidateRepository(
    customConfig.recommendationCandidateRepository ?? createRecommendationCandidateRepository(database)
  );
  setRecommendationFeedbackRepository(
    customConfig.recommendationFeedbackRepository ?? createRecommendationFeedbackRepository(database)
  );
  setRecommendationCacheRepository(
    customConfig.recommendationCacheRepository ?? createRecommendationCacheRepository(database, {
      now: customConfig.now
    })
  );
  const libraryStorageRepository =
    customConfig.libraryStorageRepository ?? createLibraryStorageRepository(database, {
      objectDirectory: customConfig.libraryStorageObjectDirectory,
      now: customConfig.now
  });
  libraryStorageRepository.purgeExpired?.();
  libraryStorageRepository.reconcileObjects?.();
  const literatureProjectionVerifier = createLiteratureProjectionVerifier(
    config,
    customConfig.literatureProjectionVerifier
  );
  const collectionRepository =
    customConfig.collectionRepository ?? createCollectionRepository(database, { now: customConfig.now });
  const organizationRepository =
    customConfig.organizationRepository ?? createOrganizationRepository(database, { now: customConfig.now });
  const accountRepository = createAccountRepository(database);
  const sessionRepository = createAuthSessionRepository(database);
  const mfaService = customConfig.mfaService ?? createMfaService(database, {
    masterKey: customConfig.mfaMasterKey,
    now: customConfig.now
  });
  const platformAdminRepository =
    customConfig.platformAdminRepository ?? createPlatformAdminRepository(database, {
      environment: customConfig.environment,
      now: customConfig.now
    });
  const storedModelPolicy = platformAdminRepository.loadModelPolicy?.();
  if (storedModelPolicy) {
    Object.assign(config, storedModelPolicy);
  }
  const authService = customConfig.authService ?? createAuthService({
    accountRepository,
    mfaService,
    sessionDurationMs: config.accountSessionDurationMs,
    sessionRepository
  });
  const authRateLimiter = createRateLimiter(config.authRateLimit);
  const agentArtifactRepository =
    customConfig.agentArtifactRepository ?? createAgentArtifactRepository(database);
  const mineruExtractionRepository =
    customConfig.mineruExtractionRepository ?? createMineruExtractionRepository({
      cacheDirectory: customConfig.mineruExtractionCacheDirectory
    });
  const mineruExtractionsInFlight = new Map();
  const extractMineruPdf = customConfig.extractPdfWithMineru ?? extractPdfWithMineru;
  const configuredExternalPdfConcurrency = Number(customConfig.maximumConcurrentExternalPdfFetches);
  const maximumConcurrentExternalPdfFetches = Math.max(
    1,
    Math.min(8, Number.isFinite(configuredExternalPdfConcurrency) ? Math.floor(configuredExternalPdfConcurrency) : 4)
  );
  let activeExternalPdfFetches = 0;

  function withExternalPdfGrants(ownerKey, payload) {
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    return {
      ...payload,
      sources: sources.map(({ fullTextGrantId: _priorGrant, ...source }) => {
        if (source.openAccessAvailable !== true || typeof source.fullTextUrl !== "string") {
          return source;
        }
        try {
          const grant = externalPdfGrantRepository.issue(ownerKey, {
            sourceId: source.id,
            sourceUrl: source.fullTextUrl
          });
          return { ...source, fullTextGrantId: grant.grantId };
        } catch {
          return { ...source, openAccessAvailable: false };
        }
      })
    };
  }

  const handleRequest = async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    request.liteasyAllowedOrigins = new Set(
      [
        config.desktopOrigin,
        ...(Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [])
      ].filter((origin) => typeof origin === "string" && origin.length > 0)
    );

    if (method === "OPTIONS") {
      writeCorsPreflight(request, response);
      return;
    }

    if (method === "GET" && url.pathname === "/healthz") {
      writeJson(request, response, 200, {
        ok: true,
        runtime: runtimeSummary
      });
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      writeJson(request, response, 200, {
        name: "LiteasyClaw dev cloud",
        endpoints: availableEndpoints,
        publicOrigin: getPublicOrigin(request, config)
      });
      return;
    }

    if (method === "GET" && url.pathname === "/v1/agent-artifacts") {
      const session = authorizeAccountScopedBody(request, response, {}, authService);
      if (!session) return;
      writeJson(request, response, 200, {
        artifacts: agentArtifactRepository.list(session.userId)
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/agent-artifacts") {
      const body = await readJsonOrWriteError(
        request,
        response,
        maximumAgentArtifactBodyBytes
      );
      if (body === null) {
        return;
      }
      const session = authorizeAccountScopedBody(request, response, body, authService);
      if (!session) return;
      try {
        delete body.sessionId;
        writeJson(request, response, 201, agentArtifactRepository.save(session.userId, body));
      } catch (error) {
        writeJson(request, response, 400, {
          error: error instanceof Error ? error.message : "invalid_agent_artifact",
          message: "Agent 产物格式无效，未保存。"
        });
      }
      return;
    }

    if (method === "PATCH" && url.pathname.startsWith("/v1/agent-artifacts/")) {
      const artifactId = url.pathname.slice("/v1/agent-artifacts/".length);
      const body = await readJsonOrWriteError(
        request,
        response,
        maximumAgentArtifactBodyBytes
      );
      if (body === null) {
        return;
      }
      const session = authorizeAccountScopedBody(request, response, body, authService);
      if (!session) return;
      try {
        const renamed = agentArtifactRepository.rename(session.userId, artifactId, body.title);
        if (!renamed) {
          writeJson(request, response, 404, {
            error: "agent_artifact_not_found",
            message: "找不到要重命名的 Agent 产物。"
          });
          return;
        }
        writeJson(request, response, 200, renamed);
      } catch (error) {
        writeJson(request, response, 400, {
          error: error instanceof Error ? error.message : "invalid_agent_artifact"
        });
      }
      return;
    }

    if (method === "DELETE" && url.pathname.startsWith("/v1/agent-artifacts/")) {
      const artifactId = url.pathname.slice("/v1/agent-artifacts/".length);
      const session = authorizeAccountScopedBody(request, response, {}, authService);
      if (!session) return;
      try {
        const deleted = agentArtifactRepository.remove(session.userId, artifactId);
        if (!deleted) {
          writeJson(request, response, 404, {
            error: "agent_artifact_not_found",
            message: "找不到要删除的 Agent 产物。"
          });
          return;
        }
        writeJson(request, response, 200, deleted);
      } catch (error) {
        writeJson(request, response, 400, {
          error: error instanceof Error ? error.message : "invalid_agent_artifact_id"
        });
      }
      return;
    }

    if (method === "GET" && (url.pathname === "/admin/" || url.pathname === "/admin")) {
      writeHtml(request, response, 200, buildAdminConsoleHtml());
      return;
    }

    if (method === "GET" && url.pathname === "/v1/model-policy") {
      try {
        const authorization = request.headers.authorization;
        const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length).trim()
          : "";
        authService.validateSession(token, "liteasy-desktop");
        writeJson(request, response, 200, buildPolicyPayload(request, config));
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 401, {
            error: "invalid_session",
            message: "登录会话无效或已过期。"
          });
        }
      }
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/model-policy") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository
      );
      if (!admin) return;
      writeJson(request, response, 200, buildPolicyPayload(request, config));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/model-policy") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      const reason = requireAdminReason(request, response, body);
      if (!reason) return;
      const payload = buildPolicyUpdatePayload(request, config, body, admin.ownerKey);
      platformAdminRepository.saveModelPolicy?.(payload.policy, admin.ownerKey);
      platformAdminRepository.recordAudit({
        action: "model_policy_updated",
        actorId: admin.ownerKey,
        metadata: { policyVersion: payload.policy?.policyVersion },
        reason,
        risk: "high",
        targetType: "model_policy"
      });
      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/governance-dashboard") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository
      );
      if (!admin) return;
      writeJson(request, response, 200, platformAdminRepository.dashboard());
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/session") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      writeJson(request, response, 200, {
        session: {
          audience: admin.session.audience,
          expiresAt: admin.session.expiresAt,
          name: admin.session.name,
          userId: admin.session.userId
        }
      });
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/retrieval-sources") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository
      );
      if (!admin) return;
      writeJson(request, response, 200, {
        sources: platformAdminRepository.listRetrievalSources()
      });
      return;
    }

    if (
      method === "POST" &&
      ["/v1/admin/retrieval-sources", "/v1/admin/retrieval-sources/remove"].includes(url.pathname)
    ) {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const reason = requireAdminReason(request, response, body);
      if (!reason) return;
      try {
        const result = url.pathname.endsWith("/remove")
          ? platformAdminRepository.removeRetrievalSource(body.sourceId, admin.ownerKey, reason)
          : platformAdminRepository.saveRetrievalSource({ ...body, reason }, admin.ownerKey);
        writeJson(request, response, url.pathname.endsWith("/remove") ? 200 : 201, result);
      } catch (error) {
        const statusCode = error instanceof PlatformAuthorizationError ? error.statusCode : 500;
        writeJson(request, response, statusCode, {
          error: error instanceof PlatformAuthorizationError
            ? error.code
            : "retrieval_source_update_failed",
          message: "检索源配置更新失败。"
        });
      }
      return;
    }

    if (
      (method === "GET" && url.pathname === "/v1/admin/forum/posts") ||
      (method === "POST" && url.pathname === "/v1/admin/forum/posts/moderate")
    ) {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const endpoint = typeof config.intuechoApiEndpoint === "string"
        ? config.intuechoApiEndpoint.replace(/\/$/, "")
        : "";
      if (!endpoint) {
        writeJson(request, response, 503, {
          error: "intuecho_admin_unavailable",
          message: "Intuecho 管理接口尚未配置。"
        });
        return;
      }
      const body = method === "POST" ? await readJsonOrWriteError(request, response) : null;
      if (method === "POST" && body === null) return;
      const reason = method === "POST" ? requireAdminReason(request, response, body) : null;
      if (method === "POST" && !reason) return;
      if (method === "POST" && (typeof body.postId !== "string" || !body.postId.trim())) {
        writeJson(request, response, 400, {
          error: "invalid_forum_post_id",
          message: "帖子标识无效。"
        });
        return;
      }
      const authorization = request.headers.authorization;
      const target = method === "GET"
        ? `${endpoint}/v1/admin/posts`
        : `${endpoint}/v1/admin/posts/${encodeURIComponent(body.postId.trim())}/moderate`;
      try {
        const forumResponse = await fetch(target, {
          method,
          headers: {
            Authorization: authorization,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {})
          },
          ...(method === "POST" ? {
            body: JSON.stringify({ action: body.action, reason })
          } : {}),
          signal: AbortSignal.timeout(5_000)
        });
        const payload = await forumResponse.json().catch(() => ({}));
        writeJson(request, response, forumResponse.status, payload);
      } catch {
        writeJson(request, response, 503, {
          error: "intuecho_admin_unavailable",
          message: "Intuecho 管理接口暂时不可用。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/generate") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      try {
        writeJson(request, response, 200, await generateAnswer(withConfiguredOpenAIModel(body, config), providers));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        const statusCode =
          typeof message === "string" && message.includes("未注册 provider") ? 400 : 502;

        writeJson(request, response, statusCode, {
          error: message
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/generate-stream") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      await writeNdjsonStream(
        request,
        response,
        generateAnswerStream(withConfiguredOpenAIModel(body, config), providers, streamingProviders)
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/audit") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      writeJson(request, response, 200, buildModelAuditPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/register") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      const rateLimitKey = getClientKey(request, "register");
      const rateLimit = authRateLimiter.consume(rateLimitKey);
      if (!rateLimit.allowed) {
        response.setHeader?.("Retry-After", String(rateLimit.retryAfterSeconds));
        writeJson(request, response, 429, {
          error: "too_many_auth_attempts",
          message: "尝试次数过多，请稍后再试。"
        });
        return;
      }

      try {
        const session = await authService.register({
          ...body,
          clientLabel: getClientLabel(request)
        });
        writeJson(request, response, 201, { session });
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 500, {
            error: "account_registration_failed",
            message: "账号注册失败，请稍后重试。"
          });
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/login") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      const rateLimitKey = getClientKey(request, "login");
      const rateLimit = authRateLimiter.consume(rateLimitKey);
      if (!rateLimit.allowed) {
        response.setHeader?.("Retry-After", String(rateLimit.retryAfterSeconds));
        writeJson(request, response, 429, {
          error: "too_many_auth_attempts",
          message: "登录尝试次数过多，请稍后再试。"
        });
        return;
      }

      try {
        const session = await authService.login({
          ...body,
          clientLabel: getClientLabel(request)
        });
        authRateLimiter.reset(rateLimitKey);
        writeJson(request, response, 200, { session });
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 500, {
            error: "account_login_failed",
            message: "账号登录失败，请稍后重试。"
          });
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/change-bootstrap-password") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const rateLimitKey = getClientKey(request, "bootstrap-password-change");
      const rateLimit = authRateLimiter.consume(rateLimitKey);
      if (!rateLimit.allowed) {
        response.setHeader?.("Retry-After", String(rateLimit.retryAfterSeconds));
        writeJson(request, response, 429, {
          error: "too_many_auth_attempts",
          message: "尝试次数过多，请稍后再试。"
        });
        return;
      }
      try {
        const result = await authService.changeBootstrapPassword(body);
        authRateLimiter.reset(rateLimitKey);
        writeJson(request, response, 200, result);
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 500, {
            error: "password_change_failed",
            message: "密码更换失败，请稍后重试。"
          });
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/session") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      try {
        writeJson(request, response, 200, {
          session: authService.validateSession(body.sessionId, body.audience ?? "liteasy-desktop")
        });
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 500, {
            error: "session_validation_failed",
            message: "会话校验失败，请稍后重试。"
          });
        }
      }
      return;
    }

    if (method === "GET" && url.pathname === "/v1/account/capabilities") {
      const authorization = request.headers.authorization;
      const sessionToken = typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : "";
      try {
        const session = authService.validateSession(sessionToken, "liteasy-desktop");
        writeJson(request, response, 200, {
          developerDiagnostics: platformAdminRepository.hasRole(
            `user:${session.userId}`,
            "developer_diagnostics"
          )
        });
      } catch (error) {
        if (!writeAuthError(request, response, error)) {
          writeJson(request, response, 401, {
            error: "invalid_session",
            message: "登录会话无效或已过期。"
          });
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/logout") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      authService.logout(body.sessionId);
      writeJson(request, response, 200, {
        loggedOut: true
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendations") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const personalizationPreferences =
        personalizationRepository.getRecommendationPreferences(body.sessionId);
      const requestedProfileResult = normalizeRecommendationResearchProfile(body.researchProfile);
      if (!requestedProfileResult.ok) {
        writeJson(request, response, 400, {
          error: requestedProfileResult.error,
          message: "研究画像格式无效或超过允许范围。"
        });
        return;
      }
      const personalizedBody = personalizedRecommendationBody(
        requestedProfileResult.value
          ? { ...body, researchProfile: requestedProfileResult.value }
          : body,
        personalizationPreferences
      );
      const profileResult = normalizeRecommendationResearchProfile(personalizedBody.researchProfile);
      if (!profileResult.ok) {
        writeJson(request, response, 400, {
          error: profileResult.error,
          message: "研究画像格式无效或超过允许范围。"
        });
        return;
      }
      const recommendationBody = profileResult.value
        ? { ...personalizedBody, researchProfile: profileResult.value }
        : personalizedBody;
      const selectedDocuments = Array.isArray(body.selectedDocuments)
        ? body.selectedDocuments
            .filter((document) => typeof document?.title === "string" && document.title.trim().length > 0)
            .slice(0, 3)
        : [];
      // tag-centric：以用户 top tag 作为 keyword 检索重心（即便无选中文献也可驱动推荐）。
      const topTags = (Array.isArray(personalizationPreferences.terms)
        ? personalizationPreferences.terms
        : [])
        .filter((term) => typeof term?.term === "string" && Number(term.weight) > 0)
        .sort((left, right) => Number(right.weight) - Number(left.weight))
        .slice(0, 3)
        .map((term) => term.term);
      if (selectedDocuments.length === 0 && topTags.length === 0) {
        writeJson(request, response, 200, { recommendations: [] });
        return;
      }
      const openAlexApiKey = configuredOpenAlexServiceKey(config, customConfig);
      const openAlexMailto = configuredOpenAlexMailto(config, customConfig);
      const expandedSourcesEnabled = customConfig.expandedSourcesEnabled !== false;
      const semanticScholarEnabled = expandedSourcesEnabled && customConfig.semanticScholarEnabled !== false;
      const openAireEnabled = expandedSourcesEnabled && customConfig.openAireEnabled !== false;
      const oapenEnabled = expandedSourcesEnabled && customConfig.oapenEnabled !== false;
      const doajEnabled = expandedSourcesEnabled && customConfig.doajEnabled !== false;
      const retrievalOptions = {
        allowCrossrefOnlyFallback: true,
        arxivEnabled: customConfig.arxivEnabled === true,
        arxivTimeoutMs: customConfig.arxivTimeoutMs,
        arxivTransport: customConfig.arxivTransport,
        crossrefEnabled: customConfig.crossrefEnabled !== false,
        crossrefTimeoutMs: customConfig.crossrefTimeoutMs,
        crossrefTransport: customConfig.crossrefTransport,
        openAlexApiKey,
        openAlexMailto,
        openAlexEnabled: Boolean(openAlexApiKey),
        openAlexTimeoutMs: customConfig.openAlexTimeoutMs,
        openAlexTransport: customConfig.openAlexTransport,
        openAireEnabled,
        openAireTimeoutMs: customConfig.openAireTimeoutMs,
        openAireTransport: customConfig.openAireTransport,
        oapenEnabled,
        oapenTimeoutMs: customConfig.oapenTimeoutMs,
        oapenTransport: customConfig.oapenTransport,
        doajEnabled,
        doajTimeoutMs: customConfig.doajTimeoutMs,
        doajTransport: customConfig.doajTransport,
        semanticScholarApiKey: customConfig.semanticScholarApiKey ?? config.semanticScholarApiKey,
        semanticScholarEnabled,
        semanticScholarTimeoutMs: customConfig.semanticScholarTimeoutMs,
        semanticScholarTransport: customConfig.semanticScholarTransport,
        rerank: false
      };
      try {
        const sourceGroups = await Promise.all(selectedDocuments.map(async (document) => {
          const result = await externalKnowledgeSearch({
            limit: 5,
            query: document.title,
            targetPaperTitle: document.title
          }, retrievalOptions);
          return {
            relatedDocumentTitle: document.title,
            semanticQuery: document.title,
            sources: [
              ...result.sources,
              ...listRecommendationCandidateSources(body.sessionId, document.title)
            ]
          };
        }));
        const profileQuery = profileResult.value
          ? [...profileResult.value.topics.slice(0, 2), ...profileResult.value.methods.slice(0, 1)]
              .join(" ")
              .slice(0, 240)
          : "";
        if (profileQuery) {
          const profileSources = await externalKnowledgeSearch({
            limit: 5,
            query: profileQuery,
            targetPaperTitle: profileQuery
          }, retrievalOptions);
          sourceGroups.push({
            relatedDocumentTitle: "研究画像",
            semanticQuery: profileQuery,
            sources: profileSources.sources
          });
        }
        // tag-driven：每个 top tag 一组检索，结果携带 surfacing tag 溯源。
        const tagGroups = await Promise.all(topTags.map(async (tag) => {
          const result = await externalKnowledgeSearch({
            limit: 5,
            query: tag,
            targetPaperTitle: tag
          }, retrievalOptions);
          return {
            relatedDocumentTitle: `tag:${tag}`,
            semanticQuery: tag,
            sources: result.sources,
            surfacingTag: tag
          };
        }));
        sourceGroups.push(...tagGroups);
        const semanticRetrieval = await applyRecommendationEmbeddingScores(sourceGroups, {
          apiKey: config.recommendationEmbeddingApiKey,
          baseUrl: config.recommendationEmbeddingBaseUrl,
          model: config.recommendationEmbeddingModel,
          timeoutMs: customConfig.recommendationEmbeddingTimeoutMs,
          transport: customConfig.recommendationEmbeddingTransport
        });
        const payload = buildLiveRecommendationPayload(
          recommendationBody,
          semanticRetrieval.sourceGroups,
          new Date(),
          getRecommendationFeedback(body.sessionId)
        );
        const externalReranker = await applyRecommendationExternalReranker(
          payload.recommendations,
          {
            apiKey: config.recommendationRerankerApiKey,
            baseUrl: config.recommendationRerankerBaseUrl,
            model: config.recommendationRerankerModel,
            query: [
              ...selectedDocuments.map((document) => document.title),
              profileQuery
            ].filter(Boolean).join("\n"),
            timeoutMs: customConfig.recommendationRerankerTimeoutMs,
            transport: customConfig.recommendationRerankerTransport
          }
        );
        upsertRecommendationCandidates(
          body.sessionId,
          externalReranker.recommendations.filter((candidate) => candidate.sourceKind === "live")
        );
        writeJson(request, response, 200, withoutRecommendationPrivateFields(withoutSuppressedRecommendations({
          ...payload,
          externalReranker: externalReranker.audit,
          recommendations: externalReranker.recommendations,
          semanticRetrieval: semanticRetrieval.audit
        }, personalizationPreferences)));
      } catch (error) {
        if (error instanceof ExternalKnowledgeError) {
          writeJson(request, response, error.statusCode, { error: error.code, message: error.message });
          return;
        }
        writeJson(request, response, 502, {
          error: "recommendation_retrieval_failed",
          message: "联网推荐来源当前不可用。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendations/pdf-grant") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      if (Object.keys(body).some((key) => !["candidateId", "sessionId"].includes(key)) ||
        typeof body.candidateId !== "string" ||
        !/^[A-Za-z0-9._:/-]{1,300}$/.test(body.candidateId)) {
        writeJson(request, response, 400, {
          error: "recommendation_candidate_invalid",
          message: "推荐候选标识无效。"
        });
        return;
      }
      const candidate = loadRecommendationCandidate(body.sessionId, body.candidateId);
      if (!candidate) {
        writeJson(request, response, 404, {
          error: "recommendation_candidate_not_found",
          message: "推荐候选不存在或已过期。"
        });
        return;
      }
      if (candidate.openAccessAvailable !== true || typeof candidate.fullTextUrl !== "string") {
        writeJson(request, response, 404, {
          error: "recommendation_pdf_unavailable",
          message: "该推荐候选当前没有可验证的开放 PDF。"
        });
        return;
      }
      try {
        const grant = externalPdfGrantRepository.issue(body.sessionId, {
          sourceId: body.candidateId,
          sourceUrl: candidate.fullTextUrl
        });
        writeJson(request, response, 200, {
          fullTextGrantId: grant.grantId,
          fullTextUrl: grant.sourceUrl,
          sourceId: grant.sourceId
        });
      } catch {
        writeJson(request, response, 404, {
          error: "recommendation_pdf_unavailable",
          message: "该推荐候选当前没有可验证的开放 PDF。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendations/feedback") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const payload = buildRecommendationFeedbackPayload(body);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }
      updateRecommendationCandidateStatus(
        body.sessionId,
        body.candidate,
        payload.feedback.action
      );
      const invalidatedCacheEntries = clearRecommendationCacheForSession(body.sessionId);
      writeJson(request, response, 200, { ...payload, invalidatedCacheEntries });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/works/resolve") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const requestResult = buildWorkResolutionRequest(body);
      if (requestResult.error) {
        writeJson(request, response, 400, {
          error: requestResult.error,
          message: "论文身份解析请求格式无效。"
        });
        return;
      }
      try {
        const resolution = workRepository.resolveWork(
          requestResult.value.identities,
          requestResult.value.meta
        );
        const preferences = personalizationRepository.getRecommendationPreferences(body.sessionId);
        writeJson(
          request,
          response,
          201,
          buildWorkResolutionSnapshot(resolution, preferences.personalizationVersion)
        );
      } catch (error) {
        if (error instanceof WorkRepositoryError) {
          writeJson(request, response, 400, {
            error: error.code,
            message: "论文身份解析失败：缺少有效标识。"
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/research/parse-pdf") {
      if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/pdf")) {
        writeJson(request, response, 415, {
          error: "invalid_pdf_content_type",
          message: "结构解析只接受 application/pdf。"
        });
        return;
      }
      let pdfBytes;
      try {
        pdfBytes = await readBinaryBody(request, maximumPdfParseBodyBytes);
      } catch (error) {
        writeJson(request, response, error?.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400, {
          error: error?.code === "REQUEST_BODY_TOO_LARGE" ? "request_body_too_large" : "invalid_pdf",
          message: error?.code === "REQUEST_BODY_TOO_LARGE" ? "PDF 超过结构解析大小上限。" : "无法读取 PDF。"
        });
        return;
      }
      if (!isPdfBytes(pdfBytes)) {
        writeJson(request, response, 400, { error: "invalid_pdf", message: "上传内容不是有效的 PDF。" });
        return;
      }
      const contentFingerprint = fingerprintPdf(pdfBytes);
      const cached = grobidParseCacheRepository.get(contentFingerprint);
      if (cached?.parserVersion === grobidParserVersion) {
        writeJson(request, response, 200, {
          ...cached,
          parser: "grobid",
          reused: true
        });
        return;
      }
      try {
        /*
        const resolution = workRepository.resolveWork(
          requestResult.value.identities,
          requestResult.value.meta
        );
        const preferences = personalizationRepository.getRecommendationPreferences(body.sessionId);
        writeJson(
          request,
          response,
          201,
          buildWorkResolutionSnapshot(resolution, preferences.personalizationVersion)
        );
      } catch (error) {
        if (error instanceof WorkRepositoryError) {
          writeJson(request, response, 400, {
            error: error.code,
            message: "论文身份解析失败：缺少有效标识。"
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "GET" && url.pathname === "/v1/concepts") {
      const query = buildConceptListQuery(url.searchParams);
      writeJson(
        request,
        response,
        200,
        buildConceptListPayload(conceptRepository.list(query))
      );
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/v1/concepts/")) {
      const code = normalizeConceptCode(decodeURIComponent(url.pathname.slice("/v1/concepts/".length)));
      if (!code) {
        writeJson(request, response, 400, {
          error: "invalid_concept_code",
          message: "概念编码格式无效。"
        });
        return;
      }
      const concept = conceptRepository.getByCode(code);
      const payload = buildConceptPayload(concept);
      writeJson(
        request,
        response,
        "error" in payload ? 404 : 200,
        payload
      );
      return;
    }

    if (method === "POST" && url.pathname.startsWith("/v1/works/") && url.pathname.endsWith("/index")) {
      const workId = decodeURIComponent(url.pathname.slice("/v1/works/".length, -"/index".length));
      if (!/^[A-Za-z0-9._-]+$/.test(workId)) {
        writeJson(request, response, 400, {
          error: "invalid_work_id",
          message: "论文标识格式无效。"
        });
        return;
      }
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      const requestResult = buildWorkIndexRequest(body);
      if (requestResult.error) {
        writeJson(request, response, 400, {
          error: requestResult.error,
          message: "缺少可用于打标的论文标题或摘要。"
        });
        return;
      }
      try {
        const result = tagRepository.indexWork(workId, requestResult.value);
        writeJson(request, response, 200, buildWorkIndexSnapshot(result));
      } catch (error) {
        if (error instanceof TagRepositoryError) {
          writeJson(request, response, 400, {
            error: error.code,
            message: "论文打标失败：标识无效。"
          });
          return;
        }
        throw error;
        */
        const tei = await parsePdfWithGrobid(pdfBytes, {
          endpoint: config.grobidEndpoint,
          timeoutMs: customConfig.grobidTimeoutMs,
          transport: customConfig.grobidTransport
        });
        const stored = grobidParseCacheRepository.put({
          contentFingerprint,
          parserVersion: grobidParserVersion,
          tei
        });
        writeJson(request, response, 200, {
          ...stored,
          parser: "grobid",
          reused: false
        });
      } catch (error) {
        writeJson(request, response, error instanceof GrobidParseError ? error.statusCode : 502, {
          error: error instanceof GrobidParseError ? error.code : "grobid_unavailable",
          message: error instanceof Error ? error.message : "结构解析服务不可用，已保留本地解析结果。"
        });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/v1/concepts") {
      const query = buildConceptListQuery(url.searchParams);
      writeJson(request, response, 200, buildConceptListPayload(conceptRepository.list(query)));
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/v1/concepts/")) {
      const code = normalizeConceptCode(decodeURIComponent(url.pathname.slice("/v1/concepts/".length)));
      if (!code) {
        writeJson(request, response, 400, { error: "invalid_concept_code", message: "概念编码格式无效。" });
        return;
      }
      const payload = buildConceptPayload(conceptRepository.getByCode(code));
      writeJson(request, response, "error" in payload ? 404 : 200, payload);
      return;
    }

    if (method === "POST" && url.pathname.startsWith("/v1/works/") && url.pathname.endsWith("/index")) {
      const workId = decodeURIComponent(url.pathname.slice("/v1/works/".length, -"/index".length));
      if (!/^[A-Za-z0-9._-]+$/.test(workId)) {
        writeJson(request, response, 400, { error: "invalid_work_id", message: "论文标识格式无效。" });
        return;
      }
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const requestResult = buildWorkIndexRequest(body);
      if (requestResult.error) {
        writeJson(request, response, 400, {
          error: requestResult.error,
          message: "缺少可用于打标的论文标题或摘要。"
        });
        return;
      }
      try {
        const result = tagRepository.indexWork(workId, requestResult.value);
        writeJson(request, response, 200, buildWorkIndexSnapshot(result));
      } catch (error) {
        if (error instanceof TagRepositoryError) {
          writeJson(request, response, 400, { error: error.code, message: "论文打标失败：标识无效。" });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "GET" && url.pathname === "/v1/tags") {
      const query = buildTagListQuery(url.searchParams);
      writeJson(request, response, 200, { tags: tagRepository.listTags(query) });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/v1/tags/")) {
      const remainder = decodeURIComponent(url.pathname.slice("/v1/tags/".length));
      if (remainder.endsWith("/works")) {
        const rawId = remainder.slice(0, -"/works".length);
        const id = normalizeTagId(rawId);
        if (!id) {
          writeJson(request, response, 400, { error: "invalid_tag_id" });
          return;
        }
        writeJson(
          request,
          response,
          200,
          buildWorksForTagPayload(tagRepository.listWorksForTag(id))
        );
        return;
      }
      const id = normalizeTagId(remainder);
      if (!id) {
        writeJson(request, response, 400, { error: "invalid_tag_id" });
        return;
      }
      const payload = buildTagPayload(tagRepository.getById(id));
      writeJson(request, response, "error" in payload ? 404 : 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/research/external-knowledge") {
      const openAlexApiKey = configuredOpenAlexServiceKey(config, customConfig);
      const openAlexMailto = configuredOpenAlexMailto(config, customConfig);
      const crossrefEnabled = customConfig.crossrefEnabled !== false;
      const configuredArxivEnabled = customConfig.arxivEnabled === true;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const arxivEnabled = configuredArxivEnabled && body.includeArxiv !== false;
      const expandedSourcesEnabled = body.includeExpandedSources === true && customConfig.expandedSourcesEnabled !== false;
      const semanticScholarEnabled = expandedSourcesEnabled && customConfig.semanticScholarEnabled !== false;
      const openAireEnabled = expandedSourcesEnabled && customConfig.openAireEnabled !== false;
      const oapenEnabled = expandedSourcesEnabled && customConfig.oapenEnabled !== false;
      const doajEnabled = expandedSourcesEnabled && customConfig.doajEnabled !== false;
      const openAlexEnabled = body.includeOpenAlex !== false && Boolean(openAlexApiKey);
      if (!openAlexEnabled && !crossrefEnabled && !configuredArxivEnabled && !semanticScholarEnabled && !openAireEnabled && !oapenEnabled && !doajEnabled) {
        writeJson(request, response, 503, {
          error: "external_knowledge_unavailable",
          message: "统一联网服务当前没有可用的文献来源，请稍后重试。"
        });
        return;
      }
      // The anchor-reference mode is server configuration rather than something the client
      // asks for, but it changes the result, so the cache has to key on it. Without this a
      // stored answer from a previous mode would be replayed under the new one.
      const anchorAwareRequest = Object.prototype.hasOwnProperty.call(body, "anchorReferences");
      const anchorReferenceMode = anchorAwareRequest
        ? (customConfig.anchorReferenceMode ?? config.anchorReferenceMode ?? "exclusive")
        : "off";
      const cacheKeyInput = { ...body, anchorReferenceMode };
      let retrievalRun;
      try {
        if (typeof body.artifactId === "string") {
          const resumed = externalKnowledgeRunRepository.begin(cacheKeyInput);
          if (resumed.payload) {
            writeJson(request, response, 200, withExternalPdfGrants(body.sessionId, {
              ...resumed.payload,
              retrieval: resumed.run
            }));
            return;
          }
          retrievalRun = resumed.run;
        }
        const payload = await searchExternalKnowledge(body, {
          anchorReferenceMode,
          allowCrossrefOnlyFallback: (
            crossrefEnabled || arxivEnabled || semanticScholarEnabled || openAireEnabled || oapenEnabled
              || doajEnabled
          ),
          arxivEnabled,
          arxivTimeoutMs: customConfig.arxivTimeoutMs,
          arxivTransport: customConfig.arxivTransport,
          crossrefEnabled,
          crossrefTimeoutMs: customConfig.crossrefTimeoutMs,
          crossrefTransport: customConfig.crossrefTransport,
          openAlexApiKey,
          openAlexMailto,
          openAlexEnabled,
          openAlexTimeoutMs: customConfig.openAlexTimeoutMs,
          openAlexTransport: customConfig.openAlexTransport,
          openAireEnabled,
          openAireTimeoutMs: customConfig.openAireTimeoutMs,
          openAireTransport: customConfig.openAireTransport,
          oapenEnabled,
          oapenTimeoutMs: customConfig.oapenTimeoutMs,
          oapenTransport: customConfig.oapenTransport,
          doajEnabled,
          doajTimeoutMs: customConfig.doajTimeoutMs,
          doajTransport: customConfig.doajTransport,
          semanticScholarApiKey: customConfig.semanticScholarApiKey ?? config.semanticScholarApiKey,
          semanticScholarEnabled,
          semanticScholarTimeoutMs: customConfig.semanticScholarTimeoutMs,
          semanticScholarTransport: customConfig.semanticScholarTransport,
          rerank: body.deferRerank !== true
        });
        const completedRun = typeof body.artifactId === "string"
          ? externalKnowledgeRunRepository.complete(cacheKeyInput, payload)
          : undefined;
        writeJson(request, response, 200, withExternalPdfGrants(
          body.sessionId,
          completedRun ? { ...payload, retrieval: completedRun } : payload
        ));
      } catch (error) {
        const statusCode = error instanceof ExternalKnowledgeError
          ? error.statusCode
          : error instanceof Error && error.message === "invalid_external_knowledge_artifact_id"
            ? 400
            : 502;
        const failedRun = typeof body.artifactId === "string" && retrievalRun
          ? externalKnowledgeRunRepository.fail(cacheKeyInput, error)
          : undefined;
        writeJson(request, response, statusCode, {
          error: error instanceof ExternalKnowledgeError
            ? error.code
            : error instanceof Error && error.message === "invalid_external_knowledge_artifact_id"
              ? "invalid_external_knowledge_artifact_id"
              : "external_knowledge_unavailable",
          message: error instanceof Error ? error.message : "外部知识检索不可用。",
          ...(failedRun ? { retrieval: failedRun } : {})
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/research/paper-relations") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      try {
        const payload = await buildPaperRelationPayload(body, {
          fetchGraphRecords: customConfig.fetchPaperGraphRecords,
          openAlexApiKey: configuredOpenAlexServiceKey(config, customConfig),
          openAlexEnabled: customConfig.openAlexEnabled !== false,
          openAlexMailto: configuredOpenAlexMailto(config, customConfig),
          openAlexTimeoutMs: customConfig.openAlexTimeoutMs,
          openAlexTransport: customConfig.openAlexTransport,
          semanticScholarApiKey: customConfig.semanticScholarApiKey ?? config.semanticScholarApiKey,
          semanticScholarEnabled: customConfig.semanticScholarEnabled === true,
          semanticScholarTimeoutMs: customConfig.semanticScholarTimeoutMs,
          semanticScholarTransport: customConfig.semanticScholarTransport
        });
        writeJson(request, response, 200, payload);
      } catch (error) {
        if (error instanceof PaperRelationValidationError) {
          writeJson(request, response, error.statusCode, {
            error: error.code,
            message: error.message
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/research/external-pdf") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      if (Object.keys(body).some((key) => !["grantId", "sessionId", "sourceId"].includes(key)) ||
        typeof body.grantId !== "string" || !/^pdfgrant_[A-Za-z0-9-]{1,100}$/.test(body.grantId) ||
        typeof body.sourceId !== "string" || !/^[^\s\u0000-\u001f\u007f]{1,300}$/.test(body.sourceId)) {
        writeJson(request, response, 400, {
          error: "invalid_external_pdf_request",
          message: "外部 PDF 请求缺少有效的来源 ID 或短期授权。"
        });
        return;
      }
      let grant;
      try {
        grant = externalPdfGrantRepository.load(body.sessionId, body);
      } catch {
        grant = null;
      }
      if (!grant) {
        writeJson(request, response, 404, {
          error: "external_pdf_grant_not_found",
          message: "外部 PDF 授权已失效，请重新检索后再试。"
        });
        return;
      }
      if (activeExternalPdfFetches >= maximumConcurrentExternalPdfFetches) {
        writeJson(request, response, 429, {
          error: "external_pdf_capacity_reached",
          message: "外部 PDF 核验任务已达到并发上限，请稍后重试。"
        });
        return;
      }
      activeExternalPdfFetches += 1;
      try {
        const pdf = await fetchSecurePdf(grant.sourceUrl, {
          maximumBytes: customConfig.externalPdfMaximumBytes,
          maximumRedirects: customConfig.externalPdfMaximumRedirects,
          resolver: customConfig.externalPdfResolver,
          timeoutMs: customConfig.externalPdfTimeoutMs,
          transport: customConfig.externalPdfTransport
        });
        writeJson(request, response, 200, {
          byteLength: pdf.bytes.byteLength,
          bytesBase64: pdf.bytes.toString("base64"),
          contentHash: pdf.contentHash,
          contentType: pdf.contentType,
          finalUrl: pdf.finalUrl,
          sourceId: body.sourceId
        });
      } catch (error) {
        writeJson(request, response, error instanceof SecurePdfFetchError ? error.statusCode : 502, {
          error: error instanceof SecurePdfFetchError ? error.code : "external_pdf_unavailable",
          message: error instanceof Error ? error.message : "外部 PDF 当前不可用。"
        });
      } finally {
        activeExternalPdfFetches -= 1;
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/pdf/mineru-extract") {
      const body = await readJsonOrWriteError(request, response, maximumMineruRequestBytes);
      if (body === null) {
        return;
      }
      const filename = typeof body.filename === "string" ? body.filename.trim() : "";
      const bytesBase64 = typeof body.bytesBase64 === "string" ? body.bytesBase64.trim() : "";
      if (!filename || filename.length > 180 || !/\.pdf$/i.test(filename) || !bytesBase64 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(bytesBase64)) {
        writeJson(request, response, 400, {
          error: "invalid_mineru_pdf_request",
          message: "MinerU 解析需要有效的 PDF 文件名和 Base64 文件内容。"
        });
        return;
      }
      const bytes = Buffer.from(bytesBase64, "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > maximumMineruPdfBytes ||
        bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        writeJson(request, response, 413, {
          error: "invalid_mineru_pdf_content",
          message: "PDF 无效，或超过 24 MB 的本地解析上传上限。"
        });
        return;
      }
      try {
        const cacheKey = createMineruExtractionCacheKey(bytes);
        const cached = mineruExtractionRepository.get(cacheKey);
        if (cached) {
          writeJson(request, response, 200, { ...cached, cache: "hit" });
          return;
        }
        const existingExtraction = mineruExtractionsInFlight.get(cacheKey);
        if (existingExtraction) {
          const extracted = await existingExtraction;
          writeJson(request, response, 200, { ...extracted, cache: "hit" });
          return;
        }
        const extraction = extractMineruPdf({
          bytes,
          filename,
          modelConfig: {
            apiBaseUrl: customConfig.openaiApiBaseUrl ?? defaultConfig.openaiApiBaseUrl,
            apiKey: customConfig.openaiApiKey ?? defaultConfig.openaiApiKey,
            model: customConfig.openaiModel ?? defaultConfig.openaiModel,
            reasoningEffort: customConfig.openaiReasoningEffort ?? defaultConfig.openaiReasoningEffort
          },
          token: customConfig.mineruToken ?? defaultConfig.mineruToken
        }).then((extracted) => {
          mineruExtractionRepository.save(cacheKey, extracted);
          return extracted;
        });
        mineruExtractionsInFlight.set(cacheKey, extraction);
        try {
          const extracted = await extraction;
          writeJson(request, response, 200, { ...extracted, cache: "miss" });
        } finally {
          mineruExtractionsInFlight.delete(cacheKey);
        }
      } catch (error) {
        console.error(`MinerU extraction failed (${request.liteasyTraceId})`, error);
        writeJson(request, response, 502, {
          error: "mineru_extraction_failed",
          message: "PDF 解析服务暂时不可用，请稍后重试。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/profile/get") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      writeJson(request, response, 200, personalizationRepository.get(body.sessionId));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/profile/save") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      try {
        writeJson(request, response, 200, personalizationRepository.save(body.sessionId, body.profile));
      } catch (error) {
        if (error instanceof PersonalizationValidationError) {
          writeJson(request, response, 400, {
            error: "invalid_academic_profile",
            message: error.message
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/profile/clear") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const snapshot = personalizationRepository.clear(body.sessionId);
      writeJson(request, response, 200, snapshot);
      return;
    }

    if (
      method === "POST" &&
      (url.pathname === "/v1/personalization/settings" ||
        url.pathname === "/v1/personalization/settings/update")
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      try {
        const snapshot = url.pathname.endsWith("/update")
          ? personalizationRepository.setEnabled(body.sessionId, body.enabled)
          : personalizationRepository.get(body.sessionId);
        writeJson(request, response, 200, snapshot);
      } catch (error) {
        if (error instanceof PersonalizationValidationError) {
          writeJson(request, response, 400, {
            error: "invalid_personalization_setting",
            message: error.message
          });
        } else {
          throw error;
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/personalization/signal") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      try {
        const snapshot = personalizationRepository.recordSignal(body.sessionId, body.signal);
        clearRecommendationCacheForSession(body.sessionId);
        writeJson(request, response, 200, snapshot);
      } catch (error) {
        if (error instanceof PersonalizationValidationError) {
          writeJson(request, response, 400, {
            error: "invalid_personalization_signal",
            message: error.message
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendation-cache/get") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      const payload = buildRecommendationCacheGetPayload(body);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }

      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendation-cache/put") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      const payload = buildRecommendationCachePutPayload(body);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }

      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendation-cache/clear") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      const payload = buildRecommendationCacheClearPayload(body);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }

      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/collection/list") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      writeJson(request, response, 200, buildCollectionListPayload(body, collectionRepository));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/collection/items") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      const payload = buildCollectionSavePayload(body, collectionRepository);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }

      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/documents/metadata-sync") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      writeJson(request, response, 200, {
        result: personalizationRepository.syncLocalManifest(body.sessionId, body.documents)
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/list") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      writeJson(request, response, 200, buildOrganizationListPayload(body, organizationRepository));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/create") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationCreatePayload(body, organizationRepository)
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/join") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationJoinPayload(body, organizationRepository)
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/invite") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationInvitePayload(body, organizationRepository)
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/leave") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationLeavePayload(body, organizationRepository)
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    const organizationMemberMutationPayloads = new Map([
      ["/v1/org/members/role", buildOrganizationMemberRolePayload],
      ["/v1/org/members/status", buildOrganizationMemberStatusPayload],
      ["/v1/org/owner/transfer", buildOrganizationOwnershipTransferPayload]
    ]);
    if (method === "POST" && organizationMemberMutationPayloads.has(url.pathname)) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      if (!authorizeAccountScopedBody(request, response, body, authService)) return;
      try {
        writeJson(
          request,
          response,
          200,
          organizationMemberMutationPayloads.get(url.pathname)(body, organizationRepository)
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/summary") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationSummaryPayload(
            body,
            organizationRepository,
            libraryStorageRepository
          )
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/shared-library/manifest") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      body.scopeId = body.organizationId;
      body.scopeType = "organization";
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationSharedLibraryManifestPayload(
            body,
            organizationRepository,
            libraryStorageRepository
          )
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (
      method === "POST" &&
      (url.pathname === "/v1/org/storage-policy" ||
        url.pathname === "/v1/org/storage-policy/update")
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      try {
        const payload = url.pathname.endsWith("/update")
          ? buildOrganizationStoragePolicyUpdatePayload(body, organizationRepository)
          : buildOrganizationStoragePolicyPayload(body, organizationRepository);
        writeJson(request, response, 200, payload);
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    if (
      method === "POST" &&
      [
        "/v1/org/annotations/list",
        "/v1/org/annotations/create",
        "/v1/org/annotations/update",
        "/v1/org/annotations/delete"
      ].includes(url.pathname)
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      body.scopeId = body.organizationId;
      body.scopeType = "organization";
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        if (url.pathname.endsWith("/list")) {
          writeJson(request, response, 200, {
            annotations: libraryStorageRepository.listTeamAnnotations(
              scope.scopeId,
              body.documentId
            )
          });
          return;
        }
        const operation = url.pathname.endsWith("/create")
          ? "create_team_annotation"
          : url.pathname.endsWith("/update")
            ? "update_team_annotation"
            : "delete_team_annotation";
        const result = libraryStorageRepository.runIdempotent(
          scope.actorId,
          libraryMutationKey(request, body),
          operation,
          () => url.pathname.endsWith("/create")
            ? libraryStorageRepository.createTeamAnnotation({
                body: body.body,
                documentId: body.documentId,
                organizationId: scope.scopeId,
                uploadedBy: scope.actorId
              })
            : url.pathname.endsWith("/update")
              ? libraryStorageRepository.updateTeamAnnotation({
                  actorId: scope.actorId,
                  annotationId: body.annotationId,
                  body: body.body,
                  expectedRevision: body.expectedRevision,
                  organizationId: scope.scopeId
                })
              : libraryStorageRepository.deleteTeamAnnotation({
                  actorId: scope.actorId,
                  annotationId: body.annotationId,
                  canModerate: canManageOrganizationLibrary(scope),
                  expectedRevision: body.expectedRevision,
                  organizationId: scope.scopeId
                })
        );
        writeJson(request, response, 200, { ...result.value, replayed: result.replayed });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/tree") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      try {
        libraryStorageRepository.purgeExpired();
        writeJson(request, response, 200, {
          quota: libraryStorageRepository.getQuota(scope.scopeType, scope.scopeId),
          serverNow: new Date().toISOString(),
          tree: libraryStorageRepository.getTree(
            scope.scopeType,
            scope.scopeId,
            body.status
          )
        });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/entries/metadata") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (
        scope.scopeType === "organization" &&
        !organizationRepository.canUpload(scope.scopeId, scope.actorId)
      ) {
        writeJson(request, response, 403, { error: "organization_upload_forbidden" });
        return;
      }
      try {
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "create_metadata_entry",
          () => ({
            entry: libraryStorageRepository.createMetadataEntry({
              createdBy: scope.actorId,
              doi: body.doi,
              expectedRevision: body.expectedRevision,
              externalUrl: body.externalUrl,
              folderId: body.folderId,
              metadata: body.metadata,
              scopeId: scope.scopeId,
              scopeType: scope.scopeType,
              sourceId: body.sourceId,
              title: body.title
            })
          })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/entries/copy") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null || !authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }
      const actorId = body.sessionId;
      const resolveScope = (value) => {
        const scopeType = value?.scopeType === "organization" ? "organization" : "user";
        const scopeId = scopeType === "user"
          ? actorId
          : typeof value?.scopeId === "string"
            ? value.scopeId.trim()
            : "";
        if (scopeType === "user") return { actorId, role: "owner", scopeId, scopeType };
        const role = organizationRepository.getMemberRole(scopeId, actorId);
        if (!role) throw new OrganizationRepositoryError("organization_membership_required", 403);
        return {
          actorId,
          recordLibraryAudit: (operationKind, metadata) => organizationRepository.recordLibraryAudit(
            scopeId,
            actorId,
            operationKind,
            metadata
          ),
          role,
          scopeId,
          scopeType
        };
      };
      try {
        const source = resolveScope(body.source);
        const target = resolveScope(body.target);
        if (
          source.scopeType === "organization" &&
          !organizationRepository.canExport(source.scopeId, actorId)
        ) {
          throw new OrganizationRepositoryError("organization_export_forbidden", 403);
        }
        if (
          target.scopeType === "organization" &&
          !organizationRepository.canUpload(target.scopeId, actorId)
        ) {
          throw new OrganizationRepositoryError("organization_upload_forbidden", 403);
        }
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          target,
          body,
          "copy_library_entry",
          () => ({
            entry: libraryStorageRepository.copyEntry(
              body.documentId,
              source,
              target,
              {
                createdBy: actorId,
                expectedRevision: body.expectedRevision,
                folderId: body.target?.folderId
              }
            )
          })
        ));
      } catch (error) {
        if (error instanceof OrganizationRepositoryError) {
          writeOrganizationError(request, response, error);
        } else {
          writeLibraryStorageError(request, response, error);
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/update") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        const changes = {};
        if (Object.prototype.hasOwnProperty.call(body, "fileName")) changes.fileName = body.fileName;
        if (Object.prototype.hasOwnProperty.call(body, "folderId")) changes.folderId = body.folderId;
        if (Object.prototype.hasOwnProperty.call(body, "title")) changes.title = body.title;
        if (Object.prototype.hasOwnProperty.call(body, "literature")) {
          changes.literature = await verifyLiteratureProjection(literatureProjectionVerifier, body.literature);
        }
        changes.expectedRevision = body.expectedRevision;
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "update_library_entry",
          () => ({
            document: libraryStorageRepository.updateEntry(body.documentId, scope, changes)
          })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/upload") {
      const authBody = {
        expectedRevision: request.headers["x-liteasy-expected-revision"],
        idempotencyKey: request.headers["x-idempotency-key"],
        scopeId: request.headers["x-liteasy-scope-id"],
        scopeType: request.headers["x-liteasy-scope-type"],
        sessionId: request.headers["x-liteasy-session-id"]
      };
      const scope = authorizeLibraryScope(request, response, authBody, authService, organizationRepository);
      if (!scope) return;
      if (
        scope.scopeType === "organization" &&
        !organizationRepository.canUpload(scope.scopeId, scope.actorId)
      ) {
        writeJson(request, response, 403, { error: "organization_upload_forbidden" });
        return;
      }
      const fileName = requirePdfUploadHeaders(request, response);
      if (!fileName) return;
      let staged;
      try {
        staged = await stageBinaryBody(request, maximumLibraryPdfBytes, libraryStorageRepository);
      } catch (error) {
        writeJson(request, response, error?.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 500, {
          error: error?.code === "REQUEST_BODY_TOO_LARGE"
            ? "request_body_too_large"
            : "library_upload_staging_failed"
        });
        return;
      }
      try {
        await validateLibraryPdfSecurity(staged, customConfig);
        const payload = executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          authBody,
          "upload_library_document",
          () => libraryStorageRepository.uploadStagedDocument({
            byteLength: staged.byteLength,
            contentHash: staged.contentHash,
            duplicateAction: request.headers["x-liteasy-duplicate-action"],
            expectedRevision: authBody.expectedRevision,
            fileName,
            folderId: request.headers["x-liteasy-folder-id"],
            scopeId: scope.scopeId,
            scopeType: scope.scopeType,
            stagedPath: staged.stagedPath,
            uploadedBy: scope.actorId
          })
        );
        writeJson(request, response, 200, payload);
      } catch (error) {
        if (["invalid_pdf", "unsafe_pdf_content", "pdf_security_scanner_unavailable"].includes(error?.code)) {
          writeJson(request, response, error.code === "pdf_security_scanner_unavailable" ? 503 : 400, {
            error: error.code,
            message: error.code === "pdf_security_scanner_unavailable"
              ? "PDF 安全扫描服务暂时不可用。"
              : "PDF 未通过安全校验。"
          });
        } else {
          writeLibraryStorageError(request, response, error);
        }
      } finally {
        libraryStorageRepository.discardStagedUpload(staged.stagedPath);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/entries/attach-pdf") {
      const authBody = {
        documentId: request.headers["x-liteasy-document-id"],
        expectedRevision: request.headers["x-liteasy-expected-revision"],
        idempotencyKey: request.headers["x-idempotency-key"],
        scopeId: request.headers["x-liteasy-scope-id"],
        scopeType: request.headers["x-liteasy-scope-type"],
        sessionId: request.headers["x-liteasy-session-id"]
      };
      const scope = authorizeLibraryScope(
        request,
        response,
        authBody,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (
        scope.scopeType === "organization" &&
        !organizationRepository.canUpload(scope.scopeId, scope.actorId)
      ) {
        writeJson(request, response, 403, { error: "organization_upload_forbidden" });
        return;
      }
      const fileName = requirePdfUploadHeaders(request, response);
      if (!fileName) return;
      let staged;
      try {
        staged = await stageBinaryBody(request, maximumLibraryPdfBytes, libraryStorageRepository);
      } catch (error) {
        writeJson(request, response, error?.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 500, {
          error: error?.code === "REQUEST_BODY_TOO_LARGE"
            ? "request_body_too_large"
            : "library_upload_staging_failed"
        });
        return;
      }
      try {
        await validateLibraryPdfSecurity(staged, customConfig);
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          authBody,
          "attach_library_entry_pdf",
          () => ({
            entry: libraryStorageRepository.attachMetadataEntryStagedPdf({
              byteLength: staged.byteLength,
              contentHash: staged.contentHash,
              documentId: authBody.documentId,
              expectedRevision: authBody.expectedRevision,
              fileName,
              scopeId: scope.scopeId,
              scopeType: scope.scopeType,
              stagedPath: staged.stagedPath,
              uploadedBy: scope.actorId
            })
          })
        ));
      } catch (error) {
        if (["invalid_pdf", "unsafe_pdf_content", "pdf_security_scanner_unavailable"].includes(error?.code)) {
          writeJson(request, response, error.code === "pdf_security_scanner_unavailable" ? 503 : 400, {
            error: error.code,
            message: error.code === "pdf_security_scanner_unavailable"
              ? "PDF 安全扫描服务暂时不可用。"
              : "PDF 未通过安全校验。"
          });
        } else {
          writeLibraryStorageError(request, response, error);
        }
      } finally {
        libraryStorageRepository.discardStagedUpload(staged.stagedPath);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/list") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        libraryStorageRepository.purgeExpired();
        writeJson(request, response, 200, {
          documents: libraryStorageRepository.listDocuments(scope.scopeType, scope.scopeId, body.status),
          quota: libraryStorageRepository.getQuota(scope.scopeType, scope.scopeId),
          serverNow: new Date().toISOString()
        });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (
      method === "POST" &&
      (url.pathname === "/v1/library/documents/trash" || url.pathname === "/v1/library/documents/restore")
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          url.pathname.endsWith("/trash") ? "trash_library_entry" : "restore_library_entry",
          () => ({
            document: url.pathname.endsWith("/trash")
              ? libraryStorageRepository.trashEntry(body.documentId, scope, body)
              : libraryStorageRepository.restoreEntry(body.documentId, scope, body)
          })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/entries/purge") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "purge_library_entry",
          () => ({ result: libraryStorageRepository.purgeEntry(body.documentId, scope, body) })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/authorize") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        const document = libraryStorageRepository.authorizeDocument(body.documentId, scope);
        const serverNow = new Date();
        writeJson(request, response, 200, {
          document,
          expiresAt: new Date(serverNow.getTime() + 5 * 60 * 1000).toISOString(),
          revision: libraryStorageRepository.getRevision(scope.scopeType, scope.scopeId),
          serverNow: serverNow.toISOString()
        });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/download") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        const stored = libraryStorageRepository.locateDocument(body.documentId, scope);
        await writeLibraryPdf(request, response, stored);
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/export") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (
        scope.scopeType === "organization" &&
        !organizationRepository.canExport(scope.scopeId, scope.actorId)
      ) {
        writeJson(request, response, 403, {
          error: "organization_export_forbidden",
          message: "当前组织策略不允许将文献复制出组织库。"
        });
        return;
      }
      try {
        const stored = libraryStorageRepository.locateDocument(body.documentId, scope);
        await writeLibraryPdf(request, response, stored);
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/folders/create") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      if (
        scope.scopeType === "organization" &&
        !organizationRepository.canUpload(scope.scopeId, scope.actorId)
      ) {
        writeJson(request, response, 403, { error: "organization_folder_manage_forbidden" });
        return;
      }
      try {
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "create_library_folder",
          () => ({
            folder: libraryStorageRepository.createFolder({
              createdBy: scope.actorId,
              expectedRevision: body.expectedRevision,
              name: body.name,
              parentFolderId: body.parentFolderId,
              scopeId: scope.scopeId,
              scopeType: scope.scopeType
            })
          })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/folders/update") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_folder_manage_forbidden" });
        return;
      }
      try {
        const changes = {};
        if (Object.prototype.hasOwnProperty.call(body, "name")) changes.name = body.name;
        if (Object.prototype.hasOwnProperty.call(body, "parentFolderId")) {
          changes.parentFolderId = body.parentFolderId;
        }
        changes.expectedRevision = body.expectedRevision;
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "update_library_folder",
          () => ({ folder: libraryStorageRepository.updateFolder(body.folderId, scope, changes) })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (
      method === "POST" &&
      [
        "/v1/library/folders/trash",
        "/v1/library/folders/restore",
        "/v1/library/folders/purge"
      ].includes(url.pathname)
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        const operationKind = url.pathname.endsWith("/trash")
          ? "trash_library_folder"
          : url.pathname.endsWith("/restore")
            ? "restore_library_folder"
            : "purge_library_folder";
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          operationKind,
          () => ({
            folder: url.pathname.endsWith("/trash")
              ? libraryStorageRepository.trashFolder(body.folderId, scope, body)
              : url.pathname.endsWith("/restore")
                ? libraryStorageRepository.restoreFolder(body.folderId, scope, body)
                : libraryStorageRepository.purgeFolder(body.folderId, scope, body)
          })
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/trash/empty") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(
        request,
        response,
        body,
        authService,
        organizationRepository
      );
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        writeJson(request, response, 200, executeLibraryMutation(
          request,
          libraryStorageRepository,
          scope,
          body,
          "empty_library_trash",
          () => libraryStorageRepository.emptyTrash(
            scope.scopeType,
            scope.scopeId,
            body
          )
        ));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/quota") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        writeJson(request, response, 200, libraryStorageRepository.getQuota(scope.scopeType, scope.scopeId));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/storage-quota") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const reason = requireAdminReason(request, response, body);
      if (!reason) return;
      try {
        const quota = libraryStorageRepository.setQuota(
          body.scopeType,
          body.scopeId,
          body.limitBytes
        );
        platformAdminRepository.recordAudit({
          action: "storage_quota_updated",
          actorId: admin.ownerKey,
          metadata: { limitBytes: quota.limitBytes },
          reason,
          risk: "high",
          targetId: quota.scopeId,
          targetType: quota.scopeType
        });
        writeJson(
          request,
          response,
          200,
          quota
        );
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/accounts/status") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const reason = requireAdminReason(
        request,
        response,
        body,
        "修改账号状态必须填写原因。"
      );
      if (!reason) return;
      if (body.userId === admin.session.userId && body.status !== "active") {
        writeJson(request, response, 409, {
          error: "admin_self_disable_forbidden",
          message: "不能通过当前会话禁用或删除自己的管理员账号。"
        });
        return;
      }
      try {
        const ownerKey = `user:${body.userId}`;
        if (body.status === "deleted") {
          const ownedOrganization = database.prepare(`
            SELECT organization_id FROM organizations
            WHERE owner_key = ? AND status != 'deleted' LIMIT 1
          `).get(ownerKey);
          if (ownedOrganization) {
            writeJson(request, response, 409, {
              error: "account_owns_organization",
              message: "删除账号前必须转移或删除其负责的组织。"
            });
            return;
          }
        }
        let account = body.status === "deleted"
          ? accountRepository.findPublicById(body.userId)
          : accountRepository.setStatus(body.userId, body.status);
        if (!account) {
          writeJson(request, response, 404, {
            error: "account_not_found",
            message: "找不到目标账号。"
          });
          return;
        }
        let deletion;
        if (body.status === "deleted" && account.status !== "deleted") {
          account = accountRepository.setStatus(body.userId, "disabled");
          const startedAt = new Date().toISOString();
          database.prepare(`
            INSERT INTO account_deletion_jobs (
              user_id, status, requested_by, reason, created_at, updated_at
            ) VALUES (?, 'running', ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              status = 'running', requested_by = excluded.requested_by,
              reason = excluded.reason, error_code = NULL,
              updated_at = excluded.updated_at, completed_at = NULL
          `).run(account.id, admin.ownerKey, reason, startedAt, startedAt);
          try {
            deletion = {
              agentArtifacts: agentArtifactRepository.purgeOwner(account.id),
              library: libraryStorageRepository.purgeUserScope(ownerKey),
              personalization: personalizationRepository.deleteForAccount(ownerKey)
            };
            database.transaction(() => {
              database.prepare("DELETE FROM external_knowledge_runs WHERE owner_scope = ?").run(ownerKey);
              database.prepare("DELETE FROM external_pdf_grants WHERE owner_key = ?").run(ownerKey);
              database.prepare("DELETE FROM organization_active_selections WHERE owner_key = ?").run(ownerKey);
              database.prepare("DELETE FROM organization_invitations WHERE target_owner_key = ?").run(ownerKey);
              database.prepare("DELETE FROM organization_members WHERE owner_key = ?").run(ownerKey);
              database.prepare("DELETE FROM user_mfa_settings WHERE user_id = ?").run(account.id);
              database.prepare(`
                UPDATE platform_role_assignments SET revoked_at = COALESCE(revoked_at, ?)
                WHERE owner_key = ? AND revoked_at IS NULL
              `).run(new Date().toISOString(), ownerKey);
              database.prepare(`
                UPDATE platform_support_access_grants SET revoked_at = COALESCE(revoked_at, ?)
                WHERE grantee_user_id = ? AND revoked_at IS NULL
              `).run(new Date().toISOString(), account.id);
            })();
            account = accountRepository.setStatus(body.userId, "deleted");
            const completedAt = new Date().toISOString();
            database.prepare(`
              UPDATE account_deletion_jobs
              SET status = 'completed', result_json = ?, error_code = NULL,
                updated_at = ?, completed_at = ?
              WHERE user_id = ?
            `).run(JSON.stringify(deletion), completedAt, completedAt, account.id);
          } catch (error) {
            const errorCode = typeof error?.code === "string"
              ? error.code
              : "account_deletion_cleanup_failed";
            database.prepare(`
              UPDATE account_deletion_jobs
              SET status = 'failed', error_code = ?, updated_at = ?
              WHERE user_id = ?
            `).run(errorCode, new Date().toISOString(), account.id);
            platformAdminRepository.recordAudit({
              action: "account_deletion_failed",
              actorId: admin.ownerKey,
              metadata: { errorCode },
              reason,
              risk: "high",
              targetId: account.id,
              targetType: "user"
            });
            writeJson(request, response, 503, {
              error: "account_deletion_pending_retry",
              message: "账号已禁用，但数据清理未完成；请稍后重试删除。"
            });
            return;
          }
        }
        platformAdminRepository.recordAudit({
          action: "account_status_updated",
          actorId: admin.ownerKey,
          metadata: { deletion, status: account.status },
          reason,
          risk: "high",
          targetId: account.id,
          targetType: "user"
        });
        writeJson(request, response, 200, { account, ...(deletion ? { deletion } : {}) });
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "account_status_update_failed";
        writeJson(request, response, code === "invalid_account_status" ? 400 : 409, {
          error: code,
          message: "账号状态更新失败。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/support-access/grant") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      try {
        const grant = platformAdminRepository.grantSupportAccess({
          durationMinutes: body.durationMinutes,
          grantedBy: admin.ownerKey,
          granteeUserId: body.granteeUserId || admin.session.userId,
          reason: body.reason,
          scopeId: body.scopeId,
          scopeType: body.scopeType
        });
        writeJson(request, response, 201, { grant });
      } catch (error) {
        if (error instanceof PlatformAuthorizationError) {
          writeJson(request, response, error.statusCode, {
            error: error.code,
            message: "支持访问授权参数无效。"
          });
        } else {
          writeJson(request, response, 500, {
            error: "support_access_grant_failed",
            message: "支持访问授权失败。"
          });
        }
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/support-access/revoke") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const reason = requireAdminReason(request, response, body);
      if (!reason) return;
      try {
        writeJson(request, response, 200, platformAdminRepository.revokeSupportAccess(
          body.grantId,
          admin.ownerKey,
          reason
        ));
      } catch (error) {
        const statusCode = error instanceof PlatformAuthorizationError ? error.statusCode : 500;
        writeJson(request, response, statusCode, {
          error: error instanceof PlatformAuthorizationError
            ? error.code
            : "support_access_revoke_failed",
          message: "支持访问撤销失败。"
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/support-access/document") {
      const admin = authorizePlatformAdmin(
        request,
        response,
        authService,
        platformAdminRepository,
        { requireFreshMfa: true }
      );
      if (!admin) return;
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      try {
        const grant = platformAdminRepository.requireSupportAccess(
          admin.session.userId,
          body.scopeType,
          body.scopeId
        );
        const stored = libraryStorageRepository.locateDocument(body.documentId, {
          scopeId: body.scopeId,
          scopeType: body.scopeType
        });
        platformAdminRepository.recordAudit({
          action: "support_document_accessed",
          actorId: admin.ownerKey,
          metadata: { documentId: body.documentId, grantId: grant.grantId },
          reason: grant.reason,
          risk: "high",
          targetId: body.scopeId,
          targetType: body.scopeType
        });
        await writeLibraryPdf(request, response, stored);
      } catch (error) {
        if (error instanceof PlatformAuthorizationError) {
          writeJson(request, response, error.statusCode, {
            error: error.code,
            message: "没有有效的限时支持访问授权。"
          });
        } else {
          writeLibraryStorageError(request, response, error);
        }
      }
      return;
    }

    if (
      method === "POST" &&
      [
        "/v1/org/team-annotations/list",
        "/v1/org/team-annotations/upload",
        "/v1/org/team-annotations/withdraw"
      ].includes(url.pathname)
    ) {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      body.scopeId = body.organizationId;
      body.scopeType = "organization";
      const scope = authorizeLibraryScope(request, response, body, authService, organizationRepository);
      if (!scope) return;
      try {
        if (url.pathname.endsWith("/list")) {
          writeJson(request, response, 200, {
            annotations: libraryStorageRepository.listTeamAnnotations(
              scope.scopeId,
              body.documentId
            )
          });
        } else if (url.pathname.endsWith("/upload")) {
          writeJson(request, response, 200, executeLibraryMutation(
            request,
            libraryStorageRepository,
            scope,
            body,
            "upload_team_annotation",
            () => ({
              annotation: libraryStorageRepository.uploadTeamAnnotation({
                body: body.annotation,
                documentId: body.documentId,
                expectedRevision: body.expectedRevision,
                organizationId: scope.scopeId,
                uploadedBy: scope.actorId
              })
            })
          ));
        } else {
          writeJson(request, response, 200, executeLibraryMutation(
            request,
            libraryStorageRepository,
            scope,
            body,
            "withdraw_team_annotation",
            () => libraryStorageRepository.withdrawTeamAnnotation({
              actorId: scope.actorId,
              annotationId: body.annotationId,
              canModerate: canManageOrganizationLibrary(scope),
              expectedRevision: body.expectedRevision,
              organizationId: scope.scopeId
            })
          ));
        }
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/governance-summary") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      try {
        writeJson(
          request,
          response,
          200,
          buildOrganizationGovernancePayload(
            body,
            organizationRepository,
            libraryStorageRepository
          )
        );
      } catch (error) {
        writeOrganizationError(request, response, error);
      }
      return;
    }

    const expectedMethod = endpointMethods.get(url.pathname);
    if (expectedMethod) {
      writeJson(request, response, 405, {
        endpoint: url.pathname,
        error: "method_not_allowed",
        message: `浏览器直接打开 ${url.pathname} 会使用 GET；LiteasyClaw dev cloud 需要 ${expectedMethod} 请求。请从桌面应用触发，或用 curl 调用该接口。`,
        method: expectedMethod
      });
      return;
    }

    writeJson(request, response, 404, {
      availableEndpoints,
      error: "not_found",
      message: "LiteasyClaw dev cloud 未找到该路径。请访问根路径查看服务索引，或确认桌面端控制平面地址。",
      path: url.pathname
    });
  };

  return async (request, response) => {
    request.liteasyTraceId = `trace_${randomUUID()}`;
    try {
      await handleRequest(request, response);
    } catch (error) {
      console.error(`[dev-cloud] ${request.liteasyTraceId}`, error);
      if (!response.headersSent) {
        writeJson(request, response, 500, {
          code: "internal_error",
          message: "服务暂时无法完成请求，请稍后重试。"
        });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  };
}

import { buildAdminConsoleHtml, buildAdminGovernanceDashboardPayload } from "./adminConsole.mjs";
import { AuthError, createAuthService } from "./auth/authService.mjs";
import { createRateLimiter } from "./auth/rateLimiter.mjs";
import {
  buildAdminDemoResetPayload,
  buildAdminDemoReseedPayload
} from "./payloads/adminDemoActionPayloads.mjs";
import { buildAdminDemoStatePayload } from "./payloads/adminDemoStatePayloads.mjs";
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
  buildOrganizationSharedLibraryManifestPayload,
  buildOrganizationSummaryPayload
} from "./payloads/organizationPayloads.mjs";
import {
  buildPolicyPayload,
  buildPolicyUpdatePayload
} from "./payloads/policyPayloads.mjs";
import {
  buildDocumentMetadataSyncPayload,
  buildLiveRecommendationPayload,
  buildRecommendationPayload,
  normalizeRecommendationResearchProfile
} from "./payloads/recommendationPayloads.mjs";
import { applyRecommendationEmbeddingScores } from "./payloads/recommendationEmbeddingPayloads.mjs";
import { applyRecommendationExternalReranker } from "./payloads/recommendationRerankerPayloads.mjs";
import { createAccountRepository } from "./db/accountRepository.mjs";
import { createAuthSessionRepository } from "./db/authSessionRepository.mjs";
import { createDatabase } from "./db/database.mjs";
import { createExternalKnowledgeRunRepository } from "./db/externalKnowledgeRunRepository.mjs";
import { createGrobidParseCacheRepository } from "./db/grobidParseCacheRepository.mjs";
import {
  createLibraryStorageRepository,
  LibraryStorageError
} from "./db/libraryStorageRepository.mjs";
import {
  getOrganizationMemberRole,
  setOrganizationLibraryDocumentVisibility
} from "./db/organizationRepository.mjs";
import {
  clearRecommendationCandidatesForUser,
  createRecommendationCandidateRepository,
  listRecommendationCandidateSources,
  setRecommendationCandidateRepository,
  updateRecommendationCandidateStatus,
  upsertRecommendationCandidates
} from "./db/recommendationCandidateRepository.mjs";
import { clearRecommendationCacheForSession } from "./db/recommendationCacheRepository.mjs";
import {
  clearRecommendationFeedbackForUser,
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
const maximumAgentArtifactBodyBytes = 1024 * 1024;
const maximumPdfParseBodyBytes = 40 * 1024 * 1024;
const maximumLibraryPdfBytes = 256 * 1024 * 1024;

const availableEndpoints = [
  "GET /",
  "GET /healthz",
  "GET /admin",
  "GET /admin/",
  "GET /v1/admin/demo-state",
  "GET /v1/admin/model-policy",
  "POST /v1/admin/demo-reset",
  "POST /v1/admin/demo-reseed",
  "POST /v1/admin/recommendation-cache/clear",
  "POST /v1/admin/model-policy",
  "GET /v1/admin/governance-dashboard",
  "POST /v1/account/demo-login",
  "POST /v1/account/login",
  "POST /v1/account/logout",
  "POST /v1/account/register",
  "POST /v1/account/session",
  "POST /v1/model/generate",
  "POST /v1/model/generate-stream",
  "POST /v1/model/audit",
  "GET /v1/agent-artifacts",
  "POST /v1/agent-artifacts",
  "PATCH /v1/agent-artifacts/:artifactId",
  "DELETE /v1/agent-artifacts/:artifactId",
  "POST /v1/recommendations",
  "POST /v1/recommendations/feedback",
  "POST /v1/research/external-knowledge",
  "POST /v1/research/external-pdf",
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
  "POST /v1/org/summary",
  "POST /v1/org/shared-library/manifest",
  "POST /v1/org/governance-summary",
  "POST /v1/library/documents/upload",
  "POST /v1/library/documents/list",
  "POST /v1/library/documents/trash",
  "POST /v1/library/documents/restore",
  "POST /v1/library/documents/update",
  "POST /v1/library/documents/authorize",
  "POST /v1/library/documents/download",
  "POST /v1/library/folders/create",
  "POST /v1/library/folders/update",
  "POST /v1/library/quota",
  "POST /v1/org/team-annotations/list",
  "POST /v1/org/team-annotations/upload",
  "POST /v1/org/team-annotations/withdraw",
  "POST /v1/admin/storage-quota"
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
  const isDesktopOrigin = origin === "tauri://localhost";
  const allowOrigin =
    typeof origin !== "string"
      ? "*"
      : isLoopbackOrigin || isDesktopOrigin || isConfiguredOrigin
        ? origin
        : undefined;

  const headers = {
    "Access-Control-Allow-Headers": [
      "Content-Type",
      "X-Liteasy-Duplicate-Action",
      "X-Liteasy-File-Name",
      "X-Liteasy-Folder-Id",
      "X-Liteasy-Scope-Id",
      "X-Liteasy-Scope-Type",
      "X-Liteasy-Session-Id"
    ].join(", "),
    "Access-Control-Allow-Methods": "DELETE,GET,POST,OPTIONS",
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
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  response.end(JSON.stringify(payload));
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
    response.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown_stream_error",
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

function writeLibraryPdf(request, response, fileName, bytes) {
  response.writeHead(200, {
    ...buildCorsHeaders(request),
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Content-Length": bytes.length,
    "Content-Type": "application/pdf"
  });
  response.end(bytes);
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
  const sessionId =
    typeof body === "object" && body !== null && typeof body.sessionId === "string"
      ? body.sessionId
      : "";

  if (!sessionId.startsWith("ltsy_") && !sessionId.startsWith("user:")) {
    // Preserve named demo identities used by the roadshow fixtures. Real account
    // storage keys always use the protected user: namespace below.
    return true;
  }

  try {
    const session = authService.validateSession(sessionId);
    body.sessionId = `user:${session.userId}`;
    return true;
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

function authorizeLibraryScope(request, response, body, authService) {
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
  const role = getOrganizationMemberRole(scopeId, actorId);
  if (!role) {
    writeJson(request, response, 403, { error: "organization_membership_required" });
    return null;
  }
  return { actorId, role, scopeId, scopeType };
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
    message: error instanceof Error ? error.message : "Library storage failed."
  });
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
  const libraryStorageRepository =
    customConfig.libraryStorageRepository ?? createLibraryStorageRepository(database, {
      objectDirectory: customConfig.libraryStorageObjectDirectory,
      now: customConfig.now
  });
  libraryStorageRepository.purgeExpired?.();
  const accountRepository = createAccountRepository(database);
  const sessionRepository = createAuthSessionRepository(database);
  const authService = customConfig.authService ?? createAuthService({
    accountRepository,
    sessionDurationMs: config.accountSessionDurationMs,
    sessionRepository
  });
  const authRateLimiter = createRateLimiter(config.authRateLimit);
  const agentArtifactRepository =
    customConfig.agentArtifactRepository ?? createAgentArtifactRepository({
      resultDirectory: customConfig.agentArtifactResultDirectory
    });
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

  return async (request, response) => {
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
      writeJson(request, response, 200, {
        artifacts: agentArtifactRepository.list(),
        resultDirectory: "project-docs/agent-results"
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
      try {
        writeJson(request, response, 201, agentArtifactRepository.save(body));
      } catch (error) {
        writeJson(request, response, 400, {
          error: error instanceof Error ? error.message : "invalid_agent_artifact"
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
      try {
        const renamed = agentArtifactRepository.rename(artifactId, body.title);
        if (!renamed) {
          writeJson(request, response, 404, { error: "agent_artifact_not_found" });
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
      try {
        const deleted = agentArtifactRepository.remove(artifactId);
        if (!deleted) {
          writeJson(request, response, 404, { error: "agent_artifact_not_found" });
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
      writeHtml(
        request,
        response,
        200,
        buildAdminConsoleHtml(request, config, {
          buildAdminDemoStatePayload,
          buildOrganizationGovernancePayload,
          buildOrganizationListPayload
        })
      );
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/demo-state") {
      writeJson(request, response, 200, buildAdminDemoStatePayload());
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/model-policy") {
      writeJson(request, response, 200, buildPolicyPayload(request, config));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/demo-reset") {
      writeJson(request, response, 200, buildAdminDemoResetPayload());
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/demo-reseed") {
      writeJson(request, response, 200, buildAdminDemoReseedPayload());
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/model-policy") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      writeJson(request, response, 200, buildPolicyUpdatePayload(request, config, body));
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/governance-dashboard") {
      writeJson(
        request,
        response,
        200,
        buildAdminGovernanceDashboardPayload(request, config, {
          buildAdminDemoStatePayload,
          buildOrganizationGovernancePayload,
          buildOrganizationListPayload
        })
      );
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

    if (method === "POST" && url.pathname === "/v1/account/demo-login") {
      writeJson(request, response, 200, {
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro",
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        }
      });
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

    if (method === "POST" && url.pathname === "/v1/account/session") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      try {
        writeJson(request, response, 200, {
          session: authService.validateSession(body.sessionId)
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
      if (customConfig.recommendationMode === "demo") {
        writeJson(
          request,
          response,
          200,
          withoutSuppressedRecommendations(
            buildRecommendationPayload(recommendationBody),
            personalizationPreferences
          )
        );
        return;
      }
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
        writeJson(request, response, 200, withoutSuppressedRecommendations({
          ...payload,
          externalReranker: externalReranker.audit,
          recommendations: externalReranker.recommendations,
          semanticRetrieval: semanticRetrieval.audit
        }, personalizationPreferences));
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
            writeJson(request, response, 200, { ...resumed.payload, retrieval: resumed.run });
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
        writeJson(request, response, 200, completedRun ? { ...payload, retrieval: completedRun } : payload);
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

    if (method === "POST" && url.pathname === "/v1/research/external-pdf") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      if (typeof body.url !== "string" || body.url.length > 2_048 ||
        typeof body.sourceId !== "string" || !/^[^\s\u0000-\u001f\u007f]{1,180}$/.test(body.sourceId)) {
        writeJson(request, response, 400, {
          error: "invalid_external_pdf_request",
          message: "外部 PDF 请求缺少有效的来源 ID 或 URL。"
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
        const pdf = await fetchSecurePdf(body.url, {
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

    if (method === "GET" && url.pathname === "/v1/local-library/pdf") {
      try {
        const bytes = await readLocalLibraryPdfForBrowser(url.searchParams.get("path") ?? "", {
          rootPath: customConfig.localLibraryRootPath
        });
        writePdf(request, response, bytes);
      } catch (error) {
        writeJson(request, response, error instanceof LocalLibraryPdfError ? error.statusCode : 500, {
          error: "local_library_pdf_unavailable",
          message: error instanceof Error ? error.message : "本地 PDF 当前不可用。"
        });
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
        writeJson(request, response, 502, {
          error: "mineru_extraction_failed",
          message: error instanceof Error ? error.message : "MinerU PDF 解析失败。"
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
      clearRecommendationCacheForSession(body.sessionId);
      clearRecommendationFeedbackForUser(body.sessionId);
      clearRecommendationCandidatesForUser(body.sessionId);
      writeJson(request, response, 200, snapshot);
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

      writeJson(request, response, 200, buildCollectionListPayload(body));
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

      const payload = buildCollectionSavePayload(body);
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

      writeJson(request, response, 200, buildDocumentMetadataSyncPayload(body));
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

      writeJson(request, response, 200, buildOrganizationListPayload(body));
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

      const payload = buildOrganizationCreatePayload(body);
      if ("error" in payload) {
        writeJson(
          request,
          response,
          payload.error === "organization_create_forbidden" ? 403 : 400,
          payload
        );
        return;
      }

      writeJson(request, response, 200, payload);
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

      const payload = buildOrganizationJoinPayload(body);
      if ("error" in payload) {
        writeJson(request, response, 400, payload);
        return;
      }

      writeJson(request, response, 200, payload);
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

      const payload = buildOrganizationInvitePayload(body);
      if ("error" in payload) {
        writeJson(
          request,
          response,
          payload.error === "organization_role_forbidden" ? 403 : 400,
          payload
        );
        return;
      }

      writeJson(request, response, 200, payload);
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

      const payload = buildOrganizationLeavePayload(body);
      if ("error" in payload) {
        writeJson(
          request,
          response,
          payload.error === "organization_owner_leave_blocked" ? 403 : 400,
          payload
        );
        return;
      }

      writeJson(request, response, 200, payload);
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

      writeJson(request, response, 200, buildOrganizationSummaryPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/shared-library/manifest") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }
      body.scopeId = body.organizationId;
      body.scopeType = "organization";
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      const payload = buildOrganizationSharedLibraryManifestPayload(body);
      const persistedDocuments = libraryStorageRepository.listDocuments(
        "organization",
        scope.scopeId,
        "active"
      );
      const rootFolderId = payload.manifest.rootFolderId;
      const persistedFolders = libraryStorageRepository.listFolders("organization", scope.scopeId);
      payload.manifest.folders.push(...persistedFolders.map((folder) => ({
        id: folder.folderId,
        name: folder.name,
        parentId: folder.parentFolderId ?? rootFolderId,
        path: `org://${scope.scopeId}/shared-library/${folder.folderId}`
      })));
      payload.manifest.documents.push(...persistedDocuments.map((document) => ({
        folderId: document.folderId ?? rootFolderId,
        id: document.documentId,
        sourcePath: `org://${scope.scopeId}/shared-library/${
          document.folderId ? `${document.folderId}/` : ""
        }${document.documentId}.pdf`,
        title: document.fileName.replace(/\.pdf$/i, "")
      })));
      writeJson(request, response, 200, payload);
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/update") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        const changes = {};
        if (Object.prototype.hasOwnProperty.call(body, "fileName")) changes.fileName = body.fileName;
        if (Object.prototype.hasOwnProperty.call(body, "folderId")) changes.folderId = body.folderId;
        writeJson(request, response, 200, {
          document: libraryStorageRepository.updateDocument(body.documentId, scope, changes)
        });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/upload") {
      const authBody = {
        scopeId: request.headers["x-liteasy-scope-id"],
        scopeType: request.headers["x-liteasy-scope-type"],
        sessionId: request.headers["x-liteasy-session-id"]
      };
      const scope = authorizeLibraryScope(request, response, authBody, authService);
      if (!scope) return;
      let bytes;
      try {
        bytes = await readBinaryBody(request, maximumLibraryPdfBytes);
      } catch (error) {
        writeJson(request, response, 413, { error: "request_body_too_large" });
        return;
      }
      try {
        const rawName = request.headers["x-liteasy-file-name"];
        const fileName = decodeURIComponent(typeof rawName === "string" ? rawName : "Untitled paper.pdf");
        const payload = libraryStorageRepository.uploadDocument({
          bytes,
          duplicateAction: request.headers["x-liteasy-duplicate-action"],
          fileName,
          folderId: request.headers["x-liteasy-folder-id"],
          scopeId: scope.scopeId,
          scopeType: scope.scopeType,
          uploadedBy: scope.actorId
        });
        if (scope.scopeType === "organization" && payload.document) {
          setOrganizationLibraryDocumentVisibility(scope.scopeId, payload.document, true);
        }
        writeJson(request, response, 200, payload);
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/list") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
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
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_library_manage_forbidden" });
        return;
      }
      try {
        const document = url.pathname.endsWith("/trash")
          ? libraryStorageRepository.trashDocument(body.documentId, scope)
          : libraryStorageRepository.restoreDocument(body.documentId, scope);
        if (scope.scopeType === "organization") {
          setOrganizationLibraryDocumentVisibility(
            scope.scopeId,
            document,
            document.status === "active"
          );
        }
        writeJson(request, response, 200, { document });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/documents/authorize") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      try {
        const document = libraryStorageRepository.authorizeDocument(body.documentId, scope);
        const serverNow = new Date();
        writeJson(request, response, 200, {
          document,
          expiresAt: new Date(serverNow.getTime() + 5 * 60 * 1000).toISOString(),
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
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      try {
        const stored = libraryStorageRepository.readDocument(body.documentId, scope);
        writeLibraryPdf(request, response, stored.document.fileName, stored.bytes);
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/folders/create") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      if (!canManageOrganizationLibrary(scope)) {
        writeJson(request, response, 403, { error: "organization_folder_manage_forbidden" });
        return;
      }
      try {
        const folder = libraryStorageRepository.createFolder({
          createdBy: scope.actorId,
          name: body.name,
          parentFolderId: body.parentFolderId,
          scopeId: scope.scopeId,
          scopeType: scope.scopeType
        });
        writeJson(request, response, 200, { folder });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/folders/update") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
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
        writeJson(request, response, 200, {
          folder: libraryStorageRepository.updateFolder(body.folderId, scope, changes)
        });
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/library/quota") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      const scope = authorizeLibraryScope(request, response, body, authService);
      if (!scope) return;
      try {
        writeJson(request, response, 200, libraryStorageRepository.getQuota(scope.scopeType, scope.scopeId));
      } catch (error) {
        writeLibraryStorageError(request, response, error);
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/storage-quota") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) return;
      try {
        writeJson(
          request,
          response,
          200,
          libraryStorageRepository.setQuota(body.scopeType, body.scopeId, body.limitBytes)
        );
      } catch (error) {
        writeLibraryStorageError(request, response, error);
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
      const scope = authorizeLibraryScope(request, response, body, authService);
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
          writeJson(request, response, 200, {
            annotation: libraryStorageRepository.uploadTeamAnnotation({
              body: body.annotation,
              documentId: body.documentId,
              organizationId: scope.scopeId,
              uploadedBy: scope.actorId
            })
          });
        } else {
          writeJson(request, response, 200, libraryStorageRepository.withdrawTeamAnnotation(
            body.annotationId,
            scope.actorId,
            canManageOrganizationLibrary(scope)
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

      writeJson(request, response, 200, buildOrganizationGovernancePayload(body));
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
}

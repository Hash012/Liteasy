import { buildAdminConsoleHtml, buildAdminGovernanceDashboardPayload } from "./adminConsole.mjs";
import { AuthError, createAuthService } from "./auth/authService.mjs";
import { createRateLimiter } from "./auth/rateLimiter.mjs";
import {
  buildAdminDemoResetPayload,
  buildAdminDemoReseedPayload
} from "./payloads/adminDemoActionPayloads.mjs";
import { buildAdminDemoStatePayload } from "./payloads/adminDemoStatePayloads.mjs";
import { defaultConfig, getPublicOrigin } from "./config.mjs";
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
  buildRecommendationPayload
} from "./payloads/recommendationPayloads.mjs";
import { createAccountRepository } from "./db/accountRepository.mjs";
import { createAuthSessionRepository } from "./db/authSessionRepository.mjs";
import { createDatabase } from "./db/database.mjs";
import { createAgentArtifactRepository } from "./agentArtifactRepository.mjs";

// 深度论文分析会携带多篇论文的分层证据和 SubAgent 区段报告。
// 仍保留明确上限以防止本地开发服务被无界请求占满内存。
const maximumJsonBodyBytes = 512 * 1024;
const maximumAgentArtifactBodyBytes = 1024 * 1024;

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
  "DELETE /v1/agent-artifacts/:artifactId",
  "POST /v1/recommendations",
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
  "POST /v1/org/governance-summary"
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
  const allowOrigin =
    typeof origin !== "string"
      ? "*"
      : isLoopbackOrigin || isConfiguredOrigin
        ? origin
        : undefined;

  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
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

export function createDevCloudRequestHandler(customConfig = {}) {
  const config = {
    ...defaultConfig,
    ...customConfig
  };
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
      writeJson(request, response, 200, { ok: true });
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
        writeJson(request, response, 200, await generateAnswer(body, providers));
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
        generateAnswerStream(body, providers, streamingProviders)
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

      writeJson(request, response, 200, buildRecommendationPayload(body));
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
      if (!authorizeAccountScopedBody(request, response, body, authService)) {
        return;
      }

      writeJson(
        request,
        response,
        200,
        buildOrganizationSharedLibraryManifestPayload(body)
      );
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

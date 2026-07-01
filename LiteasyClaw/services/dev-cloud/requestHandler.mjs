import { buildAdminConsoleHtml, buildAdminGovernanceDashboardPayload } from "./adminConsole.mjs";
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
  generateAnswer
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
import { createHash } from "node:crypto";

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
  "POST /v1/account/register",
  "POST /v1/model/generate",
  "POST /v1/model/audit",
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

  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": typeof origin === "string" ? origin : "*",
    Vary: "Origin"
  };
}

function writeCorsPreflight(request, response) {
  response.writeHead(204, buildCorsHeaders(request));
  response.end();
}

function writeJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function writeHtml(request, response, statusCode, html) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (rawBody.length === 0) {
    return {};
  }

  return JSON.parse(rawBody);
}

async function readJsonOrWriteError(request, response) {
  try {
    return await readJsonBody(request);
  } catch {
    writeJson(request, response, 400, {
      error: "invalid_json"
    });
    return null;
  }
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeDisplayName(value, email) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return email.split("@")[0] || "Liteasy User";
}

function hashPassword(password) {
  return createHash("sha256").update(`liteasy-dev-cloud:${password}`).digest("hex");
}

function isValidRegistrationBody(body) {
  return (
    typeof body === "object" &&
    body !== null &&
    normalizeEmail(body.email).includes("@") &&
    typeof body.password === "string" &&
    body.password.length >= 8
  );
}

function isValidLoginBody(body) {
  return (
    typeof body === "object" &&
    body !== null &&
    normalizeEmail(body.email).includes("@") &&
    typeof body.password === "string" &&
    body.password.length > 0
  );
}

function buildAccountSession(account) {
  return {
    email: account.email,
    expiresAt: "2026-12-31T23:59:59.000Z",
    membershipTier: "pro",
    name: account.displayName,
    sessionId: `account-session-${account.email.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
  };
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
  const localAccounts = new Map();

  return async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

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

      if (!isValidRegistrationBody(body)) {
        writeJson(request, response, 400, {
          error: "invalid_account_registration",
          message: "请填写有效邮箱，并使用至少 8 位密码。"
        });
        return;
      }

      const email = normalizeEmail(body.email);
      if (localAccounts.has(email)) {
        writeJson(request, response, 409, {
          error: "account_exists",
          message: "该邮箱已经注册，请直接登录。"
        });
        return;
      }

      const account = {
        displayName: normalizeDisplayName(body.displayName, email),
        email,
        passwordHash: hashPassword(body.password)
      };
      localAccounts.set(email, account);

      writeJson(request, response, 200, {
        session: buildAccountSession(account)
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/login") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
        return;
      }

      if (!isValidLoginBody(body)) {
        writeJson(request, response, 400, {
          error: "invalid_account_login",
          message: "请填写有效邮箱和密码。"
        });
        return;
      }

      const email = normalizeEmail(body.email);
      const account = localAccounts.get(email);
      if (!account || account.passwordHash !== hashPassword(body.password)) {
        writeJson(request, response, 401, {
          error: "invalid_credentials",
          message: "邮箱或密码不正确。"
        });
        return;
      }

      writeJson(request, response, 200, {
        session: buildAccountSession(account)
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendations") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
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

      writeJson(request, response, 200, buildCollectionListPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/collection/items") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
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

      writeJson(request, response, 200, buildDocumentMetadataSyncPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/list") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
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

      writeJson(request, response, 200, buildOrganizationSummaryPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/shared-library/manifest") {
      const body = await readJsonOrWriteError(request, response);
      if (body === null) {
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

import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  getPublicOrigin,
  resolveCliRuntimeConfig,
  resolveHost,
  resolvePort
} from "./config.mjs";
import {
  buildAdminConsoleHtml,
  buildAdminGovernanceDashboardPayload
} from "./adminConsole.mjs";
import { generateMockAnswer } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponses.mjs";

const availableEndpoints = [
  "GET /",
  "GET /healthz",
  "GET /admin",
  "GET /admin/",
  "GET /v1/admin/model-policy",
  "POST /v1/admin/model-policy",
  "GET /v1/admin/governance-dashboard",
  "POST /v1/account/demo-login",
  "POST /v1/model/generate",
  "POST /v1/model/audit",
  "POST /v1/recommendations",
  "POST /v1/documents/metadata-sync",
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

const collectionItemsBySession = new Map();

function buildCorsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": typeof origin === "string" ? origin : "*",
    "Vary": "Origin"
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

function buildPolicyPayload(request, config) {
  const origin = getPublicOrigin(request, config);

  return {
    cloudProxyEndpoint: origin,
    defaultProvider: config.defaultProvider,
    localDirectEnabled: config.localDirectEnabled,
    localDirectEndpoint: config.localDirectEndpoint,
    modelAccessMode: config.modelAccessMode,
    policyVersion: config.policyVersion,
    syncedAt: config.syncedAt
  };
}


function isModelAccessMode(value) {
  return value === "cloud_proxy" || value === "local_direct";
}

function buildPolicyUpdatePayload(request, config, body = {}) {
  const defaultProvider = typeof body.defaultProvider === "string" && body.defaultProvider.length > 0
    ? body.defaultProvider
    : config.defaultProvider;
  const localDirectEnabled = typeof body.localDirectEnabled === "boolean"
    ? body.localDirectEnabled
    : config.localDirectEnabled;
  const modelAccessMode = isModelAccessMode(body.modelAccessMode)
    ? body.modelAccessMode
    : config.modelAccessMode;

  config.defaultProvider = defaultProvider;
  config.localDirectEnabled = localDirectEnabled;
  config.modelAccessMode = modelAccessMode;
  config.policyVersion = `ops-policy-v${Number(String(config.policyVersion).match(/(\d+)$/)?.[1] ?? 1) + 1}`;
  config.syncedAt = "2026-05-15T00:15:00Z";

  return {
    policy: buildPolicyPayload(request, config),
    updatedAt: config.syncedAt,
    updatedBy: "internal-ops-demo"
  };
}


function buildProviderRegistry(config) {
  const openaiProvider =
    config.openaiApiKey && config.openaiApiKey.length > 0
      ? createOpenAIResponsesProvider({
          apiBaseUrl: config.openaiApiBaseUrl,
          apiKey: config.openaiApiKey
        })
      : null;

  return {
    mock: generateMockAnswer,
    openai: openaiProvider
  };
}

function buildRecommendationPayload(body) {
  const selectedDocuments = Array.isArray(body.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = selectedDocuments
    .filter((document) => typeof document?.title === "string")
    .map((document) => document.title);

  if (selectedTitles.some((title) => title.includes("BERT"))) {
    return {
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "同样关注大规模预训练语言模型的迁移能力。",
          source: "Semantic Scholar",
          title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
        },
        {
          discoveredAt: "2026-05-14T09:10:00Z",
          id: "rec-bert-2",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "medium",
          relevanceScore: 0.78,
          reason: "延续 BERT 路线，强调参数共享与效率优化。",
          source: "arXiv Watch",
          title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
        }
      ]
    };
  }

  return {
    recommendations: [
      {
        discoveredAt: "2026-05-14T07:30:00Z",
        id: "rec-transformer-1",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "high",
        relevanceScore: 0.91,
        reason: "延伸 Transformer 在视觉任务中的应用脉络。",
        source: "Semantic Scholar",
        title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
      },
      {
        discoveredAt: "2026-05-14T09:00:00Z",
        id: "rec-transformer-2",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "medium",
        relevanceScore: 0.75,
        reason: "补充长序列建模方向，便于横向比较注意力结构。",
        source: "Connected Papers",
        title: "Longformer: The Long-Document Transformer"
      }
    ]
  };
}

function buildDocumentMetadataSyncPayload(body) {
  const documents = Array.isArray(body.documents) ? body.documents : [];
  const validDocuments = documents.filter(
    (document) =>
      typeof document?.id === "string" &&
      typeof document?.title === "string" &&
      (typeof document?.sourcePath === "string" || typeof document?.sourcePath === "undefined")
  );
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const workspaceRevision = Number.isFinite(body.workspaceRevision) ? body.workspaceRevision : 0;

  return {
    result: {
      acceptedCount: validDocuments.length,
      rejectedCount: documents.length - validDocuments.length,
      syncId: `metadata-${sessionId}-r${workspaceRevision}`,
      syncedAt: "2026-05-14T10:20:00Z"
    }
  };
}

function isCollectionItemPayload(item) {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.id === "string" &&
    typeof item.reason === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.source === "string" &&
    typeof item.title === "string"
  );
}

function buildCollectionListPayload(body = {}) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  return {
    items: [...(collectionItemsBySession.get(sessionId) ?? [])]
  };
}

function buildCollectionSavePayload(body = {}) {
  const item = body.item;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";

  if (!isCollectionItemPayload(item)) {
    return {
      error: "invalid_collection_item"
    };
  }

  const currentItems = collectionItemsBySession.get(sessionId) ?? [];
  const nextItems = [
    item,
    ...currentItems.filter((currentItem) => currentItem.id !== item.id)
  ];
  collectionItemsBySession.set(sessionId, nextItems);

  return {
    items: nextItems
  };
}


function buildOrganizationListPayload(body) {
  const activeOrganizationId =
    typeof body.activeOrganizationId === "string" ? body.activeOrganizationId : "org-demo-1";

  return {
    activeOrganizationId,
    organizations: [
      {
        memberCount: 12,
        myRole: "研究员",
        name: "Liteasy AI Reading Lab",
        organizationId: "org-demo-1",
        sharedLibraryName: "组织共享文献库"
      },
      {
        memberCount: 4,
        myRole: "管理员",
        name: "Liteasy Literature Ops",
        organizationId: "org-demo-2",
        sharedLibraryName: "文献运营共享库"
      }
    ]
  };
}

function buildOrganizationSummaryPayload(body) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      summary: {
        auditEvents: [
          {
            actor: "Ops Admin",
            description: "新增 QA 目录",
            id: "audit-ops-1",
            occurredAt: "2026-05-14T11:00:00Z"
          }
        ],
        memberCount: 4,
        members: [
          {
            id: "member-ops-1",
            name: "Liteasy Researcher",
            role: "管理员"
          },
          {
            id: "member-ops-2",
            name: "Ops Reviewer",
            role: "审核员"
          }
        ],
        myRole: sessionId === "anonymous" ? "访客" : "管理员",
        name: "Liteasy Literature Ops",
        notifications: [
          {
            id: "ops-notice-1",
            message: "文献运营共享库新增 QA 目录。",
            type: "library_change"
          }
        ],
        organizationId: "org-demo-2",
        quota: {
          periodEndsAt: "2026-06-01T00:00:00Z",
          storageLimitGb: 50,
          storageUsedGb: 12
        },
        sharedLibrary: {
          documentCount: 16,
          documents: [
            {
              id: "org-ops-doc-1",
              sourcePath: "org://org-demo-2/shared-library/org-ops-doc-1.pdf",
              title: "Organization Ops Handbook"
            }
          ],
          name: "文献运营共享库",
          status: "available"
        },
        taskSummary: {
          failed: 0,
          running: 1
        }
      }
    };
  }

  return {
    summary: {
      auditEvents: [
        {
          actor: "Admin",
          description: "更新共享文献库上传权限",
          id: "audit-1",
          occurredAt: "2026-05-14T10:30:00Z"
        }
      ],
      memberCount: 12,
      members: [
        {
          id: "member-1",
          name: "Liteasy Researcher",
          role: "研究员"
        },
        {
          id: "member-2",
          name: "Admin",
          role: "管理员"
        }
      ],
      myRole: sessionId === "anonymous" ? "访客" : "研究员",
      name: "Liteasy AI Reading Lab",
      notifications: [
        {
          id: "notice-1",
          message: "管理员发布了本周阅读主题。",
          type: "announcement"
        },
        {
          id: "notice-2",
          message: "成员上传了 Graph Neural Networks 综述。",
          type: "document_upload"
        },
        {
          id: "notice-3",
          message: "共享文献库结构新增 RAG 目录。",
          type: "library_change"
        }
      ],
      organizationId: "org-demo-1",
      quota: {
        periodEndsAt: "2026-06-01T00:00:00Z",
        storageLimitGb: 100,
        storageUsedGb: 38
      },
      sharedLibrary: {
        documentCount: 48,
        documents: [
          {
            id: "org-doc-1",
            sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
            title: "Organization Reading List: Retrieval-Augmented Generation"
          },
          {
            id: "org-doc-2",
            sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
            title: "Team Notes on Long-Context Evaluation"
          }
        ],
        name: "组织共享文献库",
        status: "available"
      },
      taskSummary: {
        failed: 1,
        running: 2
      }
    }
  };
}

function buildOrganizationSharedLibraryManifestPayload(body = {}) {
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      manifest: {
        documents: [
          {
            folderId: "org-demo-2-ops",
            id: "org-ops-doc-1",
            sourcePath: "org://org-demo-2/shared-library/Ops/org-ops-doc-1.pdf",
            title: "Organization Ops Handbook"
          }
        ],
        folders: [
          {
            id: "org-demo-2-root",
            name: "文献运营共享库",
            parentId: null,
            path: "org://org-demo-2/shared-library"
          },
          {
            id: "org-demo-2-ops",
            name: "Ops",
            parentId: "org-demo-2-root",
            path: "org://org-demo-2/shared-library/Ops"
          }
        ],
        name: "文献运营共享库",
        organizationId: "org-demo-2",
        rootFolderId: "org-demo-2-root",
        status: "available"
      }
    };
  }

  return {
    manifest: {
      documents: [
        {
          folderId: "org-demo-1-rag",
          id: "org-doc-1",
          sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
          title: "Organization Reading List: Retrieval-Augmented Generation"
        },
        {
          folderId: "org-demo-1-eval",
          id: "org-doc-2",
          sourcePath: "org://org-demo-1/shared-library/Evaluation/org-doc-2.pdf",
          title: "Team Notes on Long-Context Evaluation"
        }
      ],
      folders: [
        {
          id: "org-demo-1-root",
          name: "组织共享文献库",
          parentId: null,
          path: "org://org-demo-1/shared-library"
        },
        {
          id: "org-demo-1-rag",
          name: "RAG",
          parentId: "org-demo-1-root",
          path: "org://org-demo-1/shared-library/RAG"
        },
        {
          id: "org-demo-1-eval",
          name: "Evaluation",
          parentId: "org-demo-1-root",
          path: "org://org-demo-1/shared-library/Evaluation"
        }
      ],
      name: "组织共享文献库",
      organizationId: "org-demo-1",
      rootFolderId: "org-demo-1-root",
      status: "available"
    }
  };
}


function buildOrganizationGovernancePayload(body = {}) {
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "org-demo-1";

  if (organizationId === "org-demo-2") {
    return {
      summary: {
        auditQueue: {
          highRisk: 0,
          pendingReview: 1
        },
        quota: {
          modelCallsLimit: 5000,
          modelCallsUsed: 900,
          storageLimitGb: 50,
          storageUsedGb: 12
        },
        recentAuditEvents: [
          {
            id: "audit-ops-1",
            label: "Ops Admin 新增 QA 目录",
            risk: "low"
          }
        ],
        runningTasks: [
          {
            id: "task-ops-1",
            label: "文献运营共享库目录同步",
            status: "running"
          }
        ]
      }
    };
  }

  return {
    summary: {
      auditQueue: {
        highRisk: 1,
        pendingReview: 3
      },
      quota: {
        modelCallsLimit: 10000,
        modelCallsUsed: 4200,
        storageLimitGb: 100,
        storageUsedGb: 38
      },
      recentAuditEvents: [
        {
          id: "audit-1",
          label: "Admin 更新共享文献库上传权限",
          risk: "medium"
        }
      ],
      runningTasks: [
        {
          id: "task-1",
          label: "组织共享文献库索引刷新",
          status: "running"
        }
      ]
    }
  };
}

function clampScore(score) {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function getAuditVerdict(score) {
  if (score >= 0.8) {
    return "pass";
  }

  if (score >= 0.55) {
    return "review";
  }

  return "fail";
}

function buildModelAuditPayload(body) {
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const hasTraceableCitation = citations.some((citation) => typeof citation?.snippet === "string" && citation.snippet.length > 0);
  const answer = typeof body.answer === "string" ? body.answer : "";
  const retrievalConfidence = typeof body.retrievalConfidence === "number" ? body.retrievalConfidence : 0.5;
  const score = clampScore(retrievalConfidence + (hasTraceableCitation ? 0 : -0.2) + (answer.length >= 12 ? 0 : -0.15));

  return {
    audit: {
      model: "gpt-5-mini-auditor",
      rationale:
        hasTraceableCitation && answer.length >= 12
          ? "开发云审计确认回答包含可追溯引用。"
          : "开发云审计发现回答依据不足，需要人工复核。",
      score,
      verdict: getAuditVerdict(score)
    }
  };
}

async function generateAnswer(body, providers) {
  const providerId = typeof body.provider === "string" ? body.provider : "openai";
  const liveProvider = providers[providerId];

  if (liveProvider) {
    return {
      answer: await liveProvider(body),
      execution: {
        backend: "dev_cloud",
        mode: "live",
        provider: providerId
      }
    };
  }

  if (providerId !== "openai") {
    throw new Error(`当前开发云未注册 provider：${providerId}`);
  }

  return {
    answer: await providers.mock(body),
    execution: {
      backend: "dev_cloud",
      mode: "mock_fallback",
      provider: "mock"
    }
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
        name: "Liteasy dev cloud",
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
          buildOrganizationGovernancePayload,
          buildOrganizationListPayload
        })
      );
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/model-policy") {
      writeJson(request, response, 200, buildPolicyPayload(request, config));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/admin/model-policy") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
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
          buildOrganizationGovernancePayload,
          buildOrganizationListPayload
        })
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/generate") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
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
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
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

    if (method === "POST" && url.pathname === "/v1/recommendations") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildRecommendationPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/collection/list") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildCollectionListPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/collection/items") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
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
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildDocumentMetadataSyncPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/list") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildOrganizationListPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/summary") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildOrganizationSummaryPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/shared-library/manifest") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(request, response, 200, buildOrganizationSharedLibraryManifestPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/org/governance-summary") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(request, response, 400, {
          error: "invalid_json"
        });
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
        message: `浏览器直接打开 ${url.pathname} 会使用 GET；Liteasy dev cloud 需要 ${expectedMethod} 请求。请从桌面应用触发，或用 curl 调用该接口。`,
        method: expectedMethod
      });
      return;
    }

    writeJson(request, response, 404, {
      availableEndpoints,
      error: "not_found",
      message: "Liteasy dev cloud 未找到该路径。请访问根路径查看服务索引，或确认桌面端控制平面地址。",
      path: url.pathname
    });
  };
}

export function createDevCloudServer(customConfig = {}) {
  return http.createServer(createDevCloudRequestHandler(customConfig));
}

async function startFromCli() {
  const port = resolvePort();
  const host = resolveHost();
  const { desktopOrigin, publicOrigin } = resolveCliRuntimeConfig();
  const server = createDevCloudServer({
    desktopOrigin,
    publicOrigin
  });

  server.listen(port, host, () => {
    console.log(`Liteasy dev cloud listening on http://${host}:${port}`);
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  void startFromCli();
}

import http from "node:http";
import { fileURLToPath } from "node:url";
import { generateMockAnswer } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponses.mjs";

const defaultConfig = {
  defaultProvider: "openai",
  localDirectEnabled: false,
  localDirectEndpoint: "http://127.0.0.1:8788",
  modelAccessMode: "cloud_proxy",
  openaiApiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY,
  policyVersion: "dev-policy-v1",
  syncedAt: "2026-05-14T09:30:00Z"
};

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

function buildOrigin(request) {
  const host = request.headers.host ?? "127.0.0.1:8787";
  return `http://${host}`;
}

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
  const origin = buildOrigin(request);

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPercent(used, limit) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return "0%";
  }

  return `${Math.round((used / limit) * 100)}%`;
}

function buildAdminConsoleHtml(config = defaultConfig) {
  const dashboard = buildAdminGovernanceDashboardPayload(config).dashboard;
  const modelCallsPercent = formatPercent(dashboard.quota.modelCallsUsed, dashboard.quota.modelCallsLimit);
  const storagePercent = formatPercent(dashboard.quota.storageUsedGb, dashboard.quota.storageLimitGb);
  const endpointCards = Object.values(dashboard.threeEndStatus)
    .map(
      (endpoint) => `<div class="endpoint">
            <span class="status-pill">${escapeHtml(endpoint.status)}</span>
            <strong>${escapeHtml(endpoint.label)}</strong><br />
            <a href="${escapeHtml(endpoint.url)}">${escapeHtml(endpoint.url)}</a>
          </div>`
    )
    .join("");
  const apiPolicyItems = [
    ["默认 Provider", dashboard.apiPolicy.defaultProvider],
    ["模型接入模式", dashboard.apiPolicy.modelAccessMode],
    ["本地直连策略", dashboard.apiPolicy.localDirectEnabled ? "已开放" : "未开放"],
    ["策略版本", dashboard.apiPolicy.policyVersion]
  ]
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  const organizationRows = dashboard.organizations
    .map(
      (organization) => `<tr>
              <td>${escapeHtml(organization.name)}</td>
              <td>${escapeHtml(organization.myRole)}</td>
              <td>${escapeHtml(organization.memberCount)}</td>
              <td>${escapeHtml(organization.sharedLibraryName)}</td>
            </tr>`
    )
    .join("");
  const runningTasks = dashboard.runningTasks
    .map((task) => `<li><strong>${escapeHtml(task.label)}</strong><span>${escapeHtml(task.status)}</span></li>`)
    .join("");
  const recentAuditEvents = dashboard.recentAuditEvents
    .map((event) => `<li><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(event.risk)}</span></li>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Liteasy Operations Console</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; background: #f4f1ea; color: #1f3345; font-family: ui-serif, "Noto Serif SC", serif; }
      main { max-width: 1120px; margin: 0 auto; padding: 48px 24px; }
      .card { border: 1px solid #d9d2c3; border-radius: 18px; background: rgba(255, 255, 255, 0.86); box-shadow: 0 18px 40px rgba(31, 51, 69, 0.08); padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 34px; }
      h2 { margin: 30px 0 12px; font-size: 20px; }
      p { line-height: 1.7; }
      code, a { color: #24527a; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; }
      th, td { border-bottom: 1px solid #e7dfd0; padding: 12px 10px; text-align: left; }
      th { color: #5c6470; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 16px; }
      .endpoint, .metric { border: 1px solid #e2dccf; border-radius: 14px; padding: 14px; background: #fbfaf7; }
      .label { color: #6b7280; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
      .status-pill { float: right; border: 1px solid #c8d7ca; border-radius: 999px; background: #edf6ee; color: #315f3d; font-size: 11px; font-weight: 800; padding: 3px 8px; }
      .metric strong { display: block; margin-top: 8px; font-size: 30px; }
      .metric span { color: #6b7280; font-size: 13px; }
      .stack { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }
      .stack li { align-items: center; background: #fbfaf7; border: 1px solid #e2dccf; border-radius: 14px; display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; }
      .stack span { border-radius: 999px; background: #f1efe8; color: #5c6470; font-size: 12px; font-weight: 800; padding: 4px 9px; }
      form { border: 1px solid #e2dccf; border-radius: 14px; background: #fbfaf7; display: grid; gap: 12px; margin-top: 14px; padding: 16px; }
      label { display: grid; gap: 6px; color: #5c6470; font-size: 13px; font-weight: 800; }
      select { border: 1px solid #d9d2c3; border-radius: 10px; color: #1f3345; font: inherit; padding: 9px 10px; }
      button { border: 1px solid #24415f; border-radius: 999px; background: #1f3345; color: #fff; cursor: pointer; font: inherit; font-weight: 800; padding: 10px 14px; }
      .form-status { color: #315f3d; font-size: 13px; font-weight: 800; min-height: 18px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="label">内部运营与运维后台</div>
        <h1>Liteasy Operations Console</h1>
        <p>这是 Liteasy 内部运营和运维团队使用的本地 demo 后台，用于配置 API 策略、观察客户组织资源、配额、后台任务和审计队列；桌面软件端才是客户使用的产品。生成时间：${escapeHtml(dashboard.generatedAt)}。</p>
        <div class="grid">${endpointCards}</div>
        <h2>平台资源摘要</h2>
        <div class="grid">
          <div class="metric"><span>模型调用配额</span><strong>${escapeHtml(modelCallsPercent)}</strong><span>${escapeHtml(dashboard.quota.modelCallsUsed)} / ${escapeHtml(dashboard.quota.modelCallsLimit)} 次</span></div>
          <div class="metric"><span>存储使用量</span><strong>${escapeHtml(storagePercent)}</strong><span>${escapeHtml(dashboard.quota.storageUsedGb)} GB / ${escapeHtml(dashboard.quota.storageLimitGb)} GB</span></div>
          <div class="metric"><span>待审核队列</span><strong>${escapeHtml(dashboard.auditQueue.pendingReview)}</strong><span>高风险 ${escapeHtml(dashboard.auditQueue.highRisk)} 项</span></div>
        </div>
        <h2>API 策略</h2>
        <div class="grid">${apiPolicyItems}</div>
        <form id="api-policy-form">
          <div class="label">运维下发 API 策略</div>
          <label>默认 Provider
            <select name="defaultProvider">
              <option value="openai"${dashboard.apiPolicy.defaultProvider === "openai" ? " selected" : ""}>openai</option>
              <option value="mock"${dashboard.apiPolicy.defaultProvider === "mock" ? " selected" : ""}>mock</option>
            </select>
          </label>
          <label>模型接入模式
            <select name="modelAccessMode">
              <option value="cloud_proxy"${dashboard.apiPolicy.modelAccessMode === "cloud_proxy" ? " selected" : ""}>cloud_proxy</option>
              <option value="local_direct"${dashboard.apiPolicy.modelAccessMode === "local_direct" ? " selected" : ""}>local_direct</option>
            </select>
          </label>
          <label>本地直连策略
            <select name="localDirectEnabled">
              <option value="false"${dashboard.apiPolicy.localDirectEnabled ? "" : " selected"}>未开放</option>
              <option value="true"${dashboard.apiPolicy.localDirectEnabled ? " selected" : ""}>已开放</option>
            </select>
          </label>
          <button type="submit">保存 API 策略</button>
          <div class="form-status" id="api-policy-status"></div>
        </form>
        <h2>用户与账号</h2>
        <div class="grid">
          <div class="metric"><span>活跃客户用户</span><strong>${escapeHtml(dashboard.users.activeUsers)}</strong><span>来自 ${escapeHtml(dashboard.users.desktopCustomers)} 个客户组织</span></div>
          <div class="metric"><span>待处理支持请求</span><strong>${escapeHtml(dashboard.users.pendingSupportTickets)}</strong><span>demo 运维队列</span></div>
        </div>
        <h2>客户组织资源</h2>
        <table>
          <thead><tr><th>客户组织</th><th>客户侧角色样例</th><th>成员</th><th>共享文献库</th></tr></thead>
          <tbody>${organizationRows}</tbody>
        </table>
        <h2>后台任务</h2>
        <ul class="stack">${runningTasks}</ul>
        <h2>近期审计</h2>
        <ul class="stack">${recentAuditEvents}</ul>
        <h2>运维数据接口</h2>
        <p><code>/v1/admin/governance-dashboard</code></p>
      </section>
    </main>
    <script>
      const form = document.getElementById("api-policy-form");
      const status = document.getElementById("api-policy-status");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const response = await fetch("/v1/admin/model-policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            defaultProvider: formData.get("defaultProvider"),
            localDirectEnabled: formData.get("localDirectEnabled") === "true",
            modelAccessMode: formData.get("modelAccessMode")
          })
        });
        const payload = await response.json();
        status.textContent = response.ok
          ? "已保存策略：" + payload.policy.policyVersion
          : "策略保存失败";
      });
    </script>
  </body>
</html>`;
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

function buildAdminGovernanceDashboardPayload(config = defaultConfig) {
  const organizationList = buildOrganizationListPayload({});
  const governance = buildOrganizationGovernancePayload({}).summary;

  return {
    dashboard: {
      name: "Liteasy Operations Governance Dashboard",
      environment: "local-demo",
      generatedAt: "2026-05-15T00:00:00Z",
      apiPolicy: {
        defaultProvider: config.defaultProvider,
        localDirectEnabled: config.localDirectEnabled,
        modelAccessMode: config.modelAccessMode,
        policyVersion: config.policyVersion
      },
      users: {
        activeUsers: 16,
        desktopCustomers: organizationList.organizations.length,
        pendingSupportTickets: 2
      },
      threeEndStatus: {
        desktop: {
          label: "客户桌面软件端",
          status: "manual-start",
          url: "http://127.0.0.1:1420/"
        },
        devCloud: {
          label: "服务器部署端",
          status: "online",
          url: "http://127.0.0.1:8787/"
        },
        adminConsole: {
          label: "内部运营与运维后台",
          status: "online",
          url: "http://127.0.0.1:8787/admin/"
        }
      },
      organizations: organizationList.organizations,
      auditQueue: governance.auditQueue,
      quota: governance.quota,
      runningTasks: governance.runningTasks,
      recentAuditEvents: governance.recentAuditEvents
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
        endpoints: availableEndpoints
      });
      return;
    }

    if (method === "GET" && (url.pathname === "/admin/" || url.pathname === "/admin")) {
      writeHtml(request, response, 200, buildAdminConsoleHtml(config));
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
      writeJson(request, response, 200, buildAdminGovernanceDashboardPayload(config));
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

function resolvePort() {
  const value = Number(process.env.LITEASY_DEV_CLOUD_PORT ?? "8787");
  return Number.isFinite(value) && value > 0 ? value : 8787;
}

async function startFromCli() {
  const port = resolvePort();
  const server = createDevCloudServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Liteasy dev cloud listening on http://127.0.0.1:${port}`);
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  void startFromCli();
}

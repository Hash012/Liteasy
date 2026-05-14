import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createDevCloudRequestHandler } from "./server.mjs";

async function invokeHandler({ body, handlerOptions, headers = {}, method, url }) {
  const chunks = body ? [Buffer.from(body)] : [];
  const request = Readable.from(chunks);
  request.headers = headers;
  request.method = method;
  request.url = url;

  let endedBody = "";
  let statusCode = 200;
  let responseHeaders = {};

  const response = {
    end(payload = "") {
      endedBody = String(payload);
    },
    writeHead(nextStatusCode, nextHeaders) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders;
    }
  };

  await createDevCloudRequestHandler(handlerOptions)(request, response);

  return {
    body: endedBody,
    headers: responseHeaders,
    json: endedBody.length > 0 ? JSON.parse(endedBody) : undefined,
    statusCode
  };
}

test("allows browser CORS preflight from the desktop dev server", async () => {
  const response = await invokeHandler({
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "content-type",
      "access-control-request-method": "POST",
      origin: "http://127.0.0.1:1420"
    },
    url: "/v1/org/summary"
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:1420");
  assert.equal(response.headers["Access-Control-Allow-Methods"], "GET,POST,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type");
});

test("returns a helpful service index from the root path", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.name, "Liteasy dev cloud");
  assert.deepEqual(response.json.endpoints, [
    "/v1/account/demo-login",
    "/v1/admin/model-policy",
    "/v1/model/generate",
    "/v1/recommendations",
    "/v1/documents/metadata-sync",
    "/v1/org/list",
    "/v1/org/summary",
    "/v1/org/governance-summary"
  ]);
});

test("returns a policy snapshot from the control plane endpoint", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/model-policy"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.json.modelAccessMode, "cloud_proxy");
  assert.equal(response.json.defaultProvider, "openai");
  assert.equal(response.json.cloudProxyEndpoint, "http://127.0.0.1:8787");
  assert.equal(response.json.policyVersion, "dev-policy-v1");
  assert.equal(response.json.syncedAt, "2026-05-14T09:30:00Z");
});

test("returns a deterministic generated answer from the model endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    url: "/v1/model/generate"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    answer: "开发云回答：BERT 的核心方法是什么？",
    execution: {
      backend: "dev_cloud",
      mode: "mock_fallback",
      provider: "mock"
    }
  });
});

test("uses the configured openai provider when an api key is available", async () => {
  let capturedInput;
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    url: "/v1/model/generate",
    handlerOptions: {
      openaiApiKey: "sk-test",
      providers: {
        openai: async (input) => {
          capturedInput = input;
          return "来自 OpenAI provider 的回答";
        }
      }
    }
  });

  assert.deepEqual(capturedInput, {
    model: "gpt-5-mini",
    prompt: "问题：BERT 的核心方法是什么？",
    provider: "openai",
    source: "cloud_proxy"
  });
  assert.deepEqual(response.json, {
    answer: "来自 OpenAI provider 的回答",
    execution: {
      backend: "dev_cloud",
      mode: "live",
      provider: "openai"
    }
  });
});

test("returns a demo account session from the account login endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      mode: "demo_login"
    }),
    url: "/v1/account/demo-login"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    session: {
      email: "researcher@liteasy.dev",
      expiresAt: "2026-05-15T09:30:00Z",
      name: "Liteasy Researcher",
      sessionId: "demo-session-1"
    }
  });
});

test("returns related recommendations for the selected document set", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      selectedDocuments: [
        {
          id: "demo-2",
          title: "BERT: Pre-training of Deep Bidirectional Transformers"
        }
      ],
      sessionId: "demo-session-1"
    }),
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    recommendations: [
      {
        id: "rec-bert-1",
        relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
        relevanceBand: "high",
        relevanceScore: 0.92,
        reason: "同样关注大规模预训练语言模型的迁移能力。",
        source: "Semantic Scholar",
        title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
      },
      {
        id: "rec-bert-2",
        relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
        relevanceBand: "medium",
        relevanceScore: 0.78,
        reason: "延续 BERT 路线，强调参数共享与效率优化。",
        source: "arXiv Watch",
        title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
      }
    ]
  });
});

test("accepts document metadata sync snapshots", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      documents: [
        {
          id: "demo-1",
          sourcePath: "fixtures/attention-is-all-you-need.pdf",
          title: "Attention Is All You Need"
        },
        {
          id: "demo-2",
          sourcePath: "fixtures/bert-pretraining.pdf",
          title: "BERT: Pre-training of Deep Bidirectional Transformers"
        }
      ],
      sessionId: "demo-session-1",
      workspaceRevision: 0
    }),
    url: "/v1/documents/metadata-sync"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    result: {
      acceptedCount: 2,
      rejectedCount: 0,
      syncId: "metadata-demo-session-1-r0",
      syncedAt: "2026-05-14T10:20:00Z"
    }
  });
});


test("returns the demo organization list", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/list"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    activeOrganizationId: "org-demo-1",
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
  });
});

test("returns a demo organization summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
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
      myRole: "研究员",
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
  });
});

test("returns a demo organization governance summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      organizationId: "org-demo-1",
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/governance-summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
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
  });
});


test("returns organization-specific governance summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      organizationId: "org-demo-2",
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/governance-summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
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
  });
});

test("returns an audit score from the model audit endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      answer: "开发云回答：BERT 的核心方法是什么？",
      citations: [
        {
          page: 7,
          paperId: "demo-2",
          snippet: "deep bidirectional representations are pre-trained"
        }
      ],
      model: "gpt-5-mini-auditor",
      provider: "openai",
      question: "BERT 的核心方法是什么？",
      retrievalConfidence: 0.86,
      source: "cloud_proxy"
    }),
    url: "/v1/model/audit"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    audit: {
      model: "gpt-5-mini-auditor",
      rationale: "开发云审计确认回答包含可追溯引用。",
      score: 0.86,
      verdict: "pass"
    }
  });
});

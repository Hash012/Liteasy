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
    headers: responseHeaders,
    json: JSON.parse(endedBody),
    statusCode
  };
}

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

import {
  generateAssistantAnswer,
  shouldRetrieveThinReadingExternalKnowledge
} from "../app/features/assistant/generateAssistantAnswer";
import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("generates cloud-proxy answers by default", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 4,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
          summary: "这篇综述把向量数据库管理系统概括为围绕向量表示、索引和查询处理组织的系统。",
          tags: ["向量数据库", "索引", "查询处理"]
        }
      ]
    },
    mode: "qa",
    question: "这篇综述如何定义向量数据库系统？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    settings
  });

  expect(result.content).toContain("云端回答：这篇综述如何定义向量数据库系统？");
  expect(result.content).toContain("demo-2 p.4");
  expect(result.audit).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "回答包含可追溯引用，且引用片段覆盖问题关键词。",
    score: 0.86,
    verdict: "pass"
  });
  expect(result.executionTrace).toEqual({
    backend: "desktop_mock",
    endpoint: "mock://cloud-proxy",
    mode: "mock",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("qa answers include evidence ui dsl without state-changing actions", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 4,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
          summary: "这篇综述把向量数据库管理系统概括为围绕向量表示、索引和查询处理组织的系统。",
          tags: ["向量数据库", "索引", "查询处理"]
        }
      ]
    },
    mode: "qa",
    question: "这篇综述如何定义向量数据库系统？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    settings
  });

  expect(result.uiDsl).toMatchObject({
    actions: [],
    dataSources: [
      expect.objectContaining({
        sourceId: "retrieval.citations"
      })
    ],
    root: {
      component: "Stack"
    },
    surface: "assistant"
  });
});

test("keeps generation on the unified cloud model path when stale local-direct settings exist", async () => {
  const store = createSettingsStore();
  const settingsWithStaleLocalDirectKeys = {
    ...store.getState(),
    "models.access_mode": "local_direct",
    "models.local_direct_enabled": true
  };

  const result = await generateAssistantAnswer({
    importedChunksByPaperId: {},
    mode: "qa",
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: settingsWithStaleLocalDirectKeys
  });

  expect(result.content).toContain("云端回答：总结这篇论文的核心方法");
  expect(result.audit.model).toBe("gpt-5-mini-auditor");
  expect(result.audit.score).toBeGreaterThanOrEqual(0.8);
  expect(result.executionTrace).toEqual({
    backend: "desktop_mock",
    endpoint: "mock://cloud-proxy",
    mode: "mock",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("uses the cloud audit endpoint after http model generation", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    auditTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          audit: {
            model: "gpt-5-mini-auditor",
            rationale: "云端审计确认回答有引用支撑。",
            score: 0.91,
            verdict: "pass"
          }
        }),
        ok: true,
        status: 200
      };
    },
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async () => ({
      json: async () => ({
        answer: "真实模型回答",
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    }),
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: store.getState()
  });

  expect(result.answer).toBe("真实模型回答");
  expect(result.audit).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "云端审计确认回答有引用支撑。",
    score: 0.91,
    verdict: "pass"
  });
  expect(requests[0].url).toBe("https://liteasy.example.com/model-proxy/v1/model/audit");
  expect(JSON.parse(requests[0].body)).toMatchObject({
    answer: "真实模型回答",
    model: "gpt-5-mini-auditor",
    provider: "openai",
    question: "总结这篇论文的核心方法",
    source: "cloud_proxy"
  });
});

test("uses the DeepSeek default model for assistant generation when provider is deepseek", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  await generateAssistantAnswer({
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "云端审计确认回答有引用支撑。",
          score: 0.91,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          answer: "DeepSeek 模型回答",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "deepseek"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: store.getState()
  });

  expect(requests[0].url).toBe("https://liteasy.example.com/model-proxy/v1/model/generate");
  expect(JSON.parse(requests[0].body)).toMatchObject({
    model: "deepseek-v4-flash",
    provider: "deepseek",
    source: "cloud_proxy"
  });
});

test("injects agent core context into qa generation prompts", async () => {
  const store = createSettingsStore();
  const session = createAgentCoreSession();
  const prepared = session.prepareTurn({
    message: "实现 Agent 核心时要注意什么？",
    mode: "qa"
  });
  if (!prepared.ok) {
    throw new Error("expected prepared agent turn");
  }
  const requests: Array<{ body: string; url: string }> = [];

  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await generateAssistantAnswer({
    agentCoreContext: prepared.turn.runtimeContext.prompt,
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "测试审计。",
          score: 0.9,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          answer: "带 Agent 上下文的回答",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "实现 Agent 核心时要注意什么？",
    selectedPapers: [],
    settings: store.getState()
  });

  const prompt = JSON.parse(requests[0].body).prompt;
  expect(prompt).toContain("Agent核心上下文");
  expect(prompt).toContain("Liteasy 学术工作台 Agent");
  expect(prompt).toContain("Memory");
  expect(prompt).toContain("Skills");
});

test("stops thin-reading generation on mock endpoints", async () => {
  const settings = createSettingsStore().getState();

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {},
    mode: "qa",
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings
  })).rejects.toThrow("真实模型链路");
});

test("stops live thin-reading before the model call when PDF text evidence is unavailable", async () => {
  const store = createSettingsStore();
  const modelTransport = vi.fn();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: { "scan-1": [] },
    mode: "qa",
    modelTransport,
    question: "生成薄读",
    selectedPapers: [{ id: "scan-1", title: "扫描版论文" }],
    settings: store.getState()
  })).rejects.toThrow("未能从《扫描版论文》提取可引用文本");

  expect(modelTransport).not.toHaveBeenCalled();
});

test("limits external retrieval to explicit beyond-paper thin-reading branches", () => {
  const baseContext = {
    artifactId: "artifact-scope",
    depth: 1,
    paperIds: ["demo-1"],
    primaryPaperTitle: "ColBERT",
    targetLanguage: "zh-CN"
  } as const;

  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "omitted_section", label: "方法细节", sectionKey: "method" }
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" }
  })).toBe(true);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    parentWithinPaperClosure: false,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  })).toBe(true);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 3,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  })).toBe(true);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 2,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  }, { maximumInternalDepth: 4 })).toBe(false);
});

test("parses thin-reading structured output from a live model request", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  let externalRetrievalCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "薄读审计通过。",
          score: 0.92,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            externalKnowledge: [],
            claims: [
              {
                evidenceIds: [evidenceId],
                status: "grounded",
                text: "ColBERT 用 MaxSim late interaction 保留细粒度匹配信号。"
              }
            ],
            omittedSections: [{ label: "实验", sectionKey: "experiment" }],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [
              {
                compatibility: 0.8,
                note: "本地待同步的理解线索。",
                relationship: "方法与问题设定"
              }
            ],
            summary: "ColBERT 的核心贡献是用 contextualized token embeddings 和 MaxSim late interaction 保留细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的核心贡献是用 contextualized token embeddings 和 MaxSim late interaction 保留细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRetrievalCalls += 1;
      throw new Error("root thin-reading must not retrieve external sources");
    }
  });

  expect(JSON.parse(requests[0].body)).toMatchObject({
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: expect.objectContaining({
        additionalProperties: false,
        type: "object"
      }),
      strict: true
    },
    provider: "openai",
    requireLive: true,
    source: "cloud_proxy"
  });
  expect(result.thinReading?.rootSeed).toMatchObject({
    evidence: {
      claims: [
        expect.objectContaining({
          status: "grounded",
          text: expect.stringContaining("MaxSim")
        })
      ],
      paperEvidenceSpans: [
        expect.objectContaining({
          page: 2,
          paperId: "demo-1",
          quote: expect.stringContaining("MaxSim")
        })
      ]
    },
    paperType: "experimental",
    summary: expect.stringContaining("MaxSim"),
    withinPaperClosure: true
  });
  expect(result.content).toContain("ColBERT 的核心贡献");
  expect(externalRetrievalCalls).toBe(0);
});

test("runs thin-reading through the DeepSeek provider without downgrading to mock data", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "DeepSeek 薄读审计通过。",
          score: 0.9,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            externalKnowledge: [],
            claims: [
              {
                evidenceIds: [evidenceId],
                status: "grounded",
                text: "ColBERT 通过 MaxSim late interaction 保留 token-level matching signals。"
              }
            ],
            omittedSections: [{ label: "消融", sectionKey: "ablation" }],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "ColBERT 的薄读核心是用 MaxSim late interaction 把 contextualized token embeddings 转化为细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的薄读核心是用 MaxSim late interaction 把 contextualized token embeddings 转化为细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "deepseek"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-deepseek",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(JSON.parse(requests[0].body)).toMatchObject({
    model: "deepseek-v4-flash",
    provider: "deepseek",
    requireLive: true,
    source: "cloud_proxy"
  });
  expect(result.executionTrace).toMatchObject({
    backend: "dev_cloud",
    mode: "live",
    provider: "deepseek"
  });
  expect(result.thinReading?.rootSeed).toMatchObject({
    paperType: "experimental",
    summary: expect.stringContaining("MaxSim"),
    withinPaperClosure: true
  });
});

test("repairs an incomplete live thin-reading trace exactly once", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "ColBERT 用 MaxSim late interaction 保留细粒度匹配信号，并降低文档编码的在线成本。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{
              evidenceIds: [evidenceId],
              status: "grounded",
              text: "MaxSim 是核心机制。"
            }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            ...(prompts.length === 1 ? {} : {
              summarySentences: [{
                evidenceIds: [evidenceId],
                externalKnowledge: [],
                status: "grounded",
                text: summary
              }]
            }),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-repair",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("确定性结构质量门");
  expect(prompts[1]).toContain("<invalid_output>");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("summarySentences 必须显式覆盖正文")]
  });
});

test("repairs a selected Chinese branch that omits an explicitly requested terminology pair", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "BERT",
        snippet: "The MLM objective enables a deep bidirectional Transformer.",
        summary: "MLM 让模型融合左右上下文。",
        tags: ["masked language modeling"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = prompts.length === 1
        ? "掩码预测让模型融合左右上下文，因而可以预训练深度双向 Transformer。"
        : "masked language modeling（掩码语言建模）让模型融合左右上下文，因而可以预训练深度双向 Transformer。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "解释 masked language modeling（掩码语言建模）如何支持双向预训练",
    selectedPapers: [{ id: "demo-1", title: "BERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-terminology-repair",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "BERT",
      source: {
        kind: "selected_text",
        excerpt: "masked language modeling（掩码语言建模）让模型融合左右上下文。"
      },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("中文选区明确要求保留“masked language modeling（掩码语言建模）”");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("中文选区明确要求保留")]
  });
});

test("stops after one failed trace repair without creating a local fallback", async () => {
  const store = createSettingsStore();
  let modelCalls = 0;
  const phases: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      modelCalls += 1;
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "这份输出始终缺少显式句级映射，因此不应被保存为看似成功的薄读结果。",
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    onProgress: (progress) => phases.push(progress.phase),
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-repair-failure",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  })).rejects.toThrow("结构质量门连续失败");

  expect(modelCalls).toBe(2);
  expect(phases).toContain("repairing_structured_output");
});

test("restricts a direct thin-reading request to its primary paper", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "薄读审计通过，但检索覆盖不足。",
          score: 0.82,
          verdict: "review"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "ColBERT 的核心贡献是用 MaxSim late interaction 保留细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的核心贡献是用 MaxSim late interaction 保留细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [
      { id: "demo-1", title: "ColBERT" },
      { id: "demo-2", title: "Missing Paper" }
    ],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-gap",
      depth: 0,
      paperIds: ["demo-1", "demo-2"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.analysis?.run.coverage.selectedPaperIds).toEqual(["demo-1"]);
  expect(result.analysis?.run.coverage.missingPaperIds).toEqual([]);
  expect(result.thinReading?.context.paperIds).toEqual(["demo-1"]);
  expect(result.thinReading?.context.primaryPaperId).toBe("demo-1");
  expect(result.thinReading?.rootSeed?.withinPaperClosure).toBe(true);
});

test("moves a deep paper-bounded branch to traceable external sources at the closure limit", async () => {
  const store = createSettingsStore();
  const externalRequests: Array<{ body: string; url: string }> = [];
  const progressSummaries: string[] = [];
  let modelPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    onProgress: (progress) => progressSummaries.push(progress.summary),
    modelTransport: async (request) => {
      modelPrompt = String(JSON.parse(request.body).prompt);
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: ["openalex:W42"],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "后续研究把 late interaction 扩展到更高效的多向量检索。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: ["openalex:W42"],
              status: "weak",
              text: "后续研究把 late interaction 扩展到更高效的多向量检索。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-external",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "MaxSim late interaction 的 token-level matching 细节" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async (request) => {
      externalRequests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({
          provider: "openalex",
          query: "ColBERT 后续研究",
          retrieval: {
            attempts: 2,
            id: "artifact-thin-external:cached-query",
            reused: true,
            status: "completed"
          },
          sources: [{
            abstract: "An efficient multi-vector retrieval method.",
            authors: ["A. Author"],
            doi: "https://doi.org/10.1000/follow-up",
            id: "openalex:W42",
            provider: "openalex",
            relation: "topic_search",
            relevance: 0.86,
            retrievalQuery: "ColBERT 后续研究",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "Efficient Multi-vector Retrieval",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          status: "available"
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toHaveLength(1);
  expect(progressSummaries).toContain("正在复用已验证的外部文献来源");
  expect(JSON.parse(externalRequests[0].body)).toMatchObject({
    targetPaperIdentity: {
      kind: "local_paper_id",
      value: "demo-1"
    }
  });
  expect(externalRequests[0].url).toContain("/v1/research/external-knowledge");
  expect(modelPrompt).toContain("openalex:W42");
  expect(modelPrompt).toContain("Efficient Multi-vector Retrieval");
  expect(result.thinReading?.rootSeed.evidence.externalSources?.[0]).toMatchObject({
    id: "openalex:W42",
    url: "https://openalex.org/W42"
  });
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
});

test("stops beyond-paper generation when external retrieval returns no sources", async () => {
  const store = createSettingsStore();
  let modelCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async () => {
      modelCalls += 1;
      throw new Error("model should not be called");
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-empty-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  })).rejects.toThrow("闭包外生成已停止");
  expect(modelCalls).toBe(0);
});

import {
  generateAssistantAnswer,
  planThinReadingInterpretation,
  prioritizeThinReadingGenerationSources,
  shouldRetrieveThinReadingExternalKnowledge
} from "../app/features/assistant/generateAssistantAnswer";
import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("prioritizes verified citation edges over unselected topic-search sources for generation", () => {
  const sources = [
    {
      abstract: "A graph-linked paper.", authors: [], id: "openalex:W1", provider: "openalex" as const,
      relation: "cites_target" as const, relevance: 0.9, retrievalQuery: "BERT", sourceId: "W1",
      sourceRecordUrl: "https://openalex.org/W1", title: "Graph source", url: "https://openalex.org/W1"
    },
    {
      abstract: "A topic result.", authors: [], id: "openalex:W2", provider: "openalex" as const,
      relation: "topic_search" as const, relevance: 0.7, retrievalQuery: "BERT", sourceId: "W2",
      sourceRecordUrl: "https://openalex.org/W2", title: "Topic source", url: "https://openalex.org/W2"
    }
  ];
  const context = {
    artifactId: "artifact-external-priority",
    depth: 1,
    paperIds: ["paper-1"],
    primaryPaperId: "paper-1",
    source: { kind: "selected_text" as const, excerpt: "external relation" },
    targetLanguage: "en-US"
  };

  expect(prioritizeThinReadingGenerationSources({ context, sources }).map((source) => source.id)).toEqual([
    "openalex:W1"
  ]);
  expect(prioritizeThinReadingGenerationSources({
    context: {
      ...context,
      source: { ...context.source, externalSourceIds: ["openalex:W2"] }
    },
    sources
  }).map((source) => source.id)).toEqual(["openalex:W1", "openalex:W2"]);
});

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

test("retrieves external literature only for a concrete interpretation gap or beyond-paper request", () => {
  const baseContext = {
    artifactId: "artifact-scope",
    depth: 1,
    paperIds: ["demo-1"],
    primaryPaperTitle: "ColBERT",
    targetLanguage: "zh-CN"
  } as const;

  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 0,
    source: { kind: "root_overview" }
  })).toBe(false);

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
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 2,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  }, { maximumInternalDepth: 4 })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 1,
    source: {
      externalSourceIds: ["openalex:W42"],
      kind: "selected_text",
      excerpt: "A follow-up study"
    }
  }, { maximumInternalDepth: 4 })).toBe(true);
});

test("plans why/how/what explanations from the user prompt and retrieves only for missing support", () => {
  const baseContext = {
    artifactId: "artifact-interpretation-plan",
    depth: 1,
    paperIds: ["paper-1"],
    primaryPaperTitle: "Target Paper",
    source: { kind: "selected_text" as const, excerpt: "核心结论", prompt: "为什么会得到这个结论？" },
    targetLanguage: "zh-CN"
  };
  const plan = planThinReadingInterpretation({
    context: baseContext,
    prepared: {
      evidence: [{ summary: "论文报告了最终结果。", quote: "The final result is reported.", terms: ["result"] }]
    }
  });

  expect(plan).toMatchObject({
    externalKnowledgeNeeded: true,
    intent: "why",
    requestedDepth: "standard"
  });
  expect(plan.gap).toContain("为什么");
  expect(plan.discourseMoves.join(" ")).toContain("因果");
  expect(shouldRetrieveThinReadingExternalKnowledge({ ...baseContext, interpretationPlan: plan })).toBe(true);
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
      throw new Error("external literature is temporarily unavailable");
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

test("uses a live evidence plan to narrow a large thin-reading evidence matrix", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  let plannedEvidenceIds: string[] = [];
  let reviewAttempts = 0;
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
      "demo-1": Array.from({ length: 8 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Planning Paper",
        snippet: `Evidence passage ${index + 1} describes the method and result.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method", `signal-${index + 1}`]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      if (prompt.includes("证据规划 Agent")) {
        plannedEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)].slice(0, 3).map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({ focus: ["核心机制", "主要结果"], selectedEvidenceIds: plannedEvidenceIds }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮观察已覆盖核心机制、主要结果与必要限定。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        const sentenceId = prompt.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewAttempts === 1
              ? {
                  reason: "该句将三段证据共同支撑的范围表述得过强，需要压缩为可直接验证的判断。",
                  unsupportedSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : { reason: "每个句子均由指定证据直接支持。", unsupportedSentenceIds: [], verdict: "pass" }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "该方法的核心机制由三段关键证据共同支撑，并给出主要结果。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [plannedEvidenceIds[0]], status: "grounded", text: "核心机制得到关键证据支持。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: plannedEvidenceIds,
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{ evidenceIds: [plannedEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-evidence-plan",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Planning Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(6);
  expect(prompts[1]).toContain("证据观察 Agent");
  expect(prompts[2]).not.toContain("Evidence summary 8");
  expect(prompts[3]).toContain("证据复核 Agent");
  expect(prompts[4]).toContain("薄读证据复核未通过");
  expect(prompts[4]).toContain("只允许修改这些失败句及依赖它们的 claims");
  expect(prompts[4]).toContain("改写为绑定 evidence 直接蕴含的最小命题");
  expect(prompts[4]).toContain("Evidence passage 1 describes the method and result");
  expect(prompts[4]).toContain("必须原样保留的已通过句");
  expect(prompts[5]).toContain("证据复核 Agent");
  expect(result.thinReading?.evidencePlan).toMatchObject({ selectedEvidenceIds: plannedEvidenceIds });
  expect(result.thinReading?.evidenceLoop).toMatchObject({
    rounds: [expect.objectContaining({ round: 1 })],
    stopReason: "observation_sufficient"
  });
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual(plannedEvidenceIds);
});

test("retries a cross-layer evidence ID with the current planning allowlist", async () => {
  const store = createSettingsStore();
  const planningPrompts: string[] = [];
  let planningAttempts = 0;
  let currentEvidenceIds: string[] = [];
  const staleEvidenceId = "evidence-previous-layer-7f2e";
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
      "demo-1": Array.from({ length: 8 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Branch Planning Paper",
        snippet: `Branch evidence passage ${index + 1} describes the method mechanism.`,
        summary: `Branch evidence summary ${index + 1} explains the method mechanism.`,
        tags: ["branch", `signal-${index + 1}`]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据规划 Agent")) {
        planningPrompts.push(prompt);
        planningAttempts += 1;
        currentEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\] p\.\d+/g)]
          .slice(0, 2)
          .map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["核心机制"],
              selectedEvidenceIds: planningAttempts === 1 ? [staleEvidenceId] : currentEvidenceIds
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮观察已覆盖本次下钻所需的直接证据。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "每个句子均由本轮指定证据直接支持。",
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "该段方法的核心机制由本轮多条直接论文证据共同支持。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [currentEvidenceIds[0]], status: "grounded", text: "该段方法由直接证据支持。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: currentEvidenceIds,
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{ evidenceIds: [currentEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "解释选中段落的机制",
    selectedPapers: [{ id: "demo-1", title: "Branch Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-stale-evidence-plan",
      depth: 1,
      paperIds: ["demo-1"],
      parentClaims: [{
        evidenceIds: [staleEvidenceId],
        id: "thin-reading-claim-previous-layer",
        status: "grounded",
        text: "上一层给出了待细化的机制判断。"
      }],
      parentEvidenceSpans: [{
        chunkId: "demo-1:previous-layer:chunk-1",
        confidence: 0.9,
        id: staleEvidenceId,
        page: 2,
        paperId: "demo-1",
        quote: "Previous-layer evidence quote."
      }],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Branch Planning Paper",
      source: {
        evidenceIds: [staleEvidenceId],
        excerpt: "待细化的机制判断",
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    }
  });

  expect(planningAttempts).toBe(2);
  expect(planningPrompts).toHaveLength(2);
  expect(planningPrompts[0]).not.toContain(staleEvidenceId);
  expect(planningPrompts[0]).not.toContain("thin-reading-claim-previous-layer");
  expect(planningPrompts[0]).not.toContain("demo-1:previous-layer:chunk-1");
  expect(planningPrompts[1]).toContain("上一轮证据规划返回了本轮目录之外的 evidence ID");
  expect(planningPrompts[1]).toContain("本轮唯一允许的 evidence ID");
  expect(planningPrompts[1]).not.toContain(staleEvidenceId);
  expect(result.thinReading?.evidencePlan?.selectedEvidenceIds).toEqual(currentEvidenceIds);
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual(currentEvidenceIds);
});

test("executes a bounded second evidence-tool round after observing a concrete gap", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  store.apply({ intent: "update_setting", target: "models.cloud_proxy_endpoint", value: "https://liteasy.example.com/model-proxy" });
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({ json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }), ok: true, status: 200 }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 8 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Tool Loop Paper",
        snippet: index === 5 ? "Page six contains the MaxSim limitation." : `Page ${index + 1} contains method context.`,
        summary: index === 5 ? "MaxSim limitation." : `Method context ${index + 1}.`,
        tags: index === 5 ? ["MaxSim", "limitation"] : ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据规划 Agent")) {
        const firstPageId = prompt.match(/\[(evidence-[^\]]+)\] p\.1/)?.[1] ?? "";
        return {
          json: async () => ({ answer: JSON.stringify({ focus: ["核心机制"], pageRequests: [], searchQueries: [], selectedEvidenceIds: [firstPageId] }), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true, status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        const pageSixId = prompt.match(/\[(evidence-[^\]]+)\] p\.6/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "continue",
              focus: ["MaxSim 限制"],
              pageRequests: [6],
              reason: "首轮只覆盖核心机制，缺少会改变结论边界的 MaxSim 限制证据。",
              searchQueries: ["MaxSim limitation"],
              selectedEvidenceIds: [pageSixId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify({ reason: "每句均有直接证据。", unsupportedSentenceIds: [], verdict: "pass" }), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true, status: 200
        };
      }
      generationPrompts.push(prompt);
      const ids = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)].map((match) => match[1]);
      const selectedId = ids.at(-1) ?? ids[0];
      const summary = "该方法的限制需要结合第六页的 MaxSim evidence 阅读。";
      return {
        json: async () => ({
          answer: JSON.stringify({ claims: [{ evidenceIds: [selectedId], status: "grounded", text: "第六页给出 MaxSim limitation。" }], externalKnowledge: [], omittedSections: [], paperEvidence: [selectedId], paperType: "experimental", recommendations: [], summary, summarySentences: [{ evidenceIds: [selectedId], externalKnowledge: [], status: "grounded", text: summary }], withinPaperClosure: true }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }), ok: true, status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Tool Loop Paper" }],
    settings: store.getState(),
    thinReadingContext: { artifactId: "artifact-tool-loop", depth: 0, paperIds: ["demo-1"], primaryPaperId: "demo-1", primaryPaperTitle: "Tool Loop Paper", source: { kind: "root_overview" }, targetLanguage: "zh-CN" }
  });

  expect(generationPrompts).toHaveLength(1);
  expect(generationPrompts[0]).toContain("Page six contains the MaxSim limitation.");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceToolCalls).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "search", query: "MaxSim limitation" }),
    expect.objectContaining({ kind: "view", pages: [6] })
  ]));
  expect(result.thinReading?.evidenceLoop).toMatchObject({
    rounds: [
      expect.objectContaining({ round: 1 }),
      expect.objectContaining({ round: 2, searchQueries: ["MaxSim limitation"] })
    ],
    stopReason: "maximum_rounds_reached"
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
  expect(prompts[1]).toContain("只有该条目中的全部 source relation 都是 cited_by_target 或 cites_target");
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
  const externalRequests: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const progressSummaries: string[] = [];
  let modelRequestBody = "";
  let modelPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "thin_reading.openalex_api_key",
    value: "user-openalex-key"
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
      modelRequestBody = request.body;
      modelPrompt = String(JSON.parse(request.body).prompt);
      if (modelPrompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "外部句由绑定来源摘要直接支持。",
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
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
      externalRequests.push({ body: request.body, headers: request.headers, url: request.url });
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
  expect(externalRequests[0].headers).toMatchObject({ "X-OpenAlex-Api-Key": "user-openalex-key" });
  expect(externalRequests[0].body).not.toContain("user-openalex-key");
  expect(modelRequestBody).not.toContain("user-openalex-key");
  expect(modelPrompt).toContain("openalex:W42");
  expect(modelPrompt).toContain("Efficient Multi-vector Retrieval");
  expect(result.thinReading?.rootSeed.evidence.externalSources?.[0]).toMatchObject({
    id: "openalex:W42",
    url: "https://openalex.org/W42"
  });
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
});

test("keeps a selected canonical external source available when a follow-up lookup is empty", async () => {
  const store = createSettingsStore();
  let modelPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const selectedSource = {
    abstract: "An already verified follow-up study.",
    authors: ["A. Author"],
    id: "openalex:W42",
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.86,
    retrievalQuery: "ColBERT follow-up",
    sourceRecordUrl: "https://openalex.org/W42",
    sourceId: "W42",
    title: "Efficient Multi-vector Retrieval",
    url: "https://openalex.org/W42",
    year: 2025
  };

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
        summary: "ColBERT uses MaxSim.",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      modelPrompt = String(JSON.parse(request.body).prompt);
      if (modelPrompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "外部句由绑定来源摘要直接支持。",
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [selectedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "这条已验证的后续研究线索聚焦更高效的多向量检索，并延续了当前阅读路径。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [selectedSource.id],
              status: "weak",
              text: "这条已验证的后续研究线索聚焦更高效的多向量检索，并延续了当前阅读路径。"
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
      artifactId: "artifact-thin-selected-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      selectedExternalSources: [selectedSource],
      source: {
        externalSourceIds: [selectedSource.id],
        excerpt: selectedSource.title,
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "ColBERT follow-up", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  expect(modelPrompt).toContain(selectedSource.id);
  expect(modelPrompt).toContain(selectedSource.title);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([selectedSource]);
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
  })).rejects.toThrow("未检索到可信、可追溯的外部文献");
  expect(modelCalls).toBe(0);
});

import {
  buildThinReadingExternalQueryPlan,
  generateAssistantAnswer,
  planThinReadingInterpretation,
  prioritizeThinReadingGenerationSources,
  shouldRetrieveThinReadingExternalKnowledge
} from "../app/features/assistant/generateAssistantAnswer";
import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";
import { createSettingsStore } from "../app/features/settings/settings.store";

const liveModelTransport = async () => ({
  json: async () => ({
    answer: "云端回答：这篇综述如何定义向量数据库系统？ [demo-2 p.4]",
    execution: {
      backend: "test_cloud",
      mode: "live",
      provider: "openai"
    }
  }),
  ok: true,
  status: 200
});

const liveAuditTransport = async () => ({
  json: async () => ({
    audit: {
      model: "gpt-5-mini-auditor",
      rationale: "回答包含可追溯引用，且引用片段覆盖问题关键词。",
      score: 0.86,
      verdict: "pass"
    }
  }),
  ok: true,
  status: 200
});

function evidenceReviewPropositions(
  prompt: string,
  unsupportedSentenceIds: readonly string[] = []
) {
  const unsupported = new Set(unsupportedSentenceIds);
  return [...prompt.matchAll(/^- id=(thin-reading-sentence-[^;\s]+);[^\n]*?text=(.+)$/gm)]
    .map((match) => {
      let proposition = match[2];
      try {
        proposition = String(JSON.parse(match[2]));
      } catch {
        // The prompt builder normally emits JSON strings; retain the captured text in malformed fixtures.
      }
      return {
        proposition: proposition.slice(0, 300),
        sentenceId: match[1],
        verdict: unsupported.has(match[1]) ? "partial" as const : "supported" as const
      };
    });
}

function evidenceReviewRootOrientation(prompt: string) {
  if (!prompt.includes("root_orientation_review_required=true")) {
    return null;
  }
  const paperType = prompt.match(/候选主要论文类型：([a-z_]+)。/)?.[1] ?? "unknown";
  return {
    coreIdea: "covered" as const,
    fieldPosition: "evidence_unavailable" as const,
    paperPanorama: "covered" as const,
    paperType,
    paperTypeVerdict: paperType === "unknown" ? "ambiguous" as const : "supported" as const,
    reason: "首页围绕候选论文的主要贡献形成聚焦总述；当前测试证据没有额外的领域位置材料。",
    retentionVerdict: "focused" as const,
    verdict: "pass" as const
  };
}

function passingEvidenceReview(prompt: string) {
  return {
    propositionVerdicts: evidenceReviewPropositions(prompt),
    reason: "每个正文句均由其绑定证据直接支持。",
    rootOrientation: evidenceReviewRootOrientation(prompt),
    unsupportedSentenceIds: [],
    verdict: "pass" as const
  };
}

test("prioritizes verified citation edges while retaining bounded topic-search context", () => {
  const sources = [
    {
      abstract: "A graph-linked paper.", authors: [], id: "openalex:W1", provider: "openalex" as const,
      relation: "cites_target" as const, relevance: 0.9, retrievalQuery: "BERT", sourceId: "W1",
      sourceRecordUrl: "https://openalex.org/W1", title: "Graph source", url: "https://openalex.org/W1"
    },
    {
      abstract: "A traceable topic result with reviewable source content.", authors: [], id: "openalex:W2", provider: "openalex" as const,
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
    "openalex:W1",
    "openalex:W2"
  ]);
  expect(prioritizeThinReadingGenerationSources({
    context: {
      ...context,
      source: { ...context.source, externalSourceIds: ["openalex:W2"] }
    },
    sources
  }).map((source) => source.id)).toEqual(["openalex:W1", "openalex:W2"]);
});

test("keeps the generation context bounded after retrieving a larger candidate pool", () => {
  const sources = Array.from({ length: 12 }, (_, index) => ({
    abstract: `This abstract directly supports retrieval candidate ${index}.`,
    authors: [],
    id: `openalex:W${index + 10}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 1 - index / 20,
    retrievalQuery: "retrieval evaluation",
    sourceId: `W${index + 10}`,
    sourceRecordUrl: `https://openalex.org/W${index + 10}`,
    title: `Retrieval candidate ${index}`,
    url: `https://openalex.org/W${index + 10}`
  }));

  const selected = prioritizeThinReadingGenerationSources({
    context: {
      artifactId: "artifact-candidate-pool",
      depth: 1,
      paperIds: ["paper-1"],
      primaryPaperId: "paper-1",
      source: { kind: "selected_text" as const, excerpt: "retrieval evaluation" },
      targetLanguage: "en-US"
    },
    sources
  });

  expect(selected).toHaveLength(8);
  expect(selected.map((source) => source.id)).toEqual(sources.slice(0, 8).map((source) => source.id));
});

test("builds bounded support, challenge, and context queries for external evidence", () => {
  const plan = buildThinReadingExternalQueryPlan({
    artifactId: "artifact-query-plan",
    depth: 2,
    paperIds: ["paper-1"],
    primaryPaperId: "paper-1",
    primaryPaperTitle: "A Retrieval Study",
    source: { kind: "selected_text", excerpt: "late interaction efficiency" },
    targetLanguage: "en-US"
  });

  expect(plan.map((item) => item.intent)).toEqual(["support", "challenge", "context"]);
  expect(plan.every((item) => item.query.length <= 500)).toBe(true);
  expect(plan.find((item) => item.intent === "challenge")?.query).toContain("conflicting results");
});

test("generates cloud-proxy answers through an injected live transport", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    auditTransport: liveAuditTransport,
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
    modelTransport: liveModelTransport,
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
    backend: "http_service",
    endpoint: "http://127.0.0.1:8787",
    mode: "live",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("qa answers include evidence ui dsl without state-changing actions", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    auditTransport: liveAuditTransport,
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
    modelTransport: liveModelTransport,
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
    auditTransport: liveAuditTransport,
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: liveModelTransport,
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: settingsWithStaleLocalDirectKeys
  });

  expect(result.content).toContain("云端回答：");
  expect(result.audit.model).toBe("gpt-5-mini-auditor");
  expect(result.audit.score).toBeGreaterThanOrEqual(0.8);
  expect(result.executionTrace).toEqual({
    backend: "http_service",
    endpoint: "http://127.0.0.1:8787",
    mode: "live",
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

test("rejects non-http model endpoints before thin-reading generation", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "mock://cloud-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses late interaction for efficient retrieval.",
        summary: "ColBERT 使用后期交互进行高效检索。",
        tags: ["late interaction"]
      }]
    },
    mode: "qa",
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState()
  })).rejects.toThrow("模型云代理必须使用 HTTPS");
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
  })).rejects.toThrow("《扫描版论文》没有可用的本地文本索引");

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
    learningGoals: ["selected_focus", "parent_continuity"],
    readingMode: "exploration",
    requestedDepth: "standard"
  });
  expect(plan.gap).toContain("为什么");
  expect(plan.discourseMoves.join(" ")).toContain("因果");
  expect(shouldRetrieveThinReadingExternalKnowledge({ ...baseContext, interpretationPlan: plan })).toBe(true);
});

test("plans a root overview as reader orientation rather than a generic mixed explanation", () => {
  const plan = planThinReadingInterpretation({
    context: {
      artifactId: "artifact-root-orientation",
      depth: 0,
      paperIds: ["paper-1"],
      primaryPaperTitle: "Target Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    prepared: {
      evidence: [{
        summary: "论文提出核心方法，并与既有路线比较其适用边界。",
        quote: "We introduce the central method and compare it with prior approaches.",
        terms: ["method", "prior work", "limitation"]
      }]
    }
  });

  expect(plan).toMatchObject({
    externalKnowledgeNeeded: false,
    learningGoals: ["core_idea", "paper_panorama", "field_position"],
    readingMode: "orientation"
  });
  expect(plan.discourseMoves.join(" ")).toContain("核心思想");
  expect(plan.discourseMoves.join(" ")).toContain("全景");
  expect(plan.discourseMoves.join(" ")).toContain("领域位置");
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
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.9,
              kind: "method",
              label: "Late interaction",
              searchQuery: "late interaction passage retrieval",
              summarySentenceIndex: 0,
              text: "MaxSim late interaction"
            }],
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
      return {
        json: async () => ({
          sources: [{
            abstract: "This study evaluates late interaction for efficient passage retrieval with fine-grained token matching.",
            authors: ["Ada Scholar"],
            id: "openalex:W123",
            provider: "openalex",
            relation: "related",
            relevance: 0.83,
            retrievalQuery: "late interaction passage retrieval",
            sourceId: "W123",
            sourceRecordUrl: "https://openalex.org/W123",
            title: "Late Interaction Retrieval",
            url: "https://example.org/late-interaction"
          }]
        }),
        ok: true,
        status: 200
      };
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
      ],
      anchors: [
        expect.objectContaining({
          externalSourceIds: ["openalex:W123"],
          quality: {
            citationProvenance: 0,
            evidenceAttention: 1,
            evidenceCoverage: 0.25,
            reason: "核心方法 · 1 条证据",
            score: 0.5775
          },
          text: "MaxSim late interaction"
        })
      ]
    },
    paperType: "experimental",
    summary: expect.stringContaining("MaxSim"),
    withinPaperClosure: true
  });
  expect(result.content).toContain("ColBERT 的核心贡献");
  expect(externalRetrievalCalls).toBe(1);
});

test("persists ranked anchor quality when every per-anchor search fails", async () => {
  const store = createSettingsStore();
  let externalRetrievalCalls = 0;
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
        snippet: "ColBERT uses MaxSim late interaction for fine-grained retrieval.",
        summary: "ColBERT 使用 MaxSim late interaction。",
        tags: ["ColBERT", "MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "ColBERT 使用 MaxSim late interaction 保留细粒度匹配信号。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.8,
              kind: "concept",
              label: "MaxSim",
              searchQuery: "MaxSim late interaction",
              summarySentenceIndex: 0,
              text: "MaxSim late interaction"
            }],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
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
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-anchor-search-failure",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRetrievalCalls += 1;
      return {
        json: async () => ({ message: "search unavailable" }),
        ok: false,
        status: 503
      };
    }
  });

  expect(externalRetrievalCalls).toBe(1);
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({
      externalSourceIds: [],
      quality: {
        citationProvenance: 0,
        evidenceAttention: 1,
        evidenceCoverage: 0.25,
        reason: "核心概念 · 1 条证据",
        score: expect.any(Number)
      }
    })
  ]);
  expect(result.thinReading?.rootSeed.evidence.anchors?.[0]?.quality?.score).toBeCloseTo(0.5425, 8);
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
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
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

test("rewrites a truthful but unfocused homepage after the root orientation audit", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
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
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT separately encodes query and document token embeddings, applies late interaction with MaxSim, and evaluates effectiveness and latency.",
        summary: "ColBERT 分别编码查询和文档词元，以 MaxSim 实现 late interaction，并同时评测效果与延迟。",
        tags: ["ColBERT", "late interaction", "MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        const rootOrientation = reviewAttempts === 1
          ? {
              coreIdea: "covered" as const,
              fieldPosition: "evidence_unavailable" as const,
              paperPanorama: "missing" as const,
              paperType: "experimental" as const,
              paperTypeVerdict: "supported" as const,
              reason: "正文命题都真实，但只给出方法名，没有建立问题、机制与决定性评测边界之间的关系。",
              retentionVerdict: "unfocused" as const,
              verdict: "fail" as const
            }
          : evidenceReviewRootOrientation(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify({
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个正文句均由其绑定证据直接支持。",
              rootOrientation,
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }

      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = generationPrompts.length === 1
        ? "ColBERT 提出 late interaction（后期交互）并使用 MaxSim。"
        : "ColBERT 分别编码查询与文档词元，再用 MaxSim 完成 late interaction（后期交互），从而把核心机制与效果、延迟两类评测边界连成完整主轴。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
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
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-root-orientation-repair",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("薄读首页方向质量门");
  expect(generationPrompts[1]).toContain("本轮属于首页方向质量门后的定向修复");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("薄读首页方向质量门未通过")]
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceReview?.rootOrientation).toMatchObject({
    coreIdea: "covered",
    paperPanorama: "covered",
    retentionVerdict: "focused",
    verdict: "pass"
  });
});

test("allows a third homepage generation only for a sentence-targeted evidence repair", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  const generationPrompts: string[] = [];
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
        snippet: "ColBERT separately encodes query and document embeddings and applies MaxSim late interaction.",
        summary: "ColBERT 分别编码查询和文档向量，并应用 MaxSim late interaction。",
        tags: ["ColBERT", "MaxSim", "late interaction"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        const sentenceId = prompt.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? "";
        const unsupportedSentenceIds = reviewAttempts < 3 ? [sentenceId] : [];
        return {
          json: async () => ({
            answer: JSON.stringify({
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: reviewAttempts < 3
                ? "该句仍加入了绑定证据没有明示的离线预编码能力，必须继续收窄。"
                : "第三轮正文已收窄为绑定证据直接支持的机制。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: reviewAttempts < 3 ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }

      generationAttempts += 1;
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = generationAttempts < 3
        ? "ColBERT 通过文档离线预编码和 MaxSim late interaction 提升检索效率。"
        : "ColBERT 分别编码查询和文档向量，再应用 MaxSim late interaction 完成相关性计算。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
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
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-third-root-evidence-repair",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(3);
  expect(reviewAttempts).toBe(3);
  expect(generationPrompts[2]).toContain("必须原样保留的已通过句");
  expect(generationPrompts[2]).toContain("失败句绑定的论文原文证据");
  expect(result.thinReading?.rootSeed.summary).not.toContain("离线预编码");
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 3, repaired: true });
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
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
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
        const isFormatRetry = prompt.includes("上一轮证据复核输出未通过结构校验");
        if (!isFormatRetry) {
          reviewAttempts += 1;
        }
        const sentenceId = prompt.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(isFormatRetry
              ? {
                  propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
                  reason: "该句将三段证据共同支撑的范围表述得过强，需要压缩为可直接验证的判断。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : reviewAttempts === 1
                ? {
                    reason: "首次复核故意遗漏逐句命题判定，用于验证结构重试。",
                    unsupportedSentenceIds: [sentenceId],
                    verdict: "fail"
                  }
                : {
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "通过",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
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

  expect(prompts).toHaveLength(7);
  expect(prompts[1]).toContain("证据观察 Agent");
  expect(prompts[2]).not.toContain("Evidence summary 8");
  expect(prompts[3]).toContain("证据复核 Agent");
  expect(prompts[4]).toContain("上一轮证据复核输出未通过结构校验");
  expect(prompts[4]).toContain("propositionVerdicts 必须覆盖每个实际 sentence ID");
  expect(prompts[4]).toContain("unsupportedSentenceIds 为空时 verdict=pass");
  expect(prompts[4]).not.toContain("reason 必须是 8-420");
  expect(prompts[5]).toContain("薄读证据复核未通过");
  expect(prompts[5]).toContain("只允许修改这些失败句及依赖它们的 claims");
  expect(prompts[5]).toContain("改写为绑定 evidence 直接蕴含的最小命题");
  expect(prompts[5]).toContain("Evidence passage 1 describes the method and result");
  expect(prompts[5]).toContain("必须原样保留的已通过句");
  expect(prompts[5]).toContain("最终修复检查清单");
  expect(prompts[5]).toContain("不得使用其他句子或相邻段落的未绑定证据");
  expect(prompts[5]).toContain("同步重建 summary、summarySentences 与相关 claims");
  expect(prompts[5].lastIndexOf("最终修复检查清单")).toBeGreaterThan(prompts[5].lastIndexOf("</invalid_output>"));
  expect(prompts[6]).toContain("证据复核 Agent");
  expect(result.thinReading?.evidencePlan).toMatchObject({ selectedEvidenceIds: plannedEvidenceIds });
  expect(result.thinReading?.evidenceLoop).toMatchObject({
    rounds: [expect.objectContaining({ round: 1 })],
    stopReason: "observation_sufficient"
  });
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual(plannedEvidenceIds);
});

test("continues thin reading with a bounded deterministic evidence scope when planning API fails", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const generationPrompts: string[] = [];
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 24 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Resilient Planning Paper",
        snippet: `Evidence passage ${index + 1} describes the method.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        return {
          json: async () => ({ error: "temporary planning failure" }),
          ok: false,
          status: 502
        };
      }
      const prompt = String(body.prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "";
      const summary = "该论文的方法由确定性范围内的证据直接支持，并清楚界定了核心机制与结论边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
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
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Resilient Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-planning-fallback",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Resilient Planning Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.thinReading?.evidencePlan).toBeUndefined();
  expect(result.thinReading?.rootSeed.summary).toContain("确定性范围");
  expect(generationPrompts[0]).toContain("Evidence summary 18");
  expect(generationPrompts[0]).not.toContain("Evidence summary 19");
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
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
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
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个句子均由本轮指定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
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
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
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
          json: async () => ({ answer: JSON.stringify({ propositionVerdicts: evidenceReviewPropositions(prompt), reason: "每句均有直接证据。", rootOrientation: evidenceReviewRootOrientation(prompt), unsupportedSentenceIds: [], verdict: "pass" }), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
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
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
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

test("accepts a DeepSeek mechanism anchor without entering structured-output repair", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  const outputSchemas: Array<Record<string, unknown>> = [];
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
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "DeepDendrite",
        snippet: "Dendritic hierarchical scheduling accelerates parallel Hines solves on GPUs.",
        summary: "DHS 加速 GPU 上的并行 Hines 求解。",
        tags: ["DHS", "Hines"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as {
        model?: string;
        outputFormat?: { schema?: Record<string, unknown> };
        prompt: string;
        provider?: string;
      };
      if (body.prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(body.prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
      expect(body).toMatchObject({ model: "deepseek-v4-flash", provider: "deepseek" });
      prompts.push(String(body.prompt));
      if (body.outputFormat?.schema) {
        outputSchemas.push(body.outputFormat.schema);
      }
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "dendritic hierarchical scheduling（树突分层调度）通过分层组织并行 Hines 求解来提高 GPU 利用率。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.95,
              kind: "mechanism",
              label: "核心调度机制",
              searchQuery: "dendritic hierarchical scheduling parallel Hines solve",
              summarySentenceIndex: 0,
              text: "dendritic hierarchical scheduling（树突分层调度）"
            }],
            claims: [{
              evidenceIds: [evidenceId],
              status: "grounded",
              text: "DHS 通过分层调度加速并行 Hines 求解。"
            }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "DeepDendrite" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-deepseek-mechanism",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "DeepDendrite",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(1);
  expect(outputSchemas).toHaveLength(1);
  expect(JSON.stringify(outputSchemas[0])).toContain("mechanism");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 1,
    repaired: false,
    repairReasons: []
  });
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({ kind: "mechanism", label: "核心调度机制" })
  ]);
});

test("repairs only invalid anchor spans and quarantines a repeated failure without losing the body", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
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
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: "CoreNEURON removes general data structures such as Node, Section, and Object to reduce memory use.",
        summary: "CoreNEURON 去除通用数据结构以降低内存使用。",
        tags: ["CoreNEURON", "data structures"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { prompt: string };
      if (body.prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(body.prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
      prompts.push(body.prompt);
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "CoreNEURON 是面向神经元仿真的计算库。它支持在线和离线两种执行工作流。测试报告了内存与时间开销下降。内存改进源于去除 NEURON 的通用数据结构，如 Node、Section、Object。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.95,
              kind: "concept",
              label: "核心库",
              searchQuery: "CoreNEURON library design",
              summarySentenceIndex: 0,
              text: "CoreNEURON"
            }, {
              importance: 0.8,
              kind: "mechanism",
              label: "工作流模式",
              searchQuery: "CoreNEURON online offline mode",
              summarySentenceIndex: 1,
              text: "在线和离线两种执行工作流"
            }, {
              importance: 0.9,
              kind: "result",
              label: "性能提升",
              searchQuery: "CoreNEURON memory time reduction",
              summarySentenceIndex: 2,
              text: "内存与时间开销下降"
            }, {
              importance: 0.75,
              kind: "mechanism",
              label: "优化机制",
              searchQuery: "CoreNEURON data structure optimization",
              summarySentenceIndex: 3,
              text: "数据结构优化"
            }],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: "CoreNEURON 去除通用数据结构以降低内存开销。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary,
            summarySentences: summary.match(/[^。]+。/g)?.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-anchor-quarantine",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("本轮只修复 anchors");
  expect(prompts[1]).toContain("text 是正文高亮 span");
  expect(prompts[1]).toContain("label 才是概括性名称");
  expect(result.thinReading?.rootSeed.summary).toContain("通用数据结构");
  expect(result.thinReading?.rootSeed.evidence.anchors).toHaveLength(3);
  expect(result.thinReading?.rootSeed.evidence.anchors?.some((anchor) => (
    anchor.text === "数据结构优化"
  ))).toBe(false);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
  expect(result.thinReading?.qualityGate.repairReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("薄读锚点必须逐字对应"),
    expect.stringContaining("已隔离无效薄读锚点")
  ]));
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
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
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

test("quarantines paper sentences that remain partially supported after targeted repair", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
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
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: `CoreNEURON directly accesses models built by NEURON. Tests report four-fold lower memory use. Evidence passage ${index + 1}.`,
        summary: `CoreNEURON 接收 NEURON 模型，测试报告内存减少 4 倍；证据片段 ${index + 1}。`,
        tags: ["CoreNEURON", "memory"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      if (prompt.includes("证据规划 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["CoreNEURON 机制与结果"],
              selectedEvidenceIds: [evidenceId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
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
              reason: "当前证据已覆盖机制与结果。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("你是 Liteasy 薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const unsupportedSentenceIds = [
          "这种优化提升性能",
          "重新组织内存布局和代码生成",
          "显著优于 NEURON"
        ].map((text) => (
          prompt.split("\n").find((line) => line.includes(text))
            ?.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? ""
        ));
        return {
          json: async () => ({
            answer: JSON.stringify({
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: "三处命题分别扩张了性能因果、实现细节和统计显著性；其余句子有直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: "fail"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      const sentences = [
        "CoreNEURON 通过直接内存访问接收 NEURON 构建的模型。",
        "这种优化提升性能。",
        "测试报告内存减少 4 倍。",
        "系统重新组织内存布局和代码生成。",
        "结果显著优于 NEURON。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.9,
              kind: "concept",
              label: "CoreNEURON",
              searchQuery: "CoreNEURON",
              summarySentenceIndex: 0,
              text: "CoreNEURON"
            }, {
              importance: 0.7,
              kind: "result",
              label: "性能提升",
              searchQuery: "CoreNEURON performance",
              summarySentenceIndex: 1,
              text: "提升性能"
            }],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join("").replace("这种优化提升性能。", "这种优化提升性能；"),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-partial-quarantine",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "selected_text", excerpt: "CoreNEURON 的机制与性能结果" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(2);
  expect(result.thinReading?.rootSeed.summary).not.toContain("提升性能");
  expect(result.thinReading?.rootSeed.summary).not.toContain("代码生成");
  expect(result.thinReading?.rootSeed.summary).not.toContain("显著优于");
  expect(result.thinReading?.rootSeed.evidence.summarySentences).toHaveLength(2);
  expect(result.thinReading?.rootSeed.evidence.claims).toHaveLength(2);
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({ text: "CoreNEURON" })
  ]);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
  expect(result.thinReading?.qualityGate.repairReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("已隔离证据复核仍未通过的正文句")
  ]));
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
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
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
              propositionVerdicts: evidenceReviewPropositions(modelPrompt),
              reason: "外部句由绑定来源摘要直接支持。",
              rootOrientation: evidenceReviewRootOrientation(modelPrompt),
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

  expect(externalRequests).toHaveLength(3);
  expect(progressSummaries).toContain("正在复用已验证的外部文献来源");
  const externalBodies = externalRequests.map((request) => JSON.parse(request.body));
  expect(externalBodies[0]).toMatchObject({
    limit: 32,
    targetPaperIdentity: {
      kind: "local_paper_id",
      value: "demo-1"
    }
  });
  expect(externalBodies.slice(1).map((body) => body.limit)).toEqual([12, 12]);
  expect(externalBodies.map((body) => body.includeArxiv)).toEqual([true, false, false]);
  expect(externalBodies.map((body) => body.query)).toEqual(expect.arrayContaining([
    expect.stringContaining("conflicting results"),
    expect.stringContaining("follow-up research")
  ]));
  expect(externalRequests.every((request) => request.url.includes("/v1/research/external-knowledge"))).toBe(true);
  expect(externalRequests.every((request) => request.headers["Content-Type"] === "application/json")).toBe(true);
  expect(externalRequests.every((request) => !request.body.includes("api_key"))).toBe(true);
  expect(modelRequestBody).not.toContain("api_key");
  expect(modelPrompt).toContain("openalex:W42");
  expect(modelPrompt).toContain("Efficient Multi-vector Retrieval");
  expect(result.thinReading?.rootSeed.evidence.externalSources?.[0]).toMatchObject({
    evidenceBasis: "abstract",
    id: "openalex:W42",
    retrievalIntents: ["support", "challenge", "context"],
    url: "https://openalex.org/W42"
  });
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
});

test("drops an unsupported external-only sentence when external expansion was automatic", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
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
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: "CoreNEURON accelerates the Cortex model by two to four times.",
        summary: "CoreNEURON 将 Cortex 模型加速 2-4 倍。",
        tags: ["CoreNEURON", "Cortex"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const externalSentenceLine = prompt.split("\n").find((line) => line.includes("external=openalex:W42"));
        const unsupportedSentenceId = externalSentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewAttempts === 1
              ? {
                  propositionVerdicts: evidenceReviewPropositions(prompt, [unsupportedSentenceId]),
                  reason: "外部来源摘要没有提及可塑性，不能支持该句。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [unsupportedSentenceId],
                  verdict: "fail"
                }
              : {
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "删除无支持的外部句后，其余句均由论文证据直接支持。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const paperSentence = "论文证据显示，CoreNEURON 将 Cortex 模型加速 2-4 倍。";
      const externalSentence = "主题检索提示可塑性与学习理论相关，但本文不深入探讨。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: paperSentence }],
            externalKnowledge: ["openalex:W42"],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "benchmark",
            recommendations: [],
            summary: `${paperSentence}${externalSentence}`,
            summarySentences: [
              { evidenceIds: [evidenceId], externalKnowledge: [], status: "grounded", text: paperSentence },
              { evidenceIds: [], externalKnowledge: ["openalex:W42"], status: "weak", text: externalSentence }
            ],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-fallback",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "selected_text", excerpt: "Cortex 模型性能" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({
        provider: "openalex",
        query: "CoreNEURON Cortex 模型性能",
        sources: [{
          abstract: "A general theory of efficient learning systems.",
          authors: ["A. Author"],
          id: "openalex:W42",
          provider: "openalex",
          relation: "topic_search",
          relevance: 0.61,
          retrievalQuery: "CoreNEURON Cortex 模型性能",
          sourceRecordUrl: "https://openalex.org/W42",
          sourceId: "W42",
          title: "Efficient Learning Systems",
          url: "https://openalex.org/W42",
          year: 2024
        }],
        status: "available"
      }),
      ok: true,
      status: 200
    })
  });

  expect(generationPrompts).toHaveLength(1);
  expect(reviewAttempts).toBe(2);
  expect(result.thinReading?.rootSeed.summary).not.toContain("可塑性");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([]);
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(true);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 1, repaired: true });
});

test("replaces one unsupported required external source with a focused retrieval", async () => {
  const store = createSettingsStore();
  const externalQueries: string[] = [];
  const generationPrompts: string[] = [];
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const externalSource = (id: string, title: string, abstract: string) => ({
    abstract,
    authors: ["A. Author"],
    id: `openalex:${id}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: `https://openalex.org/${id}`,
    sourceId: id,
    title,
    url: `https://openalex.org/${id}`,
    year: 2025
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
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const sourceId = reviewAttempts === 1 ? "openalex:W1" : "openalex:W2";
        const sentenceLine = prompt.split("\n").find((line) => line.includes(`external=${sourceId}`));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewAttempts === 1
              ? {
                  propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
                  reason: "初始外部来源只涉及相邻主题，不能支持后续研究的具体命题。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : {
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "替代来源摘要直接支持该外部句。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      generationPrompts.push(prompt);
      const sourceId = generationAttempts === 1 ? "openalex:W1" : "openalex:W2";
      const text = generationAttempts === 1
        ? "初始线索讨论相邻主题，但不能据此断言后续研究的具体改进。"
        : "后续研究将 late interaction 扩展为更高效的多向量检索。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [sourceId],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: text,
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [sourceId],
              status: "weak",
              text
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-recovery",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async (request) => {
      externalQueries.push(JSON.parse(request.body).query);
      const source = externalQueries.length <= 3
        ? externalSource("W1", "Adjacent Retrieval Topic", "A study about a neighboring retrieval topic.")
        : externalSource("W2", "Efficient Multi-vector Retrieval", "This follow-up study extends late interaction with a more efficient multi-vector retrieval method.");
      return {
        json: async () => ({ provider: "openalex", query: "external", sources: [source], status: "available" }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalQueries).toHaveLength(4);
  expect(externalQueries[3]).toContain("direct evidence for the requested claim");
  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("openalex:W2");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual(["openalex:W2"]);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
});

test("returns a closure boundary when a required external claim has no replacement evidence", async () => {
  const store = createSettingsStore();
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const unsupportedSource = {
    abstract: "A study about a neighboring retrieval topic.",
    authors: ["A. Author"],
    id: "openalex:W1",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: "https://openalex.org/W1",
    sourceId: "W1",
    title: "Adjacent Retrieval Topic",
    url: "https://openalex.org/W1",
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
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        const sentenceLine = prompt.split("\n").find((line) => line.includes("external=openalex:W1"));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
              reason: "该来源只涉及相邻主题，不能直接支持所问外部命题。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [sentenceId],
              verdict: "fail"
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
            externalKnowledge: ["openalex:W1"],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: ["openalex:W1"],
              status: "weak",
              text: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-boundary",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      return {
        json: async () => ({ provider: "openalex", query: "external", sources: [unsupportedSource], status: "available" }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(4);
  expect(result.thinReading?.rootSeed.summary).toContain("未找到能直接支持");
  expect(result.thinReading?.rootSeed.closureState).toBe("near_boundary");
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(true);
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([]);
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
              propositionVerdicts: evidenceReviewPropositions(modelPrompt),
              reason: "外部句由绑定来源摘要直接支持。",
              rootOrientation: evidenceReviewRootOrientation(modelPrompt),
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

test("runs at most two responsibility Subagents for a genuinely large thin-reading load", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  let selectedEvidenceIds: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-large": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "paper-large",
        paperTitle: "Large Architecture Paper",
        snippet: `Component ${index + 1} sends state to the next processing stage under a bounded condition. `.repeat(140),
        summary: `Component ${index + 1} participates in the architecture pipeline.`,
        tags: ["architecture", "pipeline"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      if (prompt.includes("证据规划 Agent")) {
        selectedEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)]
          .slice(0, 3)
          .map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["核心组件关系"],
              pageRequests: [],
              searchQueries: [],
              selectedEvidenceIds
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
              reason: "首轮已经覆盖核心组件、处理顺序和边界。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("关系梳理 Subagent")) {
        return {
          json: async () => ({
            answer: `组件按处理顺序连接〔${selectedEvidenceIds[0]}〕。`,
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("视觉编辑 Subagent")) {
        return {
          json: async () => ({
            answer: `适合用流程图呈现，但必须回到〔${selectedEvidenceIds[0]}〕核验。`,
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个句子都由绑定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "系统把多个组件按依赖顺序连接起来，让状态沿处理流水线逐步传递，并保留证据给出的条件边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [selectedEvidenceIds[0]], status: "grounded", text: "组件按依赖顺序连接。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [selectedEvidenceIds[0]],
            paperType: "systems",
            recommendedFigures: [],
            summary,
            summarySentences: [{ evidenceIds: [selectedEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            visualizationIntent: {
              candidateModalities: ["semantic_graph"],
              evidenceIds: [selectedEvidenceIds[0]],
              expectedLearningGain: "high",
              purpose: "show_process",
              requestedBy: "automatic"
            },
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "paper-large", title: "Large Architecture Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-large-workload",
      depth: 0,
      paperIds: ["paper-large"],
      primaryPaperId: "paper-large",
      primaryPaperTitle: "Large Architecture Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts.filter((prompt) => prompt.includes("关系梳理 Subagent"))).toHaveLength(1);
  expect(prompts.filter((prompt) => prompt.includes("视觉编辑 Subagent"))).toHaveLength(1);
  expect(prompts.find((prompt) => prompt.includes("你是 Liteasy 薄读 Agent"))).toContain("Subagent 私有工作记录");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.workload).toMatchObject({
    maxConcurrency: 2,
    strategy: "parallel"
  });
});

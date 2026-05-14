import { generateAssistantAnswer } from "../app/features/assistant/generateAssistantAnswer";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("generates cloud-proxy answers by default", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 8,
          paperId: "demo-2",
          paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          snippet: "masked language model and next sentence prediction are used for pre-training",
          summary: "预训练目标主要包括掩码语言模型和下一句预测。",
          tags: ["预训练目标"]
        }
      ]
    },
    mode: "qa",
    question: "这篇论文的预训练目标是什么？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ],
    settings
  });

  expect(result.content).toContain("云端回答：这篇论文的预训练目标是什么？");
  expect(result.content).toContain("demo-2 p.8");
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

test("generates local-direct answers when policy and mode both allow it", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.local_direct_enabled",
    value: true
  });
  store.apply({
    intent: "update_setting",
    target: "models.access_mode",
    value: "local_direct"
  });

  const result = await generateAssistantAnswer({
    importedChunksByPaperId: {},
    mode: "qa",
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "Attention Is All You Need"
      }
    ],
    settings: store.getState()
  });

  expect(result.content).toContain("本地直连回答：总结这篇论文的核心方法");
  expect(result.audit.model).toBe("gpt-5-mini-auditor");
  expect(result.audit.score).toBeGreaterThanOrEqual(0.8);
  expect(result.executionTrace).toEqual({
    backend: "desktop_mock",
    endpoint: "mock://local-direct",
    mode: "mock",
    provider: "openai",
    source: "local_direct"
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
        title: "Attention Is All You Need"
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

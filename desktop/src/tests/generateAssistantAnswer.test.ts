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
  expect(result.executionTrace).toEqual({
    backend: "desktop_mock",
    endpoint: "mock://local-direct",
    mode: "mock",
    provider: "openai",
    source: "local_direct"
  });
});

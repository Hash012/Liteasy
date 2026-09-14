import { afterEach, expect, test, vi } from "vitest";
import { generateAdaptiveThinReading } from "../app/features/thin-reading/adaptiveThinReading";
import { prepareMultiPaperAnalysis } from "../app/features/paper-analysis/multiPaperAnalysisWorkflow";
import { putDurableEntry, loadDurableEntries } from "../app/features/persistence/durableJsonStore";
import type { GenerateAnswerInput, ModelGenerationResult } from "../app/features/models/modelGateway";

afterEach(() => { vi.useRealTimers(); });
function fixture(mode: "fast" | "rigorous" = "fast") {
  const paper = { id: "paper", title: "Test paper", sourcePath: "C:\\Library\\paper.pdf" };
  return {
    context: { artifactId: crypto.randomUUID(), source: { kind: "root_overview" as const }, paperIds: [paper.id], depth: 0, targetLanguage: "zh-CN", generationMode: mode },
    prepared: prepareMultiPaperAnalysis({ selectedPapers: [paper], importedChunksByPaperId: { paper: [{ paperId: paper.id, paperTitle: paper.title, page: 2, snippet: "The experiment compares memory usage and throughput.", summary: "Experiment", tags: [] }] }, query: "experiment" }),
    model: "original-model", provider: "original-provider"
  };
}
function result(summary: string): ModelGenerationResult { return { answer: JSON.stringify({ summary, paperEvidence: [], omittedSections: [] }), trace: { backend: "http_service", mode: "live", provider: "test", source: "direct_api", endpoint: "https://example.com" } }; }

test("requests a compact layer without truncating valid returned Markdown", async () => {
  const summary = "对实验方法的完整讲解。".repeat(200);
  const generateAnswer = vi.fn(async (_request: GenerateAnswerInput) => result(summary));
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toBe(summary);
  expect(reading.rootSeed.evidence.readingReview).toMatchObject({ mode: "fast", status: "unverified" });
  expect(generateAnswer).toHaveBeenCalledOnce();
  const request = generateAnswer.mock.calls[0][0];
  expect(request.prompt).toContain("350–600");
  expect(request.prompt).toContain("[[[术语或解释主题]]]");
  expect(request.prompt).toContain("同一次回答");
});

test("rigorous mode checks the current layer in one request without a separate review", async () => {
  const generateAnswer = vi.fn(async (_request: GenerateAnswerInput) => result("已完成的正文"));
  const reading = await generateAdaptiveThinReading({ ...fixture("rigorous"), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toBe("已完成的正文");
  expect(reading.rootSeed.evidence.readingReview?.note).toContain("不确定项随正文说明");
  expect(generateAnswer).toHaveBeenCalledOnce();
  expect(generateAnswer.mock.calls[0][0].prompt).toContain("无需额外规划、审阅报告");
});

test("interrupt saves draft and resume uses the original model, mode, evidence and prompt", async () => {
  const input = fixture();
  const abort = new AbortController();
  const generateAnswer = vi.fn(async (request: GenerateAnswerInput) => {
    request.onDelta?.("草稿", '{"summary":"已经解释的方法');
    request.onReasoningDelta?.("公开推理", "公开推理");
    abort.abort(new Error("interrupted"));
    request.signal?.throwIfAborted();
    return result("unreachable");
  });
  await expect(generateAdaptiveThinReading({ ...input, gateway: { generateAnswer }, signal: abort.signal })).rejects.toThrow("interrupted");
  const saved = Object.values(await loadDurableEntries("thin-reading")).find((item: any) => item.context.artifactId === input.context.artifactId) as any;
  expect(saved).toMatchObject({ partial: '{"summary":"已经解释的方法', reasoning: "公开推理", model: "original-model" });
  const resumed = vi.fn(async (request: GenerateAnswerInput) => ({ ...result("继续完成的正文"), answer: JSON.stringify({ summary: "继续完成的正文", paperEvidence: [input.prepared.evidence[0].id], omittedSections: [] }) }));
  const next = fixture("rigorous");
  const reading = await generateAdaptiveThinReading({ ...next, context: { ...input.context, generationMode: "rigorous" }, model: "changed-model", gateway: { generateAnswer: resumed } });
  expect(resumed).toHaveBeenCalledOnce();
  expect(resumed.mock.calls[0][0]).toMatchObject({ model: "original-model", provider: "original-provider", prompt: expect.stringContaining(saved.prompt) });
  expect(resumed.mock.calls[0][0].prompt).toContain("已经解释的方法");
  expect(resumed.mock.calls[0][0].prompt).toContain("公开推理");
  expect(reading.rootSeed.evidence.paperEvidenceSpans?.[0].quote).toBe(input.prepared.evidence[0].quote);
  expect(reading.rootSeed.evidence.readingReview?.mode).toBe("fast");
});

test("restarting after generation reuses the saved body without another model call", async () => {
  const input = fixture("rigorous");
  await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: async () => result("saved body") } });
  const resume = vi.fn(async () => result("unused"));
  const reading = await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: resume } });
  expect(resume).not.toHaveBeenCalled();
  expect(reading.rootSeed.summary).toBe("saved body");
});

test("temporary network failure retries with a bounded delay", async () => {
  vi.useFakeTimers();
  const generateAnswer = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(result("recovered"));
  const pending = generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  await vi.runAllTimersAsync();
  expect((await pending).rootSeed.summary).toBe("recovered");
  expect(generateAnswer).toHaveBeenCalledTimes(2);
});

test("malformed structured output is kept as a draft, never shown as raw JSON", async () => {
  const input = fixture();
  await expect(generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: async () => ({ ...result(""), answer: '{"summary":"unfinished' }) } })).rejects.toThrow("结构未完成");
  const generateAnswer = vi.fn(async () => result("repaired"));
  expect((await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer } })).rootSeed.summary).toBe("repaired");
  expect(generateAnswer).toHaveBeenCalledOnce();
});

test("checkpoint maps preserve independent entries written concurrently", async () => {
  await Promise.all([putDurableEntry("thin-reading", "independent-a", { draft: "a" }), putDurableEntry("thin-reading", "independent-b", { draft: "b" })]);
  const persisted = JSON.parse(localStorage.getItem("liteasy.checkpoints.v1:thin-reading")!);
  expect(persisted["independent-a"]).toEqual({ draft: "a" });
  expect(persisted["independent-b"]).toEqual({ draft: "b" });
});

test("a null structured result can be retried instead of trapping the task in a cached failure", async () => {
  const input = fixture();
  await expect(generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: async () => ({ ...result(""), answer: "null" }) } })).rejects.toThrow("未返回可阅读的正文");
  expect((await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: async () => result("有效正文") } })).rootSeed.summary).toBe("有效正文");
});

test("repairs missing summary with grounded prose using the saved public reasoning", async () => {
  const generateAnswer = vi.fn(async (request: GenerateAnswerInput) => {
    if (request.outputFormat) {
      request.onReasoningDelta?.("analysis", "需要核对内存和吞吐量实验。");
      return result("");
    }
    expect(request.prompt).toContain("需要核对内存和吞吐量实验。");
    expect(request.prompt).toContain("The experiment compares memory usage and throughput.");
    expect(request.prompt).toContain("只返回 Markdown 正文");
    return { ...result(""), answer: "## 实验\n论文比较了内存占用和吞吐量，具体幅度需查阅原文。" };
  });
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  expect(generateAnswer).toHaveBeenCalledTimes(2);
  expect(reading.rootSeed.summary).toContain("## 实验");
  expect(reading.rootSeed.summary).not.toContain("需要核对内存");
  expect(reading.qualityGate).toMatchObject({ repaired: true, attempts: 2 });
});

test.each(["模型未返回文本，请检查所选模型是否支持对话。", "模型输出达到长度上限，请缩小生成范围后重试。"])("finishes a reasoning-only response after %s", async (message) => {
  const generateAnswer = vi.fn().mockImplementationOnce(async (request: GenerateAnswerInput) => {
    request.onReasoningDelta?.("analysis", "已有公开分析");
    throw new Error(message);
  }).mockResolvedValueOnce({ ...result(""), answer: "已完成的讲解" });
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toBe("已完成的讲解");
  expect(generateAnswer).toHaveBeenCalledTimes(2);
  expect(generateAnswer.mock.calls[1][0].outputFormat).toBeUndefined();
});

test("bounds repair attempts and resumes in prose mode without replaying the failed format", async () => {
  const input = fixture();
  const generateAnswer = vi.fn(async (request: GenerateAnswerInput) => {
    request.onReasoningDelta?.("analysis", "实验分析参考");
    return result("");
  });
  await expect(generateAdaptiveThinReading({ ...input, gateway: { generateAnswer } })).rejects.toThrow("未返回可阅读的正文");
  expect(generateAnswer).toHaveBeenCalledTimes(2);
  const resume = vi.fn(async () => ({ ...result(""), answer: "恢复后的正文" }));
  const reading = await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: resume } });
  expect(reading.rootSeed.summary).toBe("恢复后的正文");
  expect(resume).toHaveBeenCalledOnce();
  expect(resume.mock.calls[0]?.[0]).toMatchObject({ prompt: expect.stringContaining("实验分析参考") });
  expect(resume.mock.calls[0]?.[0]).not.toHaveProperty("outputFormat");
});

test("cancellation does not start a body repair even after reasoning arrived", async () => {
  const abort = new AbortController();
  const generateAnswer = vi.fn(async (request: GenerateAnswerInput) => {
    request.onReasoningDelta?.("analysis", "公开分析");
    abort.abort(new Error("cancelled"));
    throw abort.signal.reason;
  });
  await expect(generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer }, signal: abort.signal })).rejects.toThrow("cancelled");
  expect(generateAnswer).toHaveBeenCalledOnce();
});


test("a deeper layer focuses on the clicked term and bounds ancestor context", async () => {
  const input = fixture();
  const generateAnswer = vi.fn(async (_request: GenerateAnswerInput) => result("[[[注意力]]] 只解释当前问题。"));
  await generateAdaptiveThinReading({ ...input, context: { ...input.context, depth: 3,
    source: { kind: "selected_text", excerpt: "注意力" },
    ancestorSummaries: Array.from({ length: 20 }, (_, index) => ({ nodeId: `node-${index}`, title: "ancestor", summary: `ancestor-${index} ` + "history ".repeat(500) }))
  }, gateway: { generateAnswer } });
  const prompt = generateAnswer.mock.calls[0][0].prompt;
  expect(prompt).toContain("200–400");
  expect(prompt).toContain("注意力");
  expect(prompt).toContain("ancestor-19");
  expect(prompt).not.toContain("ancestor-0");
  expect(prompt.length).toBeLessThan(6000);
});

test("prose recovery accepts a triple-bracket link at the beginning of Markdown", async () => {
  const generateAnswer = vi.fn().mockResolvedValueOnce(result(""))
    .mockResolvedValueOnce({ ...result(""), answer: "[[[注意力机制]]] 可以按需展开。\n\n$$ E = mc^2 $$" });
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toContain("[[[注意力机制]]]");
  expect(reading.rootSeed.summary).toContain("$$ E = mc^2 $$");
});

test.each([
  "[原文](https://example.test) 中解释了 [[[注意力]]]。",
  "[1](https://example.test) 中解释了 [[[注意力]]]。",
  "```\nx = 1\n```",
  "```\nx = 1\n```\n\n[[[注意力]]] 按需展开。",
  "```markdown\n## 方法\n[[[注意力]]] 按需展开。\n```",
  "```mermaid\nflowchart LR\nA-->B\n```"
])("accepts Markdown syntax at the beginning of a prose response: %s", async (answer) => {
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer: async () => ({ ...result(""), answer }) } });
  expect(reading.rootSeed.summary).not.toBe("");
  expect(reading.rootSeed.summary).not.toMatch(/^```markdown/);
});

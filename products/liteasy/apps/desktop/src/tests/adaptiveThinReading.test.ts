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

test("fast mode accepts long grounded prose without a second quality gate", async () => {
  const summary = "对实验方法的完整讲解。".repeat(200);
  const generateAnswer = vi.fn(async () => result(summary));
  const reading = await generateAdaptiveThinReading({ ...fixture(), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toBe(summary);
  expect(reading.rootSeed.evidence.readingReview).toMatchObject({ mode: "fast", status: "unverified" });
  expect(generateAnswer).toHaveBeenCalledOnce();
  expect(JSON.stringify(generateAnswer.mock.calls)).not.toMatch(/minLength|maxLength|minItems|maxItems/);
});

test("rigorous mode retains the body if advisory review fails", async () => {
  const generateAnswer = vi.fn().mockResolvedValueOnce(result("已完成的正文")).mockRejectedValueOnce(new Error("review unavailable"));
  const reading = await generateAdaptiveThinReading({ ...fixture("rigorous"), gateway: { generateAnswer } });
  expect(reading.rootSeed.summary).toBe("已完成的正文");
  expect(reading.rootSeed.evidence.readingReview?.note).toContain("补充核验暂未完成");
  expect(generateAnswer).toHaveBeenCalledTimes(2);
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
  expect(reading.rootSeed.evidence.paperEvidenceSpans?.[0].quote).toBe(input.prepared.evidence[0].quote);
  expect(reading.rootSeed.evidence.readingReview?.mode).toBe("fast");
});

test("restarting after generation reuses its result and only finishes the review", async () => {
  const input = fixture("rigorous");
  const abort = new AbortController();
  const generateAnswer = vi.fn().mockResolvedValueOnce(result("saved body")).mockImplementationOnce(() => { abort.abort(new Error("interrupt review")); throw abort.signal.reason; });
  await expect(generateAdaptiveThinReading({ ...input, gateway: { generateAnswer }, signal: abort.signal })).rejects.toThrow("interrupt review");
  const resume = vi.fn(async () => ({ ...result("unused"), answer: "核对实验条件。" }));
  const reading = await generateAdaptiveThinReading({ ...input, gateway: { generateAnswer: resume } });
  expect(resume).toHaveBeenCalledOnce();
  expect(reading.rootSeed.summary).toBe("saved body");
  expect(reading.rootSeed.evidence.readingReview?.note).toBe("核对实验条件。");
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

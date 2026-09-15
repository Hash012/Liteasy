import { describe, expect, test, vi } from "vitest";
import { runArtifactAuthoring } from "../app/features/artifact-workflow/runArtifactAuthoring";
import type { ModelGenerationResult } from "../app/features/models/modelGateway";

const slides = { version: "liteasy.authored-artifact/v1", kind: "slides", title: "汇报", slides: [
  { id: "slide-one", title: "观点", markdown: "正文", notes: "备注", evidenceIds: ["evidence-one"] }
] };
const trace: ModelGenerationResult["trace"] = { backend: "http_service", endpoint: "https://example.org/test-model", mode: "live", provider: "openai", source: "cloud_proxy" };
const generated = (value: unknown): ModelGenerationResult => ({ answer: typeof value === "string" ? value : JSON.stringify(value), trace });
const input = { artifactType: "ppt" as const, instruction: "生成汇报", source: "论文原文", evidenceIds: ["evidence-one"] };

describe("runArtifactAuthoring", () => {
  test("requests actual structured slide content through a live, strict schema generation", async () => {
    const generate = vi.fn(async () => generated(slides));
    const result = await runArtifactAuthoring({ ...input, generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      requireLive: true,
      outputFormat: expect.objectContaining({ name: "liteasy_authored_artifact", strict: true, schema: expect.objectContaining({ type: "object", additionalProperties: false }) }),
      prompt: expect.stringContaining("<source-data>\n论文原文\n</source-data>")
    }));
    expect(result).toEqual({ authoredArtifact: slides, message: "# 汇报\n\n---\n\n## 观点\n\n正文\n\n### 演讲备注\n\n备注", trace });
    expect(result.message).not.toContain("已保存");
  });

  test("allows exactly one formatting repair and passes the failure reason without the previous giant output", async () => {
    const generate = vi.fn().mockResolvedValueOnce(generated("not valid JSON ".repeat(1000))).mockResolvedValueOnce(generated(slides));
    expect((await runArtifactAuthoring({ ...input, generate })).authoredArtifact).toEqual(slides);
    expect(generate).toHaveBeenCalledTimes(2);
    const second = generate.mock.calls[1][0];
    expect(second.prompt).toContain("上一次输出未通过校验：不是有效 JSON");
    expect(second.prompt).not.toContain("not valid JSON");
  });

  test("does not report success after repeated invalid content, unsupported kind or invented sources", async () => {
    const invalid = [
      { ...slides, slides: [{ ...slides.slides[0], evidenceIds: ["invented"] }] },
      { version: "liteasy.authored-artifact/v1", kind: "outline", title: "错误产物", nodes: [{ id: "root", parentId: null, label: "观点", evidenceIds: [] }] },
      "只有制作建议，没有实际幻灯片"
    ];
    for (const value of invalid) {
      const generate = vi.fn(async () => generated(value));
      await expect(runArtifactAuthoring({ ...input, generate })).rejects.toThrow("尚未保存");
      expect(generate).toHaveBeenCalledTimes(2);
    }
  });

  test("rejects oversized sources before calling a model and oversized responses without repair", async () => {
    const generate = vi.fn(async () => generated("x".repeat(600_001)));
    await expect(runArtifactAuthoring({ ...input, source: "x".repeat(180_001), generate })).rejects.toThrow("超出本次生成预算");
    expect(generate).not.toHaveBeenCalled();
    await expect(runArtifactAuthoring({ ...input, generate })).rejects.toThrow("生成内容过大");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("honors cancellation before generation and while waiting without publishing or retrying", async () => {
    const before = new AbortController();
    before.abort();
    const generate = vi.fn(async () => generated(slides));
    await expect(runArtifactAuthoring({ ...input, generate, signal: before.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
    const during = new AbortController();
    const running = vi.fn(async () => { during.abort(); return generated(slides); });
    await expect(runArtifactAuthoring({ ...input, generate: running, signal: during.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(running).toHaveBeenCalledTimes(1);
  });

  test("propagates transport errors without treating network failure as a formatting retry", async () => {
    const failure = new Error("测试连接中断");
    const generate = vi.fn().mockRejectedValue(failure);
    await expect(runArtifactAuthoring({ ...input, generate })).rejects.toBe(failure);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("returns a real outline when that artifact type was requested", async () => {
    const outline = { version: "liteasy.authored-artifact/v1", kind: "outline", title: "大纲", nodes: [
      { id: "root", parentId: null, label: "主要结论", evidenceIds: ["evidence-one"] }
    ] };
    const generate = vi.fn(async () => generated(outline));
    const result = await runArtifactAuthoring({ ...input, artifactType: "tree", generate });
    expect(result.authoredArtifact).toEqual(outline);
    expect(result.message).toBe("# 大纲\n\n- 主要结论");
  });
});

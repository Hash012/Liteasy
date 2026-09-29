import { afterEach, expect, test, vi } from "vitest";
import { createGuideGenerator, guidePrompt, parseGuideBatch, type GuideItem, type GuideRequest } from "../app/features/paper-reading/literatureGuide";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";
import { emptyProfileMemory } from "../app/features/profile/profileMemory";
import { useLiteratureGuideController } from "../app/controllers/useLiteratureGuideController";
import { renderHook } from "@testing-library/react";

const input: GuideRequest = { title: "Cicada", abstract: "Transaction processing", mode: "auto", pages: [{ page: 1, text: "alpha beta gamma delta repeated repeated" }], signal: new AbortController().signal };
const item = (patch: Partial<GuideItem> = {}): GuideItem => ({ page: 1, quote: "alpha", title: "关键设计", explanation: "先分配逻辑时间，再验证事务，减少提交冲突。", category: "insight", ...patch });
const answer = (items: GuideItem[], level = "balanced") => JSON.stringify({ level, items });
afterEach(() => localStorage.clear());

test("admits only unique quotes on the provided page; rejects fabricated text, repeated terms and duplicate marks", () => {
  const result = parseGuideBatch(answer([item(), item(), item({ quote: "repeated" }), item({ quote: "invented" }), item({ page: 2 }), item({ quote: "beta" })]), input);
  expect(result.items.map((entry) => entry.quote)).toEqual(["alpha", "beta"]);
  expect(result.rejected).toBe(4);
});

test("explicit modes and manual preferences override the model level, enforce density and exclude basic terms in advanced mode", () => {
  const items = ["alpha", "beta", "gamma", "delta"].map((quote) => item({ quote }));
  expect(parseGuideBatch(answer(items, "advanced"), { ...input, mode: "detailed" }).items).toHaveLength(4);
  expect(parseGuideBatch(answer(items, "detailed"), input, "balanced").items).toHaveLength(3);
  const advanced = parseGuideBatch(answer([item({ category: "term" }), ...items.slice(1)], "detailed"), { ...input, mode: "advanced" });
  expect(advanced.level).toBe("advanced"); expect(advanced.items.map((entry) => entry.quote)).toEqual(["beta", "gamma"]);
});

test("rejects malformed or oversized model results with a concise message", () => {
  for (const value of ["prose", answer([item({ explanation: "x".repeat(601) })]), answer([item({ page: 0 })])]) {
    expect(() => parseGuideBatch(value, input)).toThrow("模型返回的讲解格式不完整");
  }
  expect(parseGuideBatch("```json\n" + answer([]) + "\n```", input).items).toEqual([]);
});

test("sends bounded source text through the configured live gateway and defaults unknown familiarity to balanced", async () => {
  const transport = vi.fn(async (_request: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({
    answer: answer([item()], "advanced"), execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
  }) }));
  const generate = createGuideGenerator(() => createSettingsStore().getState(), () => ({ level: "auto", context: "" }), transport);
  expect((await generate(input)).level).toBe("balanced");
  const request = JSON.parse(transport.mock.calls[0][0].body);
  expect(request.prompt).toContain(input.pages[0].text);
  expect(request.prompt).toContain('"level":"balanced"');
  expect(request.outputFormat.name).toBe("liteasy_literature_guide");
  expect(transport.mock.calls[0][0].signal).toBe(input.signal);
});

test("auto uses domain familiarity while explicit modes omit personal context", () => {
  const profile = { level: "auto" as const, context: "我熟悉数据库，但刚开始学习机器学习" };
  expect(guidePrompt(input, profile)).toContain(profile.context);
  expect(guidePrompt({ ...input, mode: "detailed" }, profile)).not.toContain(profile.context);
});

test("honors the configured context cap before sending source text to the provider", async () => {
  const settings = { ...createSettingsStore().getState(), "assistant.context_window": "4096" };
  const transport = vi.fn();
  const generate = createGuideGenerator(() => settings, () => ({ level: "balanced", context: "" }), transport);
  await expect(generate({ ...input, pages: [{ page: 1, text: "研究术语".repeat(3000) }] })).rejects.toThrow("上下文预算");
  expect(transport).not.toHaveBeenCalled();
});

test("sampling opt-out excludes conversation memories while manual reading preferences still apply", async () => {
  const memory = emptyProfileMemory();
  memory.entries.push({ id: "familiarity", field: "research_familiarity", value: "我熟悉事务处理", source: "conversation", updatedAt: new Date().toISOString() });
  const transport = vi.fn(async (_request: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({
    answer: answer([item()], "detailed"), execution: { mode: "live", provider: "openai" }
  }) }));
  const { result, rerender } = renderHook(({ enabled }) => useLiteratureGuideController({ getSettings: () => createSettingsStore().getState(),
    profile: { ...defaultAcademicProfile, researchFamiliarity: "我熟悉分布式系统", readingExplanation: "advanced" }, memory, samplingEnabled: enabled, transport }), { initialProps: { enabled: false } });
  expect((await result.current(input)).level).toBe("advanced");
  expect(JSON.parse(transport.mock.calls[0][0].body).prompt).toContain("我熟悉分布式系统");
  expect(JSON.parse(transport.mock.calls[0][0].body).prompt).not.toContain("我熟悉事务处理");
  rerender({ enabled: true }); await result.current(input);
  expect(JSON.parse(transport.mock.calls[1][0].body).prompt).toContain("我熟悉事务处理");
});

import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { curateRecommendationSnapshot, enhanceRecommendationReasons } from "../app/features/recommendations/recommendationResearchEnhancer";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { adoptRecommendationBrief } from "../app/features/recommendations/recommendationBrief";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { RecommendationTask } from "../app/features/recommendations/recommendationCoordinator";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: generate }) }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); localStorage.clear(); generate.mockReset(); });
const item: RecommendationItem = { id: "real", title: "Vector index methods", abstract: "Index pruning", source: "crossref", discoveredAt: "", relatedDocumentTitle: "Index", relevanceScore: .9, relevanceBand: "high", reason: "Metadata" };
function reply(prompt: string, overrides = {}) {
  const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)), source = input.evidence[0];
  return { answer: JSON.stringify({ reasons: [{ candidateId: input.candidates[0].candidateId, evidenceIds: [source.evidenceId], text: "摘要提示方法相关，需进一步阅读。", role: "next_read", basis: "abstract", limitation: "未阅读全文", quotes: [{ evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(0, 10) }], ...overrides }] }) };
}
function setup() {
  const settings = createSettingsStore(); settings.apply({ intent: "update_setting", target: "models.connection_mode", value: "direct" });
  const request = vi.fn(async (_kind: string, run: () => Promise<unknown>) => run());
  const task = { signal: new AbortController().signal, active: async () => true, request, upstreamUnknown: () => {} } as RecommendationTask;
  const assets = { stat: vi.fn(async () => ({ revision: "r1" })), read: vi.fn(async () => ({ text: "fixed index methods", asset: { revision: "r1", kind: "note" }, offset: 0 })), create: vi.fn(async () => ({})) } as unknown as AgentAssetService;
  generate.mockImplementation(async ({ prompt }) => reply(prompt));
  return { items: [item], settings: settings.getState(), task, assets, preferences: { ...defaultRecommendationPreferences, generationEnabled: true },
    context: { documents: [], warnings: [], views: [{ id: "e", path: "liteasy://papers/source?scope=local", title: "Index", revision: "r1", text: "old context text", kind: "document" as const, provenance: "metadata" as const, private: false },
      { id: "private", path: "liteasy://objects/private?scope=local", title: "Private", revision: "r1", text: "SECRET question", kind: "annotation" as const, provenance: "user-note" as const, private: true }] } };
}
test("disabled generation makes zero calls; explicit input excludes unauthorized text and uses bound reads", async () => {
  const input = setup(); await enhanceRecommendationReasons({ ...input, preferences: defaultRecommendationPreferences }); expect(generate).not.toHaveBeenCalled();
  const result = await curateRecommendationSnapshot(input);
  expect(result.items[0].researchReason?.evidence[0].text).toBe("fixed index methods");
  expect(generate.mock.calls[0][0].prompt).not.toContain("SECRET"); expect(generate.mock.calls[0][0].prompt).not.toContain("old context text");
  expect(input.assets.create).not.toHaveBeenCalled();
});
test("old text cannot acquire a new source revision; no model request is issued", async () => {
  const input = setup(); vi.mocked(input.assets.stat).mockResolvedValue({ revision: "r2" } as never);
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("依据已更新"); expect(generate).not.toHaveBeenCalled();
});
test.each(["candidate", "quote", "basis"])("rejects invalid %s without publishing a result", async kind => {
  const input = setup(); if (kind === "basis") input.items = [{ ...item, abstract: undefined }];
  generate.mockImplementation(async ({ prompt }) => reply(prompt, kind === "candidate" ? { candidateId: "invented" } : kind === "quote" ? { quotes: [{ evidenceId: "e", hash: "forged", text: "not read" }] } : {}));
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow();
});
test("revocation or source changes during generation reject the reply", async () => {
  const input = setup(); generate.mockImplementation(async ({ prompt }) => { vi.mocked(input.assets.stat).mockResolvedValue({ revision: "r2" } as never); return reply(prompt); });
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("生成期间资料已更新");
  const revoked = setup(); let active = true; revoked.task.active = async () => active;
  generate.mockImplementation(async ({ prompt }) => { active = false; return reply(prompt); });
  await expect(curateRecommendationSnapshot(revoked)).rejects.toThrow("授权已变化");
});
test("fits a real budget subset before one request and records actual coverage", async () => {
  const input = setup(); input.items = Array.from({ length: 100 }, (_, i) => ({ ...item, id: `real-${i}`, title: `检索研究 ${i}`, abstract: "长摘要".repeat(400) }));
  const result = await curateRecommendationSnapshot(input);
  expect(result.evaluatedCount).toBeGreaterThan(0); expect(result.evaluatedCount).toBeLessThan(20);
  expect(result.poolCount).toBe(100); expect(input.task.request).toHaveBeenCalledTimes(1);
  expect(vi.mocked(input.task.request).mock.calls[0][2]).toBeLessThanOrEqual(8000);
});
test("adoption is explicit and rechecks source revisions before saving", async () => {
  const input = setup(), result = await curateRecommendationSnapshot(input); const enhanced = result.items[0];
  await adoptRecommendationBrief(enhanced, input.assets); expect(input.assets.create).toHaveBeenCalledTimes(1);
  vi.mocked(input.assets.stat).mockResolvedValue({ revision: "changed" } as never);
  await expect(adoptRecommendationBrief(enhanced, input.assets)).rejects.toThrow("来源已修改"); expect(input.assets.create).toHaveBeenCalledTimes(1);
});

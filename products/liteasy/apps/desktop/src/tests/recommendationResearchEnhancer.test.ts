import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { curateRecommendationSnapshot, enhanceRecommendationReasons } from "../app/features/recommendations/recommendationResearchEnhancer";
import { RECOMMENDATION_AI_BUDGET, estimateRecommendationRequestTokens } from "../app/features/recommendations/recommendationAiBudget";
import { resourceContentRevision } from "../app/features/resource-filesystem/resourceFileContent";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { adoptRecommendationBrief } from "../app/features/recommendations/recommendationBrief";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { RecommendationTask } from "../app/features/recommendations/recommendationCoordinator";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: generate }) }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); localStorage.clear(); generate.mockReset(); });
const item: RecommendationItem = { id: "real", title: "Vector index methods", abstract: "Index pruning", source: "crossref", sourceKind: "live", discoveredAt: "", relatedDocumentTitle: "Index", relevanceScore: .9, relevanceBand: "high", reason: "Metadata" };
function reply(prompt: string, overrides = {}) {
  const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)), source = input.evidence[0], candidate = input.candidates[0], section = candidate.sections[0];
  return { answer: JSON.stringify({ reasons: [{ candidateId: candidate.candidateId, score: 88, candidateQuotes: [{ section: section.section, hash: section.hash, text: section.text.slice(0, 30) }], evidenceIds: [source.evidenceId], text: "摘要提示方法相关，需进一步阅读。", role: "next_read", basis: "abstract", limitation: "未阅读全文", quotes: [{ evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(0, 10) }], ...overrides }] }) };
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
test.each(["candidate", "quote", "basis", "candidate-quote"])("rejects invalid %s without publishing a result", async kind => {
  const input = setup(); if (kind === "basis") input.items = [{ ...item, abstract: undefined, introduction: "An introduction to index pruning." }];
  generate.mockImplementation(async ({ prompt }) => reply(prompt, kind === "candidate" ? { candidateId: "invented" } : kind === "quote" ? { quotes: [{ evidenceId: "e", hash: "forged", text: "not read" }] } : kind === "candidate-quote" ? { candidateQuotes: [{ section: "abstract", hash: "forged", text: "Not in the abstract" }] } : {}));
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow();
});
test("revocation or source changes during generation reject the reply", async () => {
  const input = setup(); generate.mockImplementation(async ({ prompt }) => { vi.mocked(input.assets.stat).mockResolvedValue({ revision: "r2" } as never); return reply(prompt); });
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("生成期间资料已更新");
  const revoked = setup(); let active = true; revoked.task.active = async () => active;
  generate.mockImplementation(async ({ prompt }) => { active = false; return reply(prompt); });
  await expect(curateRecommendationSnapshot(revoked)).rejects.toThrow("授权已变化");
});
test("evaluates a bounded series of real batches and records actual coverage", async () => {
  const input = setup(); input.items = Array.from({ length: 100 }, (_, i) => ({ ...item, id: `real-${i}`, title: `检索研究 ${i}`, abstract: "长摘要".repeat(400) }));
  const result = await curateRecommendationSnapshot(input);
  expect(result.evaluatedCount).toBeGreaterThan(8); expect(result.evaluatedCount).toBeLessThanOrEqual(24);
  expect(result.poolCount).toBe(100); expect(input.task.request).toHaveBeenCalledTimes(3);
  const calls = vi.mocked(input.task.request).mock.calls;
  expect(calls.every(call => call[2]! <= RECOMMENDATION_AI_BUDGET.maxRequestTokens)).toBe(true);
  expect(calls.reduce((sum, call) => sum + call[2]!, 0)).toBeLessThanOrEqual(RECOMMENDATION_AI_BUDGET.maxRunTokens);
  for (const [request] of generate.mock.calls) {
    expect(request.maxOutputTokens).toBe(RECOMMENDATION_AI_BUDGET.maxOutputTokens);
    expect(estimateRecommendationRequestTokens(request.prompt, request.outputFormat.schema)).toBe(calls[generate.mock.calls.findIndex(call => call[0] === request)][2]);
  }
});
test("adoption is explicit and rechecks source revisions before saving", async () => {
  const input = setup(), result = await curateRecommendationSnapshot(input); const enhanced = result.items[0];
  await adoptRecommendationBrief(enhanced, input.assets); expect(input.assets.create).toHaveBeenCalledTimes(1);
  vi.mocked(input.assets.stat).mockResolvedValue({ revision: "changed" } as never);
  await expect(adoptRecommendationBrief(enhanced, input.assets)).rejects.toThrow("来源已修改"); expect(input.assets.create).toHaveBeenCalledTimes(1);
});


test("large Chinese metadata revisions never consume the model evidence budget", async () => {
  const input = setup();
  const revision = JSON.stringify({ title: "索引研究", abstract: "重复版本数据".repeat(4000) });
  input.context.views = Array.from({ length: 6 }, (_, i) => ({ id: `source-${i}`, title: `索引研究${i}`, revision,
    text: "希望比较多模态向量检索中带过滤条件的近邻搜索方法，关注延迟、召回率、索引存储与更新代价。".repeat(80),
    kind: "document" as const, provenance: "metadata" as const, private: false })) as typeof input.context.views;
  const result = await curateRecommendationSnapshot(input);
  expect(generate).toHaveBeenCalledOnce();
  const request = generate.mock.calls[0][0];
  expect(request.prompt).not.toContain("重复版本数据");
  expect(request.prompt).not.toContain('"revision"');
  expect(result.items[0].researchReason?.evidence[0].revision).toBe(revision);
  expect(result.evaluatedCount).toBe(1);
});

test("actual introduction text and verified origin survive selection with no full-text claim", async () => {
  const input = setup(), introduction = "A filtered graph traversal checks structured predicates while exploring approximate nearest neighbours.";
  input.items = [{ ...item, abstract: undefined, introduction, contentEvidence: [{ section: "introduction", source: "open-access", sourceUrl: "https://example.test/paper", retrievedAt: "2026-10-15T00:00:00Z", textHash: (await resourceContentRevision(introduction)).slice(7) }] }];
  generate.mockImplementation(async ({ prompt }) => reply(prompt, { basis: "introduction", text: "引言说明在图遍历中检查筛选条件，直接对应研究问题中的混合检索流程。" }));
  const result = await curateRecommendationSnapshot(input);
  expect(result.items[0].reason).toContain("引言节选");
  expect(result.items[0].researchReason?.candidateEvidence).toMatchObject([{ section: "introduction", text: introduction, sourceUrl: "https://example.test/paper", hash: await resourceContentRevision(introduction) }]);
});

test("metadata-only candidates are not presented as AI-reviewed content", async () => {
  const input = setup(); input.items = [{ ...item, abstract: undefined }];
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("尚无可用摘要或引言");
  expect(generate).not.toHaveBeenCalled();
  input.items.push({ ...item, id: "with-content" });
  const result = await curateRecommendationSnapshot(input);
  expect(result.items.map(row => row.id)).toEqual(["with-content"]);
  expect(result.missingContentCount).toBe(1); expect(result.evaluatedCount).toBe(1);
});

test("changed candidate content cannot inherit its previous origin hash", async () => {
  const input = setup(); input.items = [{ ...item, contentEvidence: [{ section: "abstract", source: "metadata", sourceUrl: "https://example.test/paper", retrievedAt: "2026-10-15T00:00:00Z", textHash: (await resourceContentRevision("previous abstract")).slice(7) }] }];
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("摘要或引言已变化");
  expect(generate).not.toHaveBeenCalled();
});

test("a model cannot cite a candidate from another batch or leave malformed output hidden", async () => {
  const input = setup(); input.items = Array.from({ length: 12 }, (_, i) => ({ ...item, id: `candidate-${i}` }));
  generate.mockImplementation(async ({ prompt }) => reply(prompt, { candidateId: "candidate-11" }));
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("本批候选中不存在");
  const malformed = setup(); generate.mockImplementation(async () => ({ answer: "not JSON" }));
  await expect(curateRecommendationSnapshot(malformed)).rejects.toThrow("AI 未返回可核对");
});

test("validated batch scores determine final reading order and consent changes stop later calls", async () => {
  const input = setup(); input.items = Array.from({ length: 12 }, (_, i) => ({ ...item, id: `candidate-${i}` }));
  generate.mockImplementation(async ({ prompt }) => reply(prompt, { score: prompt.includes('"candidateId":"candidate-8"') ? 95 : 65 }));
  const result = await curateRecommendationSnapshot(input);
  expect(result.items.map(row => row.id)).toEqual(["candidate-8", "candidate-0"]);
  expect(result.evaluatedCount).toBe(12);
  let active = true; input.task.active = async () => active;
  generate.mockImplementation(async ({ prompt }) => { active = false; return reply(prompt); });
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("授权已变化");
});

test("multiple verified quotations may share one source but every quotation is checked", async () => {
  const input = setup();
  generate.mockImplementation(async ({ prompt }) => {
    const source = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)).evidence[0];
    return reply(prompt, { evidenceIds: [source.evidenceId, source.evidenceId], quotes: [
      { evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(0, 10) },
      { evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(6) }
    ] });
  });
  const result = await curateRecommendationSnapshot(input);
  expect(result.items[0].researchReason?.evidenceIds).toEqual(["e"]);
  generate.mockImplementation(async ({ prompt }) => {
    const source = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)).evidence[0];
    return reply(prompt, { quotes: [
      { evidenceId: source.evidenceId, hash: source.hash, text: source.text.slice(0, 10) },
      { evidenceId: source.evidenceId, hash: source.hash, text: "forged second quotation" }
    ] });
  });
  await expect(curateRecommendationSnapshot(input)).rejects.toThrow("研究依据引用无法核对");
});

test("a complete English evidence sentence is accepted without relaxing its exact provenance", async () => {
  const input = setup();
  const sentence = "We study scaling laws and present findings that facilitate scaling of large language models in commonly used open-source configurations, while retaining an explicitly bounded training setup.";
  expect(sentence.length).toBeGreaterThan(180);
  input.items = [{ ...item, abstract: sentence }];
  generate.mockImplementation(async ({ prompt }) => {
    const candidate = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)).candidates[0];
    return reply(prompt, { candidateQuotes: [{ section: "abstract", hash: candidate.sections[0].hash, text: sentence }] });
  });
  const result = await curateRecommendationSnapshot(input);
  expect(result.items[0].researchReason?.candidateEvidence?.[0].text).toBe(sentence);
});

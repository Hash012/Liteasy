import { beforeEach, expect, test, vi } from "vitest";
import { enhanceRecommendationReasons } from "../app/features/recommendations/recommendationResearchEnhancer";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { adoptRecommendationBrief } from "../app/features/recommendations/recommendationBrief";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { RecommendationTask } from "../app/features/recommendations/recommendationCoordinator";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: generate }) }));
beforeEach(() => { localStorage.clear(); generate.mockReset(); });
const item: RecommendationItem = { id: "real", title: "Vector index methods", abstract: "Index pruning", source: "crossref", discoveredAt: "", relatedDocumentTitle: "Index", relevanceScore: .9, relevanceBand: "high", reason: "Metadata" };
function setup() {
  const settings = createSettingsStore(); settings.apply({ intent: "update_setting", target: "models.connection_mode", value: "direct" });
  const request = vi.fn(async (_kind: string, run: () => Promise<unknown>) => run());
  const task = { signal: new AbortController().signal, active: async () => true, request, upstreamUnknown: () => {} } as RecommendationTask;
  const assets = { stat: vi.fn(async () => ({ revision: "r1" })), create: vi.fn(async () => ({})) } as unknown as AgentAssetService;
  return { items: [item], settings: settings.getState(), task, assets, preferences: { ...defaultRecommendationPreferences, generationEnabled: true },
    context: { documents: [], warnings: [], views: [{ id: "e", path: "liteasy://papers/source?scope=local", title: "Index", revision: "r1", text: "index methods", kind: "document" as const, provenance: "metadata" as const, private: false },
      { id: "private", path: "liteasy://objects/private?scope=local", title: "Private", revision: "r1", text: "SECRET question", kind: "annotation" as const, provenance: "user-note" as const, private: true }] } };
}
test("disabled generation makes zero calls; enabled batch whitelists IDs and excludes private text", async () => {
  const input = setup();
  await enhanceRecommendationReasons({ ...input, preferences: defaultRecommendationPreferences }); expect(generate).not.toHaveBeenCalled();
  generate.mockResolvedValue({ answer: JSON.stringify({ reasons: [{ candidateId: "invented", evidenceIds: ["e"], text: "Claim", role: "next_read" }] }) });
  expect(await enhanceRecommendationReasons(input)).toEqual([item]);
  expect(generate.mock.calls[0][0].prompt).not.toContain("SECRET"); expect(generate.mock.calls[0][0].maxOutputTokens).toBe(1500);
  expect(input.assets.create).not.toHaveBeenCalled();
});
test("adoption is an explicit write and rechecks source revisions before saving", async () => {
  const input = setup(); generate.mockResolvedValue({ answer: JSON.stringify({ reasons: [{ candidateId: "real", evidenceIds: ["e"], text: "题录提示相关方法", role: "next_read" }] }) });
  const [enhanced] = await enhanceRecommendationReasons(input); expect(enhanced.researchReason?.candidateId).toBe("real"); expect(input.assets.create).not.toHaveBeenCalled();
  await adoptRecommendationBrief(enhanced, input.assets); expect(input.assets.create).toHaveBeenCalledTimes(1);
  vi.mocked(input.assets.stat).mockResolvedValue({ revision: "changed" } as Awaited<ReturnType<AgentAssetService["stat"]>>);
  await expect(adoptRecommendationBrief(enhanced, input.assets)).rejects.toThrow("来源已修改"); expect(input.assets.create).toHaveBeenCalledTimes(1);
});

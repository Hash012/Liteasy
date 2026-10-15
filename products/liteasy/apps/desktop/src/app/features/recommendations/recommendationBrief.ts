import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import type { RecommendationItem } from "./recommendation.types";
import { loadRecommendationPreferences } from "./recommendationPreferences";
/** Called only by the user's adopt button; creation uses the same asset boundary as resources.create. */
export async function adoptRecommendationBrief(item: RecommendationItem, assets: AgentAssetService, verifySnapshot?: (source: NonNullable<RecommendationItem["researchReason"]>["evidence"][number]) => Promise<boolean>) {
  const reason = item.researchReason;
  if (!reason || reason.consentEpoch !== loadRecommendationPreferences().consentEpoch) throw new Error("推荐依据已失效，请重新检查推荐。");
  for (const source of reason.evidence) {
    if (!source.path) { if (!verifySnapshot || !await verifySnapshot(source)) throw new Error("问题或研究主题已变化，请重新精选。"); continue; }
    const current = await assets.stat(source.path);
    if (source.revision !== current.revision) throw new Error("来源已修改或删除，请重新生成研究建议。");
  }
  const firstPaper = reason.evidence.find(source => source.path?.startsWith("liteasy://papers/"))?.path;
  return assets.create({ kind: "note", title: `研究建议：${item.title}`.slice(0, 240), paperPath: firstPaper,
    operationId: `recommendation:${item.feedSnapshotId}:${item.id}`.slice(0, 128),
    text: `# ${item.title}\n\n${reason.text}\n\n依据：${reason.evidence.map(source => source.path ? `[原始来源](${source.path}) · 版本 ${source.revision}` : `已授权问题或研究主题：${source.text}`).join("\n")}\n\n生成时间：${reason.generatedAt}\n模型：${reason.model}\n规则：${reason.recipe}\n\n这是基于现有依据的研究建议；来源修订后需重新核对。` });
}

import type { ObjectRepository } from "../objects/objectRepository";
import { objectText, type ObjectEnvelope } from "../objects/object.types";

export type ContextAssetPreview = {
  text: string;
  images?: Array<{ url: string; label: string }>;
};

export function contextPreviewText(text: string, limit = 4000) {
  return text.length > limit ? `${text.slice(0, limit)}\n\n…（预览仅展示部分内容）` : text;
}

function previewObjectText(object: ObjectEnvelope) {
  const text = objectText(object);
  if (object.kind !== "content.fragment") return text;
  const quotes = object.content.payload.anchors.flatMap((anchor) =>
    "quote" in anchor && anchor.quote.exact.trim() && anchor.quote.exact.trim() !== text.trim()
      ? [`${anchor.type === "pdf" ? `第 ${anchor.page} 页原文` : "来源原文"}：\n${anchor.quote.exact}`] : []);
  return [text, ...new Set(quotes)].join("\n\n");
}

/** Read only: opening a preview must not capture objects or create context snapshots. */
export async function readObjectContextPreview(repository: ObjectRepository, object: ObjectEnvelope,
  assertCurrent: () => void): Promise<ContextAssetPreview> {
  assertCurrent();
  let text = previewObjectText(object);
  const objects = [object];
  if (object.kind === "workspace.board") {
    const [members, edges] = await Promise.all([repository.listPlacements(object.objectId), repository.listEdges(object.objectId)]);
    assertCurrent();
    const contents = await Promise.all(members.slice(0, 20).map((member) => repository.get(member.ref)));
    assertCurrent();
    objects.push(...contents);
    text = [text, `包含 ${members.length} 个元素、${edges.length} 条连接；添加时会包含元素内容和白板布局。`,
      ...contents.map((entry) => `${entry.title}\n${contextPreviewText(previewObjectText(entry), 500)}`),
      ...(members.length > contents.length ? ["…（仅预览前 20 个元素）"] : []),
      ...edges.slice(0, 20).filter((edge) => edge.label).map((edge) => `连接：${edge.label}`),
    ].filter(Boolean).join("\n\n");
  }
  const descriptors = [...new Map(objects.flatMap((entry) => entry.assets
    .filter((asset) => asset.mediaType.startsWith("image/"))
    .map((asset) => [asset.assetId, { asset, title: entry.title }] as const))).values()];
  const images = await Promise.all(descriptors.slice(0, 6).map(async ({ asset, title }, index) => {
    const image = await repository.readAsset(asset.assetId);
    assertCurrent();
    return { url: `data:${image.mediaType};base64,${image.base64}`, label: descriptors.length === 1 ? title : `${title} · 图片 ${index + 1}` };
  }));
  assertCurrent();
  return { text: contextPreviewText(text) + (descriptors.length > images.length ? `\n\n共 ${descriptors.length} 张图片，预览前 ${images.length} 张。` : ""), images };
}

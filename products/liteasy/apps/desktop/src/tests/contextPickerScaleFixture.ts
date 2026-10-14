import type { AssistantComposerSuggestion } from "../app/features/assistant/assistant.types";
import type { PickerCatalogSource, CatalogRelation } from "../app/features/context-picker/catalogPort";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
export function contextPickerScaleFixture(): PickerCatalogSource {
  const scope = "picker-v3-scale";
  const entries = Array.from({ length: 21 }, (_, i) => ({ id: `paper-${i}`, title: i < 2 ? "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data" : `研究文献 ${i + 1} · 文献集合与来源定位`, format: "pdf" as const, year: 2024 }));
  const relations: CatalogRelation[] = [];
  const asset = (id: string, label: string, kind: string, owner?: string, page?: number): AssistantComposerSuggestion => {
    if (owner) relations.push({ assetId: id, paperIds: [owner], page, sourceOrder: relations.length, revision: "v1" });
    return { id, label, trigger: "@", scopeId: scope, resourceRevision: "v1", searchMetadata: { kind },
      category: ({ paper: "论文", image: "图片", text: "原文", note: "笔记" } as Record<string, string>)[kind],
      resourcePath: kind === "paper" ? liteasyPath(scope, { kind: "paper", paperId: owner! }) : liteasyPath(scope, { kind: "object", ref: { objectId: id, revision: "v1" } }),
      token: { id, kind: "object", label, prompt: "", contextRefs: [{ objectId: id, revision: "v1" }] } };
  };
  const assets = entries.map(entry => asset(entry.id, entry.title, "paper", entry.id));
  for (let i = 0; i < 760; i++) assets.push(asset(`image-${i}`, "论文图片", "image", entries[i % 21].id, Math.floor(i / 21) + 1));
  for (let i = 0; i < 594; i++) assets.push(asset(`page-${i}`, `来源 · 第 ${Math.floor(i / 21) + 1} 页`, "text", entries[i % 21].id, Math.floor(i / 21) + 1));
  assets.push(asset("standalone-image", "独立图片", "image"), asset("note", "跨文献比较笔记", "note"));
  return { scope, revision: "scale-v1", assets, entries, relations,
    collections: [{ id: "research", title: "检索研究", memberIds: entries.map(entry => entry.id) }, { id: "overlap", title: "精读文献", memberIds: [entries[0].id] }],
    inventories: Object.fromEntries(entries.map((entry, i) => [entry.id, i === 20 ? { state: "error", extraction: "unknown", items: [] } : i === 19 ? { state: "unknown", extraction: "not_extracted", items: [] } : { state: "ready", extraction: "ready", items: [] }])) };
}

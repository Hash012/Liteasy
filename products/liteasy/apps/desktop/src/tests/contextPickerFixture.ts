import { createContextCatalogPort, type PickerCatalogSource } from "../app/features/context-picker/catalogPort";
import type { AssistantComposerSuggestion } from "../app/features/assistant/assistant.types";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
export function contextPickerFixture(images = 75) {
  const scope = "picker-fixture";
  const asset = (id: string, kind: string, label = id): AssistantComposerSuggestion => ({ id, trigger: "@", label, scopeId: scope,
    category: kind === "paper" ? "论文" : kind === "image" ? "图片" : "笔记", searchMetadata: { kind, origin: "user", tags: id.endsWith("0") ? ["keep"] : [] },
    resourcePath: kind === "paper" ? liteasyPath(scope, { kind: "paper", paperId: id }) : liteasyPath(scope, { kind: "object", ref: { objectId: id, revision: "r1" } }),
    token: { id, kind: "object", label, prompt: "", contextRefs: [{ objectId: id, revision: "r1" }] } });
  const assets = [asset("p", "paper", "论文 P"), asset("q", "paper", "未归类 Q"), asset("note", "note", "私有笔记"), ...Array.from({ length: images }, (_, i) => asset(`image-${i}`, "image", `图 ${String(i).padStart(3, "0")}`))];
  const source: PickerCatalogSource = { scope, revision: "catalog-r1", assets,
    entries: [{ id: "p", title: "论文 P", format: "pdf", year: 2024, authors: ["Z"], collection: "A", readingStatus: "reading" }, { id: "q", title: "未归类 Q", format: "pdf", year: 2025, authors: ["A"] }],
    collections: [{ id: "a", title: "A", memberIds: ["p"] }, { id: "b", title: "B", memberIds: ["p"] }],
    relations: assets.map((value, i) => ({ assetId: value.id, paperIds: [value.id === "q" ? "q" : "p"], revision: "r1", page: i + 1, sourceOrder: i })),
    inventories: { p: { state: "ready", extraction: "ready", items: [] }, q: { state: "ready", extraction: "not_extracted", items: [] } } };
  return { source, assets, catalog: createContextCatalogPort(source), imageRoute: ["collections", "a", "paper:p", "extracted", "image"] };
}

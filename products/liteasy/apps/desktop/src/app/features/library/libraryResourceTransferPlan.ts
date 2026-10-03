import type { LibraryResourceEntrySource, LibraryResourceFolderTree, LibraryResourceTransferSource, LibraryResourceTransferTarget } from "./libraryResourceTransfer.types";

export type LibraryResourceTransferPlan = {
  source: LibraryResourceTransferSource;
  target: LibraryResourceTransferTarget;
  action: "copy" | "move";
  sourceLabel: string;
  targetLabel: string;
  pdfCount: number;
  metadataCount: number;
  recommendationCount: number;
};

function areaLabel(area: LibraryResourceTransferSource["area"]) {
  return { local: "本机文献库", collection: "本人云收藏", organization: "组织文献库", recommendation: "关联推荐" }[area];
}

export function planLibraryResourceTransfer(sourceInput: LibraryResourceTransferSource, targetInput: LibraryResourceTransferTarget): LibraryResourceTransferPlan {
  const source = structuredClone(sourceInput);
  const target = structuredClone(targetInput);
  const sameCloud = source.area !== "local" && source.area !== "recommendation" &&
    target.scope?.scopeId === source.scope.scopeId && target.scope?.scopeType === source.scope.scopeType;
  const sourceName = source.area === "recommendation" ? source.recommendation.title : "folder" in source ? source.folder.name : source.entry.title;
  const plan: LibraryResourceTransferPlan = {
    source, target, action: sameCloud || (source.area === "local" && target.area === "local") ? "move" : "copy",
    sourceLabel: `${areaLabel(source.area)}${source.area === "organization" ? ` · ${source.scope.scopeId}` : ""} / ${sourceName}`,
    targetLabel: `${areaLabel(target.area)}${target.area === "local" && target.localFolderPath ? ` · ${target.localFolderPath}` : target.area === "organization" ? ` · ${target.scope?.scopeId ?? "未选择组织"}` : ""}${target.folderLabel ? ` / ${target.folderLabel}` : ""}`,
    pdfCount: 0, metadataCount: 0, recommendationCount: source.area === "recommendation" ? 1 : 0
  };
  function count(entry: LibraryResourceEntrySource) {
    if (source.area === "local" && entry.area !== "local") throw new Error("本机目录包含不同来源的条目，请刷新后重新选择。");
    if (source.area !== "local" && source.area !== "recommendation" &&
      (entry.area === "local" || entry.scope.scopeId !== source.scope.scopeId || entry.scope.scopeType !== source.scope.scopeType)) {
      throw new Error("目录包含不同来源的条目，请刷新后重新选择。");
    }
    if (entry.area === "local" ? Boolean(entry.entry.path) : entry.entry.entryKind === "pdf") plan.pdfCount += 1;
    else plan.metadataCount += 1;
  }
  if ("folder" in source) {
    function visit(tree: LibraryResourceFolderTree) {
      tree.entries.forEach(count);
      tree.children.forEach(visit);
    }
    visit(source.tree);
  } else if (source.area !== "recommendation") count(source);
  return plan;
}

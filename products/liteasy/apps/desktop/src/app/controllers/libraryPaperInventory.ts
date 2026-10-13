import type { ArtifactTab, ArtifactCatalogLoadState } from "../features/artifacts/artifact.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { ImportJob, MineruFigure } from "../features/import/import.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { ProjectCatalog } from "./usePaperProjectsController";
import { deduplicateLibraryChildren, type LibraryInventory, type LibraryPaperChildItem } from "../features/library/libraryInventory";

/** A lightweight in-memory projection. It never parses a PDF or reads a file body. */
export function projectLibraryPaperInventory({ scopeId, papers, artifacts, projects, artifactState, extractionState, importJobs, getResources }: {
  scopeId: string; papers: Paper[]; artifacts: ArtifactTab[];
  projects: { catalog: ProjectCatalog[]; catalogStatus: "unknown" | "loading" | "ready" | "error"; catalogError: string; inventoryRevision: string };
  artifactState: ArtifactCatalogLoadState; extractionState: ArtifactCatalogLoadState;
  importJobs: Record<string, ImportJob>;
  getResources(id: string): { textChunks: RetrievalChunk[]; figures: MineruFigure[] } | null;
}): Record<string, LibraryInventory> {
  const projectsByPaper = new Map(projects.catalog.map(item => [item.project.paperId, item]));
  const artifactsByPaper = new Map<string, ArtifactTab[]>();
  for (const artifact of artifacts) for (const id of new Set([...(artifact.papers?.map(paper => paper.id) ?? []), ...(artifact.analysis?.run.coverage.selectedPaperIds ?? [])])) {
    const list = artifactsByPaper.get(id) ?? []; list.push(artifact); artifactsByPaper.set(id, list);
  }
  const artifactsById = new Map(artifacts.map(artifact => [artifact.artifactId, artifact]));
  return papers.reduce<
    Record<string, LibraryInventory>
  >((entries, paper) => {
    const resources = getResources(paper.id);
    const job = importJobs[paper.id];
    const extractedResources: LibraryPaperChildItem[] = resources
      ? [
          ...(resources.textChunks.length > 0 ? [{
            id: `text-${paper.id}`,
            kind: "extracted_text" as const,
            label: "论文提取文本",
            meta: `${resources.textChunks.length} 个文本片段`
          }] : []),
          ...(resources.figures.length > 0 ? [{
            id: `figures-${paper.id}`,
            kind: "figures" as const,
            label: "论文插图",
            meta: `${resources.figures.length} 张图表`
          }] : []),
          ...(resources.textChunks.length > 0 || resources.figures.length > 0 ? [{
            id: `multimodal-${paper.id}`,
            kind: "multimodal" as const,
            label: "论文提取图文版",
            meta: `按原文顺序组合文本与 ${resources.figures.length} 张图表`
          }] : [])
        ]
      : [];
    const projectAssets = projectsByPaper.get(paper.id)?.assets ?? [];
    const linkedArtifacts = projectAssets.filter(asset => asset.kind === "artifact" && asset.artifactId)
      .flatMap(asset => { const artifact = artifactsById.get(asset.artifactId!); return artifact ? [artifact] : []; });
    const savedArtifacts = [...(artifactsByPaper.get(paper.id) ?? []), ...linkedArtifacts]
      .map((tab) => ({
        id: tab.artifactId,
        kind: "artifact" as const,
        label: tab.title,
        meta: tab.createdAt ? new Date(tab.createdAt).toLocaleString() : undefined
      }));
    const attachments = projectAssets
      .filter((asset) => (asset.kind === "note" || asset.kind === "board") && asset.ref)
      .map((asset) => ({ id: asset.assetId, kind: asset.kind as "note" | "board", label: asset.title, objectId: asset.ref!.objectId, ref: asset.ref })) ?? [];
    const error = [projects.catalogStatus === "error" ? projects.catalogError || "项目目录读取失败" : "", artifactState.status === "error" ? artifactState.message || "产物目录读取失败" : "", extractionState.status === "error" ? extractionState.message || "提取目录读取失败" : ""].filter(Boolean).join("；");
    const ready = projects.catalogStatus === "ready" && artifactState.status === "ready" && extractionState.status === "ready";
    const items = deduplicateLibraryChildren([...extractedResources, ...attachments, ...savedArtifacts]);
    entries[paper.id] = { state: error ? "error" : ready ? "ready" : "loading", items,
      summary: error || undefined, inventoryRevision: ready ? JSON.stringify([scopeId, projects.inventoryRevision, items.map(item => [item.id, item.ref?.revision])]) : undefined,
      extraction: job?.status === "failed" ? "error" : job?.status === "parsing" || job?.status === "queued" ? "loading" : resources ? "ready" : extractionState.status === "ready" ? "not_extracted" : "unknown" };
    return entries;
  }, {});
}

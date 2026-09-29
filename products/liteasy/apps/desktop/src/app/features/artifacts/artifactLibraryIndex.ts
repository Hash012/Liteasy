import type { ArtifactPaperRef, ArtifactTab, ArtifactType } from "./artifact.types";

export const artifactTypeLabels: Record<ArtifactType, string> = {
  comparison_table: "文献对比", layered_graph: "分层关系图", mindmap: "思维导图",
  ppt: "演示文稿", skill_doc: "Skill 文档", thin_reading: "薄读", tree: "树形分析"
};
export const unlinkedPaperFilter = "__unlinked__";
export const normalizeArtifactSearch = (value: string) => value.trim().toLocaleLowerCase();
export function artifactSearchText(artifact: ArtifactTab) {
  return [artifact.title, artifactTypeLabels[artifact.type], ...(artifact.papers ?? []).map((paper) =>
    [paper.title, Array.isArray(paper.authors) ? paper.authors.join(" ") : paper.authors, paper.year, paper.doi, paper.arxivId].filter(Boolean).join(" ")
  )].join(" ");
}
export function matchesArtifactPaper(artifact: ArtifactTab | undefined, paperId: string) {
  if (!paperId) return true;
  const papers = artifact?.papers ?? [];
  return paperId === unlinkedPaperFilter ? papers.length === 0 : papers.some((paper) => paper.id === paperId);
}
export function groupArtifactsByPaper(artifacts: ArtifactTab[], selectedPaperId: string) {
  const groups = new Map<string, { id: string; title: string; artifacts: ArtifactTab[] }>();
  for (const artifact of artifacts) {
    const paper = artifact.papers?.find((source) => source.id === selectedPaperId) ?? artifact.papers?.[0];
    const id = paper?.id ?? unlinkedPaperFilter;
    if (!groups.has(id)) groups.set(id, { id, title: paper?.title ?? "未关联论文", artifacts: [] });
    groups.get(id)!.artifacts.push(artifact);
  }
  return [...groups.values()];
}
export function indexArtifactPapers(artifacts: ArtifactTab[]) {
  const papers = new Map<string, { paper: ArtifactPaperRef; count: number }>();
  for (const artifact of artifacts) {
    for (const paper of new Map((artifact.papers ?? []).map((paper) => [paper.id, paper])).values()) {
      const previous = papers.get(paper.id);
      papers.set(paper.id, { paper, count: (previous?.count ?? 0) + 1 });
    }
  }
  return [...papers.values()].sort((a, b) => a.paper.title.localeCompare(b.paper.title));
}
export function artifactDateValue(value?: string) { return value ? Date.parse(value) || 0 : 0; }

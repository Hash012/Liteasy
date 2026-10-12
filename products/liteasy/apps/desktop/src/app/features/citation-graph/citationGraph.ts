import type { Paper } from "../workspace/workspace.types";
import type { RecommendationItem } from "../recommendations/recommendation.types";

export type CitationPaper = { id: string; title: string; doi?: string; openAlexId?: string; authors?: string[]; year?: number };
export type CitationWork = { id: string; doi?: string; title: string; authors: string[]; year?: number; citationCount: number; references: string[]; pdfUrl?: string };
export type CitationEdge = { id: string; source: string; target: string };
export type CitationNode = { id: string; title: string; localIds: string[]; work?: CitationWork };
export type CitationGraph = { nodes: CitationNode[]; edges: CitationEdge[] };
export type CitationDirection = "references" | "citations" | "both";
export const openAlexId = (value: unknown) => typeof value === "string" ? /^(?:https:\/\/openalex\.org\/)?(W\d+)$/i.exec(value)?.[1].toUpperCase() : undefined;
export function normalizeCitationDoi(value: unknown) {
  if (typeof value !== "string") return undefined;
  const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) && !/[|,]/.test(doi) ? doi : undefined;
}
export function citationPaper(paper: Paper): CitationPaper {
  const identifiers = paper.literature?.identifiers ?? [];
  return { id: paper.id, title: paper.literature?.title || paper.title,
    doi: normalizeCitationDoi(paper.doi) ?? identifiers.map((item) => item.kind === "doi" ? normalizeCitationDoi(item.value) : undefined).find(Boolean),
    openAlexId: identifiers.map((item) => item.kind === "openalex_id" ? openAlexId(item.value) : undefined).find(Boolean),
    authors: typeof paper.authors === "string" ? [paper.authors] : paper.authors ? [...paper.authors] : paper.literature?.authors,
    year: Number(paper.year ?? paper.literature?.year) || undefined };
}
export const citationKey = (paper: CitationPaper) => paper.doi ? `doi:${paper.doi}` : paper.openAlexId;
export function projectCitationGraph(papers: CitationPaper[], works: CitationWork[], extraEdges: CitationEdge[] = []): CitationGraph {
  const byId = new Map(works.map((work) => [work.id, work]));
  const byDoi = new Map(works.filter((work) => work.doi).map((work) => [work.doi, work]));
  const nodes = new Map<string, CitationNode>();
  for (const paper of papers) {
    const work = paper.doi ? byDoi.get(paper.doi) : paper.openAlexId ? byId.get(paper.openAlexId) : undefined;
    const id = work?.id ?? citationKey(paper) ?? `local:${paper.id}`;
    const existing = nodes.get(id);
    if (existing) existing.localIds.push(paper.id);
    else nodes.set(id, { id, title: paper.title, localIds: [paper.id], work });
  }
  for (const work of works) if (!nodes.has(work.id)) nodes.set(work.id, { id: work.id, title: work.title, localIds: [], work });
  const edges = new Map<string, CitationEdge>();
  for (const work of works) for (const target of work.references) {
    if (target !== work.id && nodes.has(target)) edges.set(`${work.id}:${target}`, { id: `${work.id}:${target}`, source: work.id, target });
  }
  for (const edge of extraEdges) if (nodes.has(edge.source) && nodes.has(edge.target) && edge.source !== edge.target) edges.set(edge.id, edge);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
export function citationRecommendation(work: CitationWork, seedTitle: string): RecommendationItem {
  return { id: `citation-${work.id}`, title: work.title, authors: work.authors, publishedYear: work.year,
    citationCount: work.citationCount, canonicalId: work.doi ? `doi:${work.doi}` : `openalex:${work.id}`,
    source: "OpenAlex", sourceKind: "live", primaryProvider: "openalex", discoveredAt: new Date().toISOString(),
    sourceUrl: work.doi ? `https://doi.org/${work.doi}` : `https://openalex.org/${work.id}`,
    openAccessPdfUrl: work.pdfUrl, openAccessAvailable: Boolean(work.pdfUrl), relatedDocumentTitle: seedTitle,
    relevanceBand: "medium", relevanceScore: 0, reason: "通过明确的论文引用关系发现；引用量不代表与你的研究问题的相关度。" };
}

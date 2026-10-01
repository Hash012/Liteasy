import type { ObjectRepository } from "../objects/objectRepository";
import { parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { terms } from "../../../../../../packages/recommendation-core/index.mjs";
import type { View } from "../../../../../../packages/recommendation-core/index.mjs";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { loadPdfNotes } from "../notes/pdfNotesSource";
import type { createPaperProjectRepository } from "../paper-projects/paperProjectRepository";
import type { Paper } from "../workspace/workspace.types";
import type { RecommendationItem, RecommendationResearchProfile, RecommendationRequestDocument } from "./recommendation.types";
import { recommendationDocument } from "./recommendationSeed";
import type { RecommendationPreferences } from "./recommendationPreferences";

export type RecommendationAssetSelection = { path: string; title?: string; abstract?: string; revision?: string };
export type RecommendationContextView = View & { revision: string; provenance: "metadata" | "asset" | "user-note" | "highlight" | "profile"; private: boolean };
export type RecommendationContext = { localCandidates?: RecommendationItem[]; views: RecommendationContextView[]; documents: RecommendationRequestDocument[]; warnings: string[] };
function prose(text: string, kind: string) {
  if (!/board|canvas/.test(kind)) return text;
  try {
    const canvas = JSON.parse(text) as { nodes?: { text?: string; label?: string }[]; edges?: { label?: string }[] };
    return [...(canvas.nodes ?? []).map((node) => node.text || node.label || ""), ...(canvas.edges ?? []).map((edge) => edge.label || "")].filter(Boolean).join("\n");
  } catch { return ""; }
}
export async function buildRecommendationContext(input: { scope: string; papers: Paper[]; selected?: RecommendationAssetSelection[]; assets?: AgentAssetService;
  projects?: ReturnType<typeof createPaperProjectRepository>; repository?: ObjectRepository; profile?: RecommendationResearchProfile; preferences: RecommendationPreferences; signal: AbortSignal }): Promise<RecommendationContext> {
  const views: RecommendationContextView[] = [], warnings: string[] = [], documents = input.papers.map(recommendationDocument);
  const add = (view: RecommendationContextView) => { if (view.text.trim() && !views.some((old) => old.id === view.id)) views.push({ ...view, text: view.text.slice(0, 8000) }); };
  for (const doc of documents) add({ id: `paper:${doc.id}`, kind: "document", title: doc.title,
    path: liteasyPath(input.scope, { kind: "paper", paperId: doc.id }), revision: JSON.stringify(doc),
    text: [doc.title, doc.abstract, ...(doc.subjects ?? []), ...(doc.keywords ?? []), doc.venue].filter(Boolean).join("\n"), provenance: "metadata", private: false });
  for (const selection of (input.selected ?? []).slice(0, 8)) {
    input.signal.throwIfAborted();
    if (!input.assets) continue;
    try {
      const asset = await input.assets.stat(selection.path, { signal: input.signal });
      const summary = selection.abstract || asset.summary || "";
      const content = summary.length > 200 ? summary : prose((await input.assets.read(selection.path, { maxCharacters: 8000, signal: input.signal })).text, asset.kind);
      input.signal.throwIfAborted();
      if (!content.trim()) { warnings.push(`《${asset.title}》暂无可分析文本，可补充简介。`); continue; }
      add({ id: asset.path, path: asset.path, kind: "document", title: asset.title, revision: asset.revision || selection.revision || content,
        text: `${asset.title}\n${content}`, provenance: "asset", private: true });
      documents.push({ id: asset.path, title: asset.title, abstract: content.slice(0, 4000) });
    } catch (error) { input.signal.throwIfAborted(); warnings.push(`无法读取《${selection.title || "所选资产"}》：${String(error)}`); }
  }
  if (input.preferences.useAnnotations) {
    const annotations = await loadPdfNotes(input.papers, () => warnings.push("部分批注暂不可用，仍可按文献推荐。"));
    for (const note of annotations.slice(0, 48)) {
      const annotation = note.annotation!;
      // Generated explanations are not evidence of a user's interests.
      if (annotation.aiGuide && !annotation.quickAsk?.question?.trim()) continue;
      const userText = [!annotation.aiGuide ? annotation.note?.trim() : "", !annotation.aiGuide && (annotation.kind === "text" || annotation.kind === "note") ? annotation.text?.trim() : "", annotation.quickAsk?.question?.trim()].filter(Boolean).join("\n");
      const path = liteasyPath(input.scope, { kind: "pdf-annotation", paperId: note.paper!.id, annotationId: annotation.id });
      // Quote and user question remain distinguishable. Model answers are not user preferences.
      add({ id: `annotation:${note.paper!.id}:${annotation.id}`, kind: "annotation", title: note.title,
        path, anchorRef: path, revision: annotation.updatedAt, text: userText ? `${userText}\n引用：${annotation.excerpt.slice(0, 2000)}` : annotation.excerpt.slice(0, 1000),
        provenance: userText ? "user-note" : "highlight", importance: userText ? 1 : .25, private: true });
    }
    if (input.projects && input.assets) {
      const selectedIds = new Set(input.papers.map((paper) => paper.id));
      const selectedPaths = new Set((input.selected ?? []).map((selection) => selection.path));
      for (const project of (await input.projects.listProjects()).filter((project) => selectedIds.has(project.paperId))) {
        for (const member of (await input.projects.listAssets(project.projectId)).filter((asset) => asset.kind === "note" || asset.kind === "board").slice(0, 12)) {
          input.signal.throwIfAborted();
          if (!member.ref) continue;
          const path = liteasyPath(input.scope, { kind: "object", ref: member.ref, followLatest: true });
          if (selectedPaths.has(path)) continue;
          try {
            const read = await input.assets.read(path, { maxCharacters: 4000, signal: input.signal });
            add({ id: path, path, kind: "annotation", title: member.title, revision: read.asset.revision || member.ref.revision,
              text: prose(read.text, read.asset.kind), provenance: "user-note", private: true });
          } catch { input.signal.throwIfAborted(); warnings.push(`关联笔记《${member.title}》暂不可用。`); }
        }
      }
    }
  }
  if (input.preferences.useAnnotations && input.repository && input.assets) {
    for (const selection of (input.selected ?? []).slice(0, 8)) {
      input.signal.throwIfAborted();
      try {
        const target = parseLiteasyPath(selection.path, input.scope);
        if (target.kind !== "object") continue;
        const source = await input.repository.resolveLatest(target.ref.objectId);
        const ref = { objectId: source.objectId, revision: source.revision };
        for (const relation of (await input.repository.listRelations(ref)).filter((relation) => relation.reviewStatus === "accepted").slice(0, 12)) {
          const other = relation.from.objectId === source.objectId ? relation.to : relation.from;
          const path = liteasyPath(input.scope, { kind: "object", ref: other, followLatest: true });
          const asset = await input.assets.stat(path, { signal: input.signal });
          if (!/note|annotation/.test(asset.kind)) continue;
          const read = await input.assets.read(path, { maxCharacters: 4000, signal: input.signal });
          add({ id: path, path, kind: "annotation", title: asset.title, revision: read.asset.revision || other.revision,
            text: read.text, provenance: "user-note", private: true });
        }
      } catch { input.signal.throwIfAborted(); warnings.push("部分关联笔记暂不可用。"); }
    }
  }
  if (input.preferences.useProfile && input.profile) {
    const fields = ["topics", "methods", "datasets", "projects", "familiarity"] as const;
    for (const field of fields) for (const [index, value] of (input.profile[field] ?? []).slice(0, 8).entries()) {
      add({ id: `profile:${field}:${index}`, kind: "profile", title: value, text: value, revision: value, provenance: "profile", private: true });
    }
  }
  const localCandidates: RecommendationItem[] = [];
  if (input.preferences.hybridEnabled && input.repository) {
    const selectedIds = new Set((input.selected ?? []).flatMap((selection) => {
      try { const target = parseLiteasyPath(selection.path, input.scope); return target.kind === "object" ? [target.ref.objectId] : []; } catch { return []; }
    }));
    const queryTerms = [...new Set(views.filter((view) => view.kind !== "profile").flatMap((view) => terms(view.text)))].slice(0, 4);
    for (const query of queryTerms) {
      input.signal.throwIfAborted();
      try {
        for (const row of await input.repository.searchTitles(query, 8)) {
          if (!row.summary?.trim() || selectedIds.has(row.objectId) || localCandidates.some((item) => item.id === `local:${row.objectId}`)) continue;
          const path = liteasyPath(input.scope, { kind: "object", ref: { objectId: row.objectId, revision: row.revision || "latest" }, followLatest: true });
          localCandidates.push({ id: `local:${row.objectId}`, resourcePath: path, resourceRevision: row.revision, title: row.title, abstract: row.summary.slice(0, 4000),
            source: "本地资产", sourceKind: "cache", discoveredAt: "", relevanceScore: .5, relevanceBand: "medium", reason: "来自已导入资产的题名和摘要。", relatedDocumentTitle: documents[0]?.title || "" });
        }
      } catch { warnings.push("部分本地资产索引暂不可用。"); }
    }
  }
  input.signal.throwIfAborted();
  return { views, documents, localCandidates: localCandidates.slice(0, 24), warnings: [...new Set(warnings)] };
}

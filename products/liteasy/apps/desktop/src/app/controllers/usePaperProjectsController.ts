import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactTab } from "../features/artifacts/artifact.types";
import type { MineruFigure } from "../features/import/import.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { Paper } from "../features/workspace/workspace.types";
import { createObjectStorage, subscribeObjectStorage } from "../features/objects/objectStorage";
import type { ObjectRef } from "../features/objects/object.types";
import { stageDataUrl } from "../features/objects/objectAssets";
import { loadUserPaperArtifact, subscribePaperFulltextSaved } from "../features/library/userPaperArtifactClient";
import { normalizePaperFulltext } from "../features/pdf/paperFulltextStore";
import { createPaperProjectRepository, type PaperProject, type PaperProjectAsset } from "../features/paper-projects/paperProjectRepository";

export type ProjectCatalog = { project: PaperProject; assets: PaperProjectAsset[] };
type SourceCache = { title: string; page: number; content: string; documentHash?: string };
const sameSource = (left: SourceCache | undefined, right: SourceCache) => left?.title === right.title && left.page === right.page && left.content === right.content && left.documentHash === right.documentHash;

/** Projects own references; source extraction and generated documents retain their stores. */
export function usePaperProjectsController(input: {
  scopeId: string;
  papers: Paper[];
  artifacts: ArtifactTab[];
  extractionVersion: unknown;
  getResources(paperId: string): { figures: MineruFigure[]; textChunks: RetrievalChunk[] } | null;
}) {
  const latest = useRef(input);
  latest.current = input;
  const storage = useMemo(() => createObjectStorage(input.scopeId, () => latest.current.scopeId), [input.scopeId]);
  const repository = useMemo(() => createPaperProjectRepository(storage, input.scopeId), [storage, input.scopeId]);
  const sync = useMemo(() => ({
    queue: Promise.resolve(),
    papers: new Map<string, { title: string; documentHash?: string; version: unknown; refresh: number; savedVersion: number }>(),
    fulltextVersions: new Map<string, number>(),
    sources: new Map<string, SourceCache>(),
  }), [repository]);
  const [state, setState] = useState({ scopeId: input.scopeId, catalog: [] as ProjectCatalog[], error: "", busy: false });
  const [revision, setRevision] = useState(0);
  const [fulltextRevision, setFulltextRevision] = useState(0);
  // Equivalent props from a parent render must not cancel and restart an in-flight import.
  const paperSignature = JSON.stringify(input.papers.map((paper) => [paper.id, paper.title, paper.contentHash]));
  const artifactSignature = JSON.stringify(input.artifacts.map((artifact) => [artifact.artifactId, artifact.title, artifact.papers?.map((paper) => paper.id), artifact.sourceContextRefs]));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = subscribePaperFulltextSaved((paperId) => {
      if (!latest.current.papers.some((paper) => paper.id === paperId)) return;
      sync.fulltextVersions.set(paperId, (sync.fulltextVersions.get(paperId) ?? 0) + 1);
      clearTimeout(timer);
      timer = setTimeout(() => setFulltextRevision((value) => value + 1), 250);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [sync]);

  useEffect(() => {
    let disposed = false;
    let readVersion = 0;
    let timer: ReturnType<typeof setTimeout>;
    setState({ scopeId: input.scopeId, catalog: [], error: "", busy: false });
    const refresh = async () => {
      const version = ++readVersion;
      try {
        const projects = await repository.listProjects();
        const catalog = await Promise.all(projects.map(async (project) => ({ project, assets: await repository.listAssets(project.projectId) })));
        if (!disposed && version === readVersion) setState((old) => JSON.stringify(old.catalog) === JSON.stringify(catalog) ? old : { ...old, catalog });
      } catch (failure) {
        if (!disposed && version === readVersion) setState((old) => ({ ...old, error: failure instanceof Error ? failure.message : "项目目录暂不可用。" }));
      }
    };
    void refresh();
    const unsubscribe = subscribeObjectStorage(input.scopeId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    });
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }, [repository, input.scopeId]);

  useEffect(() => {
    let disposed = false;
    const snapshot = latest.current;
    const active = () => !disposed && latest.current.scopeId === snapshot.scopeId;
    sync.queue = sync.queue.catch(() => undefined).then(async () => {
      if (!active()) return;
      setState((old) => ({ ...old, busy: true, error: "" }));
      const failures: string[] = [];
      const recordFailure = (label: string, failure: unknown) => {
        if (active()) failures.push(`${label}：${failure instanceof Error ? failure.message : "暂未保存，请重试。"}`);
      };
      const projects: Array<{ paper: Paper; project: PaperProject }> = [];
      try {
        // Create every project before reading bodies, so one damaged paper cannot hide others.
        for (const paper of snapshot.papers) {
          if (!active()) return;
          try {
            const project = await repository.ensurePaperProject({ paperId: paper.id, title: paper.title });
            projects.push({ paper, project });
          } catch (failure) { recordFailure(`「${paper.title}」项目`, failure); }
        }
        for (const { paper, project } of projects) {
          if (!active()) return;
          const previous = sync.papers.get(paper.id);
          const savedVersion = sync.fulltextVersions.get(paper.id) ?? 0;
          if (previous?.title === paper.title && previous.documentHash === paper.contentHash && previous.version === snapshot.extractionVersion && previous.refresh === revision && previous.savedVersion === savedVersion) continue;
          const failureCount = failures.length;
          let resources: ReturnType<typeof snapshot.getResources> = null;
          try { resources = snapshot.getResources(paper.id); }
          catch (failure) { recordFailure(`「${paper.title}」识别内容`, failure); }
          const pages = new Map<number, string>();
          for (const chunk of resources?.textChunks ?? []) {
            const text = chunk.sourceMarkdown || chunk.snippet;
            if (text.trim()) pages.set(chunk.page, [pages.get(chunk.page), text].filter(Boolean).join("\n\n"));
          }
          try {
            const fulltext = normalizePaperFulltext(await loadUserPaperArtifact({ artifactKind: "fulltext", paperId: paper.id }));
            if (!active()) return;
            for (const page of fulltext?.pages ?? []) if (page.text.trim()) pages.set(page.page, page.text);
          } catch (failure) { recordFailure(`「${paper.title}」原文读取`, failure); }
          for (const [page, text] of pages) {
            if (!active()) return;
            const assetId = `text:page:${page}`;
            const key = `${project.projectId}/${assetId}`;
            const candidate = { title: `${paper.title} · 第 ${page} 页`.slice(0, 1000), page, content: text, documentHash: paper.contentHash };
            if (sameSource(sync.sources.get(key), candidate)) continue;
            try {
              await repository.registerSource(project.projectId, { assetId, kind: "text", paperId: paper.id,
                title: candidate.title, page, text, documentHash: paper.contentHash });
              if (!active()) return;
              sync.sources.set(key, candidate);
            } catch (failure) { recordFailure(`「${paper.title}」第 ${page} 页原文`, failure); }
          }
          for (const figure of resources?.figures ?? []) {
            if (!active()) return;
            const assetId = `image:${figure.id}`;
            const key = `${project.projectId}/${assetId}`;
            const candidate = { title: (figure.alt || `第 ${figure.page} 页原图`).slice(0, 1000), page: figure.page, content: figure.dataUrl, documentHash: paper.contentHash };
            if (sameSource(sync.sources.get(key), candidate)) continue;
            try {
              const image = await stageDataUrl(figure.dataUrl);
              if (!active()) return;
              await repository.registerSource(project.projectId, { assetId, kind: "image", paperId: paper.id,
                title: candidate.title, page: figure.page, text: figure.alt || `第 ${figure.page} 页原图`, assets: [image], documentHash: paper.contentHash });
              if (!active()) return;
              sync.sources.set(key, candidate);
            } catch (failure) { recordFailure(`「${paper.title}」${candidate.title}`, failure); }
          }
          if (failures.length === failureCount) sync.papers.set(paper.id, { title: paper.title, documentHash: paper.contentHash, version: snapshot.extractionVersion, refresh: revision, savedVersion });
        }
        // Match each generated artifact against all projects, including shared object references.
        // A project remains selectable even when its paper is outside the current workspace.
        for (const project of await repository.listProjects()) {
          if (!active()) return;
          try {
            const assets = await repository.listAssets(project.projectId);
            const memberIds = new Set(assets.flatMap((asset) => asset.ref ? [asset.ref.objectId] : []));
            for (const artifact of snapshot.artifacts) {
              if (!active()) return;
              if (artifact.papers?.some((source) => source.id === project.paperId) || artifact.sourceContextRefs?.some((ref) => "objectId" in ref && memberIds.has(ref.objectId))) {
                try {
                  await repository.addAsset(project.projectId, { assetId: `artifact:${artifact.artifactId}`, title: artifact.title,
                    kind: "artifact", role: "derived", artifactId: artifact.artifactId });
                } catch (failure) { recordFailure(`「${project.title}」产物「${artifact.title}」`, failure); }
              }
            }
          } catch (failure) { recordFailure(`「${project.title}」产物目录`, failure); }
        }
      } catch (failure) {
        recordFailure("项目资产同步", failure);
      } finally {
        if (active()) setState((old) => ({ ...old, busy: false,
          error: failures.length ? `部分项目资产暂未保存（${failures.length} 项）。${failures.slice(0, 3).join("；")}${failures.length > 3 ? "；其余项目仍可使用。" : ""}` : "" }));
      }
    });
    return () => { disposed = true; };
  }, [repository, sync, input.scopeId, paperSignature, artifactSignature, input.extractionVersion, revision, fulltextRevision]);

  const current = state.scopeId === input.scopeId ? state : { catalog: [] as ProjectCatalog[], error: "", busy: false };
  return { catalog: current.catalog, error: current.error, busy: current.busy, repository, refresh: () => setRevision((value) => value + 1),
    createNote: (projectId: string, text: string) => repository.createNote(projectId, text),
    createEditableCopy: (projectId: string, ref: ObjectRef) => repository.createEditableCopy(projectId, ref),
  };
}
export type PaperProjectsController = ReturnType<typeof usePaperProjectsController>;

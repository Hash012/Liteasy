import { inferAssetType } from "../library/libraryAssetMetadata";
import { catalogSearchMetadata, noteSearchMetadata } from "../search/searchMetadata";
import { loadPaperFileMetadata } from "../library/paperFileMetadata";
import { applyBibliographicMetadata } from "../library/bibliographicFields";
import { createNotesRepository } from "../notes/notesRepository";
import { noteLabelKey } from "../notes/noteLabels";
import type { NotesItem, NotesTarget } from "../notes/notes.types";
import type { ObjectEnvelope } from "../objects/object.types";
import { sourceDocumentBodyCapability } from "../reading-library/readingResourceCapabilities";
import { contentFingerprint } from "../semantic-index/semanticIndexClient";
import { objectText, refOf } from "../objects/object.types";
import type { ObjectRepository } from "../objects/objectRepository";
import { createReadingLibraryRepository } from "../reading-library/readingLibraryRepository";
import { createObjectStorage } from "../objects/objectStorage";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import type { NoteFileService } from "../note-files/noteFileService";
import { loadUserPaperArtifact } from "../library/userPaperArtifactClient";
import { normalizePaperFulltext } from "../pdf/paperFulltextStore";
import { loadPdfAnnotations, normalizePdfAnnotationPrivateState, pdfAnnotationStorageKey } from "../pdf/pdfAnnotationStorage";
import type { Paper } from "../workspace/workspace.types";
import type { SearchDocument, SearchHit, SearchSection, SearchSource } from "./globalSearch.types";

function paperMetadataText(paper: Paper) {
  return [paper.title, paper.literature?.title, paper.literature?.abstract,
    Array.isArray(paper.authors) ? paper.authors.join(" ") : paper.authors, paper.year, paper.doi, paper.literature?.year, paper.literature?.authors?.join(" "), paper.literature?.subjects?.join(" "), paper.literature?.documentType].filter(Boolean).join("\n");
}

/** Only fields consumed by search invalidate the corpus; array identity and reader UI state do not. */
export function paperSearchSignature(papers: Paper[]) {
  return JSON.stringify(papers.map((paper) => [paper.id, paper.contentHash, paper.sourcePath, paperMetadataText(paper)])
    .sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

/** Reads only current scoped records and explicitly connected folders; never invokes a parser or model. */
export function createWorkspaceSearchSource(input: { repository: ObjectRepository; files: NoteFileService; getPapers(): Paper[]; active(): boolean }) : SearchSource {
  const scope = input.repository.scopeId;
  const reading = createReadingLibraryRepository(createObjectStorage(scope, () => input.active() ? scope : ""), scope);
  const notes = createNotesRepository(createObjectStorage(scope, () => input.active() ? scope : ""));
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (!input.active()) throw new Error("工作区已切换。"); };
  type MetadataSnapshot = { files: Awaited<ReturnType<typeof reading.list>>; metadata: Awaited<ReturnType<typeof reading.metadata>>; labels: Awaited<ReturnType<typeof notes.listLabels>> };
  async function snapshot(): Promise<MetadataSnapshot> { const [files, metadata, labels] = await Promise.all([reading.list(), reading.metadata(), notes.listLabels()]); return { files, metadata, labels }; }
  async function paperDocument(paper: Paper, signal: AbortSignal, cached?: MetadataSnapshot): Promise<SearchDocument> {
    cached ??= await snapshot(); check(signal);
    const legacy = await loadPaperFileMetadata(paper.id); check(signal);
    const overlay = cached.metadata[paper.id]; check(signal);
    const catalog = applyBibliographicMetadata({ id: paper.id, title: paper.literature?.title || paper.title, format: "pdf",
      authors: paper.literature?.authors ?? (typeof paper.authors === "string" ? [paper.authors] : [...(paper.authors ?? [])]),
      assetType: inferAssetType("pdf", paper.literature?.documentType), year: Number(paper.literature?.year ?? paper.year) || undefined, subjects: paper.literature?.subjects, abstract: paper.literature?.abstract,
      ...legacy, ...overlay }, overlay?.bibliographic);
    const metadata = catalogSearchMetadata(catalog);
    const path = liteasyPath(scope, { kind: "paper", paperId: paper.id });
    const sections: SearchSection[] = [{ key: "metadata", group: "metadata", text: [catalog.title, catalog.abstract, catalog.authors?.join(" "), catalog.year, paper.doi, ...(metadata.tags ?? [])].filter(Boolean).join("\n"), locator: { path, paperId: paper.id } }];
    let coverage: SearchDocument["coverage"] = "metadata", detail = "只有元信息；正文尚未提取。";
    try {
      const fulltext = normalizePaperFulltext(await loadUserPaperArtifact({ artifactKind: "fulltext", paperId: paper.id })); check(signal);
      const snapshot = normalizePdfAnnotationPrivateState(await loadUserPaperArtifact({ artifactKind: "annotations", paperId: paper.id })); check(signal);
      for (const page of fulltext?.pages ?? []) if (page.text.trim()) sections.push({ key: `page:${page.page}`, group: "body", text: page.text, locator: { path, paperId: paper.id, page: page.page } });
      const annotations = snapshot?.annotations ?? loadPdfAnnotations(pdfAnnotationStorageKey(paper));
      for (const annotation of annotations) {
        const labels = noteSearchMetadata({ annotation, target: { kind: "pdf-annotation", paperId: paper.id, annotationId: annotation.id } } as NotesItem, cached?.labels.get(noteLabelKey({ kind: "pdf-annotation", paperId: paper.id, annotationId: annotation.id })));
        sections.push({ metadata: { ...metadata, tags: [...(metadata.tags ?? []), ...(labels.tags ?? [])] }, key: `annotation:${annotation.id}`, group: "annotation", text: [annotation.excerpt, annotation.text, annotation.note, annotation.review?.text, annotation.quickAsk?.answer].filter(Boolean).join("\n"),
        locator: { path, paperId: paper.id, page: annotation.page, annotationId: annotation.id, quote: annotation.excerpt } });
      }
      if (sections.some((item) => item.group === "body")) { coverage = "partial"; detail = `已索引 ${sections.filter((item) => item.group === "body").length} 页已提取文本，未确认全文覆盖。`; }
      else if (fulltext?.pages.length) detail = "已读取页面没有可搜索文字；扫描页需先完成文字提取。";
    } catch (error) { check(signal); coverage = "failed"; detail = `正文或批注读取失败：${error instanceof Error ? error.message : String(error)}`; }
    return { id: `paper:${paper.id}`, title: catalog.title, metadata, sections, coverage, detail,
      revision: await contentFingerprint(JSON.stringify([paper.contentHash, paper.sourcePath, metadata, sections])) };
  }
  async function labelsFor(target: NotesTarget, object?: ObjectEnvelope, cached?: MetadataSnapshot) {
    const overrides = (cached?.labels ?? await notes.listLabels()).get(noteLabelKey(target));
    return noteSearchMetadata({ target, object } as NotesItem, overrides);
  }
  async function objectMetadata(object: ObjectEnvelope, cached?: MetadataSnapshot) {
    const file = (cached?.files ?? await reading.list()).find((entry) => entry.ref.objectId === object.objectId);
    if (file) {
      const overlay = (cached?.metadata ?? await reading.metadata())[file.id];
      return catalogSearchMetadata(applyBibliographicMetadata({ ...file, ...overlay }, overlay?.bibliographic));
    }
    return labelsFor({ kind: "object", ref: refOf(object), followLatest: true }, object, cached);
  }
  async function objectRevision(object: ObjectEnvelope, metadata: Awaited<ReturnType<typeof objectMetadata>>, cached: MetadataSnapshot) {
    const file = cached.files.find((entry) => entry.ref.objectId === object.objectId);
    return contentFingerprint(JSON.stringify([object.revision, metadata, file ? cached.metadata[file.id] : undefined]));
  }
  async function externalDocument(mountId: string, path: string, signal: AbortSignal, title?: string, cached?: MetadataSnapshot): Promise<SearchDocument> {
    const file = await input.files.readFile(mountId, path); check(signal);
    const target = liteasyPath(scope, { kind: "external-file", mountId, path });
    let text = file.text, coverage: SearchDocument["coverage"] = "indexed", detail: string | undefined;
    if (/\.canvas$/i.test(path)) {
      // Only visible text-node content; never index embedded file credentials or arbitrary extension payloads.
      const canvas = JSON.parse(text) as { nodes?: Array<{ type?: string; text?: string }> };
      text = (canvas.nodes ?? []).filter((node) => node.type === "text" && typeof node.text === "string").map((node) => node.text).join("\n\n");
      coverage = "partial"; detail = "仅检索白板文字卡片；命中可打开白板，布局节点定位暂不支持。";
    }
    const metadata = await labelsFor({ kind: "external-file", mountId, path }, undefined, cached); check(signal);
    return { metadata, id: `file:${await contentFingerprint(target)}`, title: title || file.name, revision: await contentFingerprint(JSON.stringify([file.version ?? file.text, metadata])), coverage, detail,
      sections: [{ key: "metadata", group: "metadata", text: title || file.name, locator: { path: target } },
        { key: "file", group: /\.canvas$/i.test(path) ? "artifact" : "note", text: `${text}`, locator: { path: target, line: 1 } }] };
  }
  return {
    async collect(signal, progress) {
      const documents: SearchDocument[] = []; const boardTitles = new Map<string, string>(); let limited = false, characters = 0;
      const append = (document: SearchDocument) => {
        if (documents.length >= 3000 || characters >= 16_000_000) { limited = true; return false; }
        let truncated = false;
        const sections = document.sections.map((section) => {
          const text = section.text.slice(0, Math.max(0, 16_000_000 - characters));
          characters += text.length; if (text.length !== section.text.length) { limited = true; truncated = true; }
          return { ...section, text };
        }); documents.push({ ...document, sections, ...(truncated ? { coverage: "partial" as const, detail: "本次索引已到达容量上限，只保留部分文字。" } : {}) }); progress(documents.length); return true;
      };
      const cached = await snapshot(); check(signal);
      for (const paper of input.getPapers()) { check(signal); if (!append(await paperDocument(paper, signal, cached))) break; }
      const library = new Map((cached.files).map((file) => [file.ref.objectId, file])); check(signal);
      const projections = await input.repository.fileProjectionIds();
      const titles = await input.repository.searchTitles("", 3001); check(signal);
      limited ||= titles.length > 3000;
      for (const title of titles.slice(0, 3000)) {
          if (documents.length >= 3000 || characters >= 16_000_000) { limited = true; break; }
          if (projections.has(title.objectId) || title.kind === "conversation.message" || title.kind === "source.document" && !library.has(title.objectId)) continue;
          let object;
          try { object = await input.repository.resolveLatest(title.objectId); check(signal); }
          catch { check(signal); append({ id: `object:${title.objectId}`, title: title.title, revision: "unavailable", sections: [], coverage: "failed", detail: "资产当前不可读取；可能已移除或格式不受支持。" }); continue; }
          if (object.lifecycle !== "active") continue;
          if (object.kind === "conversation.message") continue;
          if (object.kind === "workspace.board") {
            try {
              const binding = await input.repository.getBoardFileBinding<{ mountId: string; path: string }>(object.objectId); check(signal);
              if (binding && typeof binding.mountId === "string" && typeof binding.path === "string") boardTitles.set(`${binding.mountId}:${binding.path}`, object.title);
            } catch { check(signal); /* A missing binding does not hide the board's description. */ }
          }
          const file = library.get(object.objectId);
          const display = file ? applyBibliographicMetadata({ ...file, ...cached.metadata[file.id] }, cached.metadata[file.id]?.bibliographic) : undefined;
          // Extracted PDF pages are indexed above with real page locators, not as duplicated source snapshots.
          if (object.kind === "source.document" && !file) continue;
          const path = liteasyPath(scope, { kind: "object", ref: refOf(object), followLatest: true });
          const unavailable = object.kind === "source.document" && !sourceDocumentBodyCapability(object).available;
          const text = unavailable ? file?.fileName ?? object.title : objectText(object);
          const sections: SearchSection[] = [{ key: "metadata", group: "metadata",
            text: [display?.title || object.title, file?.fileName, display?.authors?.join(" "), display?.publishedAt,
              display?.publication, display?.identifier, display?.abstract].filter(Boolean).join("\n"),
            locator: { path, ...(file ? { readingId: file.id } : {}) } }];
          if (!unavailable) sections.push({ key: "object",
            group: object.kind === "source.document" ? "body" : object.kind === "artifact.document" || object.kind === "workspace.board"
              ? "artifact" : object.kind === "content.fragment" ? "annotation" : "note",
            text, locator: { path, line: 1, ...(file ? { readingId: file.id } : {}) } });
          const metadata = await objectMetadata(object, cached); check(signal);
          if (!append({ metadata, id: `object:${object.objectId}`, title: display?.title || object.title, revision: await objectRevision(object, metadata, cached),
            coverage: unavailable ? "metadata" : file?.contextTruncated || object.kind === "workspace.board" ? "partial" : "indexed",
            detail: unavailable ? "此格式只保存原文件，正文未提取。" : file?.contextTruncated ? "仅索引导入时保留的文本节选。" : object.kind === "workspace.board" ? "仅检索白板描述；卡片内容通过独立笔记检索。" : undefined,
            sections })) break;
      }
      for (const mount of await input.files.listMounts()) {
        check(signal); if (limited) break;
        try {
          for (const entry of await input.files.listEntries(mount.id)) {
            check(signal); if (entry.kind !== "file") continue;
            try { if (!append(await externalDocument(mount.id, entry.path, signal, boardTitles.get(`${mount.id}:${entry.path}`), cached))) break; }
            catch (error) { check(signal); append({ id: `unavailable:${mount.id}:${entry.path}`, title: entry.name, revision: "unavailable", sections: [], coverage: "failed", detail: String(error) }); }
          }
        } catch (error) { check(signal); append({ id: `unavailable:${mount.id}`, title: mount.name, revision: "unavailable", sections: [], coverage: "failed", detail: "连接目录暂不可读取。" }); }
      }
      check(signal); return { documents, limited };
    },
    async verify(hit: SearchHit, signal: AbortSignal) {
      check(signal);
      try {
        const target = parseLiteasyPath(hit.path, scope);
        if (target.kind === "paper") {
          const paper = input.getPapers().find((paper) => paper.id === target.paperId);
          if (!paper) return false;
          const current = await paperDocument(paper, signal); check(signal);
          return current.revision === hit.revision;
        }
        if (target.kind === "object") {
          const object = await input.repository.resolveLatest(target.ref.objectId); check(signal);
          if (object.kind === "source.document" && !(await reading.list()).some((file) => file.ref.objectId === object.objectId)) return false;
          const cached = await snapshot(); check(signal);
          return object.lifecycle === "active" && await objectRevision(object, await objectMetadata(object, cached), cached) === hit.revision;
        }
        if (target.kind === "external-file") {
          if (!(await input.files.listMounts()).some((mount) => mount.id === target.mountId)) return false;
          const current = await externalDocument(target.mountId, target.path, signal); check(signal);
          return current.revision === hit.revision;
        }
        return false;
      } catch { check(signal); return false; }
    },
  };
}

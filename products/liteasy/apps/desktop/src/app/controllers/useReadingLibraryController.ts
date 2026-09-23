import { useEffect, useMemo, useRef, useState } from "react";
import { createObjectStorage, subscribeObjectStorage } from "../features/objects/objectStorage";
import { createReadingLibraryRepository, MAX_LIBRARY_FILE_BYTES, type ReadingLibraryFile, type ReadingMetadata } from "../features/reading-library/readingLibraryRepository";
import type { ParsedReadingDocument } from "../features/reading-library/readingDocument.types";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import { loadPaperFileMetadata, savePaperFileMetadata } from "../features/library/paperFileMetadata";
import { liteasyPath, type ResourceTarget } from "../features/resource-filesystem/liteasyPath";
import { displayPath } from "../features/resource-filesystem/displayPath";
import type { Paper } from "../features/workspace/workspace.types";

export function useReadingLibraryController(input: {
  scopeId: string; papers: Paper[]; enabled: boolean;
  importPdfs(files: File[]): Promise<unknown>;
  openPaper(id: string): void;
}) {
  const latest = useRef(input); latest.current = input;
  const repository = useMemo(() => createReadingLibraryRepository(
    createObjectStorage(input.scopeId, () => latest.current.scopeId), input.scopeId
  ), [input.scopeId]);
  const [files, setFiles] = useState<ReadingLibraryFile[]>([]);
  const [stateScope, setStateScope] = useState(input.scopeId);
  const [metadata, setMetadata] = useState<Record<string, ReadingMetadata>>({});
  const [legacyMetadata, setLegacyMetadata] = useState<Record<string, ReadingMetadata>>({});
  const [active, setActive] = useState<{ id: string; document: ParsedReadingDocument }>();
  const [pending, setPending] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const importing = useRef(false);
  const current = () => latest.current.scopeId === input.scopeId;
  useEffect(() => {
    setStateScope(input.scopeId);
    request.current += 1; setActive(undefined); setFiles([]); setMetadata({}); setLegacyMetadata({}); setMessage(""); setPending(false);
  }, [input.scopeId]);
  useEffect(() => {
    if (!input.enabled) return;
    setCatalogLoading(true);
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const refresh = async () => {
      const id = ++generation;
      try {
        const [nextFiles, nextMetadata] = await Promise.all([repository.list(), repository.metadata()]);
        if (!cancelled && current() && id === generation) { setFiles(nextFiles); setMetadata(nextMetadata); }
      } catch (error) { if (!cancelled && current()) setMessage(String(error)); }
      finally { if (!cancelled && current() && id === generation) setCatalogLoading(false); }
    };
    void refresh();
    const unsubscribe = subscribeObjectStorage(input.scopeId, () => {
      clearTimeout(timer); timer = setTimeout(() => void refresh(), 120);
    });
    return () => { cancelled = true; clearTimeout(timer); unsubscribe(); };
  }, [repository, input.enabled]);
  // Existing paper categories remain visible. Hydrate in bounded batches without
  // blocking the initial catalog or dispatching thousands of native calls at once.
  const paperKey = input.papers.map((paper) => paper.id).join("\n");
  useEffect(() => {
    if (!input.enabled) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, ReadingMetadata> = {};
      for (let offset = 0; offset < input.papers.length && !cancelled; offset += 8) {
        const batch = input.papers.slice(offset, offset + 8);
        await Promise.all(batch.map(async (paper) => {
          const value = await loadPaperFileMetadata(paper.id);
          next[paper.id] = { collection: value.category, tags: value.tags };
        }));
      }
      if (!cancelled && current()) setLegacyMetadata(next);
    })().catch((error) => { if (!cancelled && current()) setMessage(`部分分类读取失败：${String(error)}`); });
    return () => { cancelled = true; };
  }, [paperKey, input.scopeId, input.enabled]);
  const entries = useMemo<ReadingCatalogEntry[]>(() => {
    if (stateScope !== input.scopeId) return [];
    const papers = input.papers.map((paper): ReadingCatalogEntry => {
      const authors = paper.literature?.authors ?? (typeof paper.authors === "string" ? [paper.authors] : [...(paper.authors ?? [])]);
      const year = Number(paper.literature?.year ?? paper.year);
      return {
        id: paper.id, title: paper.literature?.title ?? paper.title, format: "pdf", authors,
        year: Number.isInteger(year) && year >= 1000 ? year : undefined,
        doi: paper.doi ?? paper.literature?.identifiers.find((identifier) => identifier.kind === "doi")?.value,
        fileName: paper.sourcePath?.split(/[\\/]/).at(-1),
        physicalPath: paper.sourcePath && /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(paper.sourcePath) ? displayPath(paper.sourcePath) : undefined,
        available: Boolean(paper.sourcePath), canExport: false, canRemove: false,
        readingStatus: "unread", ...legacyMetadata[paper.id], ...metadata[paper.id],
        liteasyPath: liteasyPath(input.scopeId, { kind: "paper", paperId: paper.id })
      };
    });
    return [...papers, ...files.map((file): ReadingCatalogEntry => ({
      ...file, year: /^\d{4}/.test(file.publishedAt ?? "") ? Number(file.publishedAt!.slice(0, 4)) : undefined,
      readingStatus: "unread", available: true, ...metadata[file.id],
      liteasyPath: liteasyPath(input.scopeId, { kind: "object", ref: file.ref, followLatest: true })
    }))];
  }, [input.papers, input.scopeId, stateScope, files, metadata, legacyMetadata]);
  async function updateMetadata(id: string, patch: ReadingMetadata) {
    const value = await repository.updateMetadata(id, patch);
    if (latest.current.papers.some((paper) => paper.id === id) && (patch.tags || patch.collection !== undefined)) {
      const old = await loadPaperFileMetadata(id);
      if (!current()) return;
      await savePaperFileMetadata(id, { category: patch.collection ?? old.category, tags: patch.tags ?? old.tags });
    }
    if (current()) setMetadata((previous) => ({ ...previous, [id]: value }));
  }
  async function importFiles(selected: File[]) {
    if (importing.current) return;
    importing.current = true; setPending(true); setMessage("");
    let imported = 0, duplicates = 0;
    const errors: string[] = [];
    try {
      for (const file of selected) {
        if (!current()) break;
        try {
          if (/\.pdf$/i.test(file.name)) { await input.importPdfs([file]); imported += 1; continue; }
          if (!/\.(epub|md|markdown|txt)$/i.test(file.name)) throw new Error("支持 PDF、EPUB、Markdown 和 TXT。");
          if (file.size > MAX_LIBRARY_FILE_BYTES) throw new Error("文件超过 20 MB。");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { parseReadingFile } = await import("../features/reading-library/parseReadingFile");
          const document = await parseReadingFile({ name: file.name, bytes });
          if (!current()) break;
          const result = await repository.importFile(file.name, bytes, document);
          if (result.duplicate) duplicates += 1; else imported += 1;
        } catch (error) { errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`); }
        // Yield between files so large batches leave input and scrolling responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (current()) {
        const nextFiles = await repository.list();
        if (current()) {
          setFiles(nextFiles);
          setMessage(`已导入 ${imported} 个文件${duplicates ? `，跳过 ${duplicates} 个重复文件` : ""}。${errors.length ? `\n${errors.join("\n")}` : ""}`);
        }
      }
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { importing.current = false; if (current()) setPending(false); }
  }
  async function open(entry: ReadingCatalogEntry) {
    if (entry.format === "pdf") {
      request.current += 1; setPending(false);
      input.openPaper(entry.id);
      if (metadata[entry.id]?.readingStatus !== "finished") {
        try { await updateMetadata(entry.id, { readingStatus: "reading" }); }
        catch (error) { if (current()) setMessage(String(error)); }
      }
      return;
    }
    const id = ++request.current; setPending(true); setMessage("");
    try {
      const { entry: file, bytes } = await repository.readFile(entry.id);
      const { parseReadingFile } = await import("../features/reading-library/parseReadingFile");
      const document = await parseReadingFile({ name: file.fileName, bytes });
      if (id !== request.current || !current()) return;
      setActive({ id: entry.id, document });
      if (metadata[entry.id]?.readingStatus !== "finished") await updateMetadata(entry.id, { readingStatus: "reading" });
    } catch (error) { if (id === request.current && current()) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (id === request.current && current()) setPending(false); }
  }
  return {
    entries, active: stateScope === input.scopeId ? active : undefined,
    pending: stateScope === input.scopeId && (pending || catalogLoading),
    message: stateScope === input.scopeId ? message : "", importFiles, updateMetadata,
    open: (entry: ReadingCatalogEntry) => { void open(entry); },
    closeReader: () => { request.current += 1; setActive(undefined); setPending(false); },
    target(entry: ReadingCatalogEntry): ResourceTarget {
      const file = files.find((file) => file.id === entry.id);
      return file ? { kind: "object", ref: file.ref, followLatest: true } : { kind: "paper", paperId: entry.id };
    },
    async exportFile(entry: ReadingCatalogEntry) {
      try {
        const { entry: file, bytes } = await repository.readFile(entry.id);
        if (!current()) return;
        const url = URL.createObjectURL(new Blob([bytes.slice()]));
        const link = document.createElement("a"); link.href = url; link.download = file.fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { if (current()) setMessage(String(error)); }
    },
    async remove(entry: ReadingCatalogEntry) {
      if (!window.confirm(`将“${entry.title}”移出书库？已有笔记和 Agent 引用将继续保留。`)) return;
      try {
        await repository.removeFromLibrary(entry.id);
        if (current()) {
          setFiles((previous) => previous.filter((file) => file.id !== entry.id));
          if (active?.id === entry.id) { request.current += 1; setActive(undefined); }
          setMessage("已移出书库。");
        }
      } catch (error) { if (current()) setMessage(String(error)); }
    }
  };
}

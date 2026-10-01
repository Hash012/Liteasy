import { importDownloadedPdf, releaseDownloadedPdf } from "../features/paper-services/paperFullTextTransport";
import { useEffect, useRef, useState } from "react";
import { createLocalLibraryClient } from "../features/library/localLibraryClient";
import { createLocalLibraryFolder, persistPdfByteStream } from "../features/library/libraryFileSystemClient";
import { sanitizeExternalPdfFileName } from "../features/library/externalPdfDownload";
import { displayPath } from "../features/resource-filesystem/displayPath";
import { libraryFolderKey } from "../features/library/libraryFolderMembership";
import { downloadRecommendationPdf } from "../features/recommendations/recommendationPdfClient";
import type { RecommendationDownloadOptions, RecommendationItem } from "../features/recommendations/recommendation.types";
import type { PaperServiceConfig } from "../features/paper-services/paperServiceTransport";
import type { ImportedPaper } from "../features/library/paperImport.types";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { LiteratureAuthorityClient } from "../features/paper-identity/literatureAuthorityClient";
import { loadRecommendationMetadata } from "../features/recommendations/recommendationPresentation";

export function useRecommendationLibraryController(input: {
  endpoint: string;
  scopeKey: string;
  transport?: ModelTransport;
  service?: PaperServiceConfig;
  metadataClient?: LiteratureAuthorityClient;
  refreshLocalLibrary: () => void | Promise<void>;
  onSaved: (item: RecommendationItem) => void | Promise<void>;
  onImportedMetadata?: (paperId: string, item: RecommendationItem) => Promise<void>;
}) {
  const [selection, setSelection] = useState<{ scopeKey: string; item: RecommendationItem }>();
  const [preview, setPreview] = useState<{ scopeKey: string; item: RecommendationItem; loading: boolean; message: string }>();
  const previewRequest = useRef(0);
  const metadataCache = useRef(new Map<string, { item: RecommendationItem; time: number }>());
  useEffect(() => {
    metadataCache.current.clear();
    setPreview((current) => current?.scopeKey === input.scopeKey ? { ...current, loading: false } : undefined);
    return () => { previewRequest.current++; };
  }, [input.scopeKey, input.metadataClient]);
  const currentScope = useRef(input.scopeKey);
  currentScope.current = input.scopeKey;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Map<string, Promise<string>>());
  async function open(item: RecommendationItem, refresh = false) {
    const scopeKey = input.scopeKey;
    const request = ++previewRequest.current;
    setSelection({ scopeKey, item });
    const cached = metadataCache.current.get(item.id);
    if (!refresh && cached && Date.now() - cached.time < 300_000) {
      setPreview({ scopeKey, item: cached.item, loading: false, message: "" });
      return;
    }
    setPreview({ scopeKey, item, loading: Boolean(input.metadataClient), message: "" });
    if (!input.metadataClient) return;
    try {
      const result = await loadRecommendationMetadata(item, input.metadataClient);
      if (request !== previewRequest.current || scopeKey !== currentScope.current) return;
      metadataCache.current.set(item.id, { item: result.item, time: Date.now() });
      if (metadataCache.current.size > 30) metadataCache.current.delete(metadataCache.current.keys().next().value!);
      setPreview({ scopeKey, ...result, loading: false });
      setSelection((current) => current?.scopeKey === scopeKey && current.item.id === item.id ? { scopeKey, item: result.item } : current);
    } catch {
      if (request === previewRequest.current && scopeKey === currentScope.current)
        setPreview({ scopeKey, item, loading: false, message: "暂未能更新题录，仍可阅读已有信息或打开论文网站。" });
    }
  }

  function importPaper(item: RecommendationItem, options: RecommendationDownloadOptions = {}, signal?: AbortSignal): Promise<ImportedPaper> {
    const scopeKey = input.scopeKey;
    const assertCurrent = (committed = false) => { if (!committed) signal?.throwIfAborted(); if (currentScope.current !== scopeKey) throw new Error("账号或数据目录已切换，已停止后续下载写入。请在当前文献库重新下载。"); };
    const task = queue.current.catch(() => undefined).then(async () => {
      assertCurrent();
      const initialSnapshot = await createLocalLibraryClient()();
      assertCurrent();
      const pdf = await downloadRecommendationPdf({ endpoint: input.endpoint, transport: input.transport, service: input.service, recommendation: item, signal, nativeDownload: true, onProgress: options.onProgress });
      if (!pdf) throw new Error("已查询全文源，暂未提供可下载的开放 PDF。可打开论文网站查看机构订阅或作者提供的版本。");
      try {
      assertCurrent();
      const importedItem = { ...item, ...pdf.metadata };
      let snapshot = await createLocalLibraryClient()();
      assertCurrent();
      if (snapshot.libraryId !== initialSnapshot.libraryId || snapshot.rootPath !== initialSnapshot.rootPath) throw new Error("文献库目录已切换，下载未写入新目录，请重试。");
      const target = options.targetFolderPath;
      if (target && libraryFolderKey(target) !== libraryFolderKey(snapshot.rootPath) &&
        !snapshot.folders.some((folder) => libraryFolderKey(folder.path) === libraryFolderKey(target)))
        throw new Error("保存目录已不存在，请重新选择文献库目录。");
      const name = options.newFolderName?.trim() || (!target ? "Download" : "");
      if (name && /[\\/<>:"|?*]|^(?:\.|\.\.)$/.test(name)) throw new Error("目录名称不能包含路径分隔符或特殊字符。");
      const parent = target || snapshot.rootPath;
      const folderIn = (value: typeof snapshot) => value.folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase() &&
        libraryFolderKey(folder.parentPath || value.rootPath) === libraryFolderKey(parent));
      let folder = name ? folderIn(snapshot) : { path: parent };
      if (!folder && name) { snapshot = await createLocalLibraryFolder(name, parent); folder = folderIn(snapshot); }
      assertCurrent();
      if (!folder) throw new Error("无法建立保存目录，请刷新文献库后重试。");
      const wasExisting = snapshot.entries.some((entry) => entry.contentHash?.replace(/^sha256:/, "") === pdf.contentHash);
      const imported = pdf.downloadId ? await importDownloadedPdf(pdf.downloadId, sanitizeExternalPdfFileName(importedItem.title), folder.path) : await persistPdfByteStream({ fileName: sanitizeExternalPdfFileName(importedItem.title),
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(pdf.bytes); controller.close(); } }),
        signal, targetFolderPath: folder.path, onDuplicate: () => false });
      assertCurrent(true);
      await input.refreshLocalLibrary();
      assertCurrent(true);
      const entry = imported.entries.find((entry) => entry.contentHash?.replace(/^sha256:/, "") === pdf.contentHash);
      let metadataWarning = "";
      if (entry && !wasExisting && !signal?.aborted && input.onImportedMetadata) {
        try { await input.onImportedMetadata(entry.id, importedItem); }
        catch { metadataWarning = "题录信息暂未保存，可右键获取元信息。"; }
      }
      // Feedback is best effort; an already saved PDF must never be reported as lost.
      if (!signal?.aborted) await Promise.resolve().then(() => input.onSaved(item)).catch(() => undefined);
      if (!entry) throw new Error("PDF 已保存，但未能读取新条目，请刷新文献库确认。");
      const message = wasExisting && entry.path
        ? `文献已在本地库中：${displayPath(entry.path)}`
        : `已下载《${importedItem.title}》到 ${displayPath(folder.path)}。${metadataWarning}`;
      return { paperId: entry.id, title: importedItem.title, filePath: displayPath(entry.path || folder.path), duplicate: wasExisting, message };
      } finally { if (pdf.downloadId) await releaseDownloadedPdf(pdf.downloadId); }
    });
    queue.current = task;
    return task;
  }
  function download(item: RecommendationItem, options: RecommendationDownloadOptions = {}): Promise<string> {
    const key = JSON.stringify([input.scopeKey, item.id, options]);
    const existing = pending.current.get(key);
    if (existing) return existing;
    const task = importPaper(item, options, options.signal).then((result) => result.message).finally(() => pending.current.delete(key));
    pending.current.set(key, task);
    return task;
  }
  return { selected: selection?.scopeKey === input.scopeKey ? selection.item : undefined,
    preview: preview?.scopeKey === input.scopeKey ? preview : undefined, open,
    select: (item: RecommendationItem) => setSelection({ scopeKey: input.scopeKey, item }),
    clear: () => setSelection(undefined), download, importPaper };
}

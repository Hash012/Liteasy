import { useRef, useState } from "react";
import { createLocalLibraryClient } from "../features/library/localLibraryClient";
import { createLocalLibraryFolder, persistPdfByteStream } from "../features/library/libraryFileSystemClient";
import { sanitizeExternalPdfFileName } from "../features/library/externalPdfDownload";
import { displayPath } from "../features/resource-filesystem/displayPath";
import { libraryFolderKey } from "../features/library/libraryFolderMembership";
import { downloadRecommendationPdf } from "../features/recommendations/recommendationPdfClient";
import type { RecommendationItem } from "../features/recommendations/recommendation.types";
import type { ModelTransport } from "../features/models/modelHttpClient";

export function useRecommendationLibraryController(input: {
  endpoint: string;
  scopeKey: string;
  transport?: ModelTransport;
  refreshLocalLibrary: () => void | Promise<void>;
  onSaved: (item: RecommendationItem) => void | Promise<void>;
  onImportedMetadata?: (paperId: string, item: RecommendationItem) => Promise<void>;
}) {
  const [selection, setSelection] = useState<{ scopeKey: string; item: RecommendationItem }>();
  const currentScope = useRef(input.scopeKey);
  currentScope.current = input.scopeKey;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Map<string, Promise<string>>());
  function download(item: RecommendationItem): Promise<string> {
    const scopeKey = input.scopeKey;
    const pendingKey = `${scopeKey}:${item.id}`;
    const assertCurrent = () => { if (currentScope.current !== scopeKey) throw new Error("账号或数据目录已切换，已停止后续下载写入。请在当前文献库重新下载。"); };
    const existing = pending.current.get(pendingKey);
    if (existing) return existing;
    const task = queue.current.catch(() => undefined).then(async () => {
      assertCurrent();
      const initialSnapshot = await createLocalLibraryClient()();
      assertCurrent();
      const pdf = await downloadRecommendationPdf({ endpoint: input.endpoint, transport: input.transport, recommendation: item });
      assertCurrent();
      if (!pdf) throw new Error("这篇文献暂未提供可下载的开放 PDF。可在底部元信息中打开来源页面查看获取方式。");
      let snapshot = await createLocalLibraryClient()();
      assertCurrent();
      if (snapshot.libraryId !== initialSnapshot.libraryId || snapshot.rootPath !== initialSnapshot.rootPath) throw new Error("文献库目录已切换，下载未写入新目录，请重试。");
      const folderIn = (value: typeof snapshot) => value.folders.find((folder) => folder.name.toLowerCase() === "download" &&
        (!folder.parentPath || libraryFolderKey(folder.parentPath) === libraryFolderKey(value.rootPath)));
      let folder = folderIn(snapshot);
      if (!folder) { snapshot = await createLocalLibraryFolder("Download", snapshot.rootPath); folder = folderIn(snapshot); }
      assertCurrent();
      if (!folder) throw new Error("无法建立文献库 Download 目录，请刷新文献库后重试。");
      const wasExisting = snapshot.entries.some((entry) => entry.contentHash?.replace(/^sha256:/, "") === pdf.contentHash);
      const imported = await persistPdfByteStream({ fileName: sanitizeExternalPdfFileName(item.title),
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(pdf.bytes); controller.close(); } }),
        targetFolderPath: folder.path, onDuplicate: () => false });
      assertCurrent();
      await input.refreshLocalLibrary();
      assertCurrent();
      const entry = imported.entries.find((entry) => entry.contentHash?.replace(/^sha256:/, "") === pdf.contentHash);
      let metadataWarning = "";
      if (entry && !wasExisting && input.onImportedMetadata) {
        try { await input.onImportedMetadata(entry.id, item); }
        catch { metadataWarning = "题录信息暂未保存，可右键获取元信息。"; }
      }
      // Feedback is best effort; an already saved PDF must never be reported as lost.
      await Promise.resolve().then(() => input.onSaved(item)).catch(() => undefined);
      return wasExisting && entry?.path
        ? `文献已在本地库中：${displayPath(entry.path)}`
        : `已下载《${item.title}》到文献库 / Download。${metadataWarning}`;
    }).finally(() => pending.current.delete(pendingKey));
    pending.current.set(pendingKey, task);
    queue.current = task;
    return task;
  }
  return { selected: selection?.scopeKey === input.scopeKey ? selection.item : undefined,
    select: (item: RecommendationItem) => setSelection({ scopeKey: input.scopeKey, item }),
    clear: () => setSelection(undefined), download };
}

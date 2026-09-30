import { strToU8 } from "fflate";
import { bibtex, fileName, ris } from "../shared/references";
import { getFile } from "../shared/library";
import type { SavedItem } from "../shared/types";

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportLibrary(items: SavedItem[], format: "json" | "bib" | "ris" | "zip"): Promise<void> {
  const name = `liteasy-library-${new Date().toISOString().slice(0, 10)}`;
  if (format === "bib" || format === "ris") {
    download(new Blob([format === "bib" ? bibtex(items.map(i => i.item)) : ris(items.map(i => i.item))], { type: "text/plain;charset=utf-8" }), `${name}.${format}`);
    return;
  }
  const json = JSON.stringify({ format: "liteasy-connector-library", version: 1, exportedAt: new Date().toISOString(), items }, null, 2);
  if (format === "json") {
    download(new Blob([json], { type: "application/json" }), `${name}.json`);
    return;
  }
  const entries: Record<string, Uint8Array> = {
    "library.json": strToU8(json),
    "references.bib": strToU8(bibtex(items.map(i => i.item))),
    "references.ris": strToU8(ris(items.map(i => i.item))),
    "README.txt": strToU8("Liteasy Connector 文献归档\nPDF/EPUB 与网页快照在 attachments/。可将 PDF 导入 Liteasy 桌面文献库。library.json 保留元数据及来源。此归档不包含阅读进度、批注或白板，请在对应工作区单独导出。\n")
  };
  let size = strToU8(json).length;
  for (const item of items) {
    for (const attachment of item.attachments) {
      const file = await getFile(attachment.id);
      if (!file) throw new Error(`附件缺失：${attachment.title}；归档未导出。`);
      size += file.blob.size;
      if (size > 200 * 1024 * 1024) throw new Error("归档超过 200 MiB，请按分类分批导出。");
      const ext = file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "text/html" ? "html" : "epub";
      entries[`attachments/${item.id}/${file.id}-${fileName(file.title)}.${ext}`] = new Uint8Array(await file.blob.arrayBuffer());
    }
  }
  // fflate's async API creates Blob workers, which MV3 CSP rejects for large
  // entries. Compress in a packaged worker with no eval or Blob script URLs.
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL("liteasy-export-worker.js"));
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("归档压缩超时，请分批导出。")); }, 120000);
    const stop = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = event => { stop(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.data); };
    worker.onerror = () => { stop(); reject(new Error("归档压缩失败，请重试。")); };
    worker.postMessage(entries, Object.values(entries).map(entry => entry.buffer as ArrayBuffer));
  });
  download(new Blob([new Uint8Array(data)], { type: "application/zip" }), `${name}.zip`);
}

import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import { ReadingLibraryCatalog } from "../library/ReadingLibraryCatalog";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "../library/readingCatalog.types";
import type { ParsedReadingDocument } from "./readingDocument.types";

const ReadingDocumentReader = lazy(() => import("./ReadingDocumentReader").then((module) => ({ default: module.ReadingDocumentReader })));

export function ReadingLibrarySurface(props: {
  entries: ReadingCatalogEntry[]; active?: { id: string; document: ParsedReadingDocument };
  pending: boolean; message: string; scopeId: string;
  onImportFiles(files: File[]): Promise<void>; onOpen(entry: ReadingCatalogEntry): void;
  onCloseReader(): void; onMetadataChange(id: string, patch: ReadingCatalogMetadataPatch): Promise<void>;
  onExport(entry: ReadingCatalogEntry): Promise<void>; onRemove(entry: ReadingCatalogEntry): Promise<void>;
  renderLocation(entry: ReadingCatalogEntry): ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(new Set<string>());
  const [saveError, setSaveError] = useState("");
  const activeEntry = props.entries.find((entry) => entry.id === props.active?.id);
  return <section className="reading-library-surface" aria-label="书库与元信息" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault(); event.stopPropagation();
      if (!props.pending) void props.onImportFiles(Array.from(event.dataTransfer.files));
    }}>
    <input ref={input} type="file" hidden multiple accept=".pdf,.epub,.md,.markdown,.txt" aria-label="选择阅读文件"
      onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void props.onImportFiles(files); }} />
    {props.active ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--line-1)" }}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={props.onCloseReader}>返回书库</Button>
        {activeEntry ? props.renderLocation(activeEntry) : null}
      </div>
      {props.message || saveError ? <p role="status">{saveError || props.message}</p> : null}
      <Suspense fallback={<Spinner label="正在准备阅读器…" />}>
        <ReadingDocumentReader key={`${props.scopeId}:${props.active.id}`} document={props.active.document} documentId={props.active.id} storageScope={props.scopeId}
          onProgressChange={(progress) => {
            const id = props.active!.id, key = `${props.scopeId}:${id}`;
            if (progress < 1 || activeEntry?.readingStatus === "finished" || finished.current.has(key)) return;
            finished.current.add(key);
            void props.onMetadataChange(id, { readingStatus: "finished" }).catch((error) => { finished.current.delete(key); setSaveError(String(error)); });
          }} />
      </Suspense>
    </> : null}
    <div hidden={Boolean(props.active)} style={{ flex: 1, minHeight: 0 }}>
      <ReadingLibraryCatalog entries={props.entries} onOpen={props.onOpen} loading={props.pending} message={props.message}
      onImport={() => input.current?.click()} onMetadataChange={props.onMetadataChange}
      onExport={props.onExport} onDelete={props.onRemove} renderLocation={props.renderLocation} />
    </div>
  </section>;
}

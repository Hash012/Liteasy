import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "../library/readingCatalog.types";
import type { ParsedReadingDocument } from "./readingDocument.types";

const ReadingDocumentReader = lazy(() => import("./ReadingDocumentReader").then((module) => ({ default: module.ReadingDocumentReader })));

export function ReadingLibrarySurface(props: {
  entries: ReadingCatalogEntry[]; active?: { id: string; document: ParsedReadingDocument };
  pending: boolean; message: string; scopeId: string;
  onCloseReader(): void; onMetadataChange(id: string, patch: ReadingCatalogMetadataPatch): Promise<void>;
  onExport(entry: ReadingCatalogEntry): Promise<void>; onRemove(entry: ReadingCatalogEntry): Promise<void>;
  renderLocation(entry: ReadingCatalogEntry): ReactNode;
}) {
  const finished = useRef(new Set<string>());
  const [saveError, setSaveError] = useState("");
  const activeEntry = props.entries.find((entry) => entry.id === props.active?.id);
  return <section className="reading-library-surface" aria-label="文件阅读器" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
    {props.active ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--line-1)" }}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={props.onCloseReader}>返回文献库</Button>
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
    {!props.active ? <p className="reading-reader-empty">在文献库中双击一个文件开始阅读。</p> : null}
  </section>;
}

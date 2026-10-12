import { compileNoteDocument } from "../features/document-export/noteExportAdapter";
import type { NotesItem } from "../features/notes/notes.types";
import { useEffect, useRef, useState } from "react";
import { compileArtifactDocument } from "../features/document-export/artifactExportAdapter";
import { renderExportDocument } from "../features/document-export/documentExportService";
import type { ExportOptions } from "../features/document-export/documentExport.types";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import { liteasyPath } from "../features/resource-filesystem/liteasyPath";
import type { ArtifactExportPayload } from "../features/artifacts/artifactExport.types";
import type { ArtifactExportClient } from "../features/artifacts/artifactExportClient";
import type {
  ArtifactDocumentFormat,
  ArtifactExportHistoryStatus,
  ArtifactExportOutcome,
  ArtifactExportRecord
} from "../features/artifacts/artifactExport.types";
import type { ArtifactTab } from "../features/artifacts/artifact.types";

type UseArtifactExportControllerInput = {
  client: ArtifactExportClient;
  scopeId?: string;
  sessionGeneration?: string;
  assets?: AgentAssetService;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useArtifactExportController({ client, scopeId, sessionGeneration, assets }: UseArtifactExportControllerInput) {
  const [error, setError] = useState<string>();
  const [records, setRecords] = useState<ArtifactExportRecord[]>([]);
  const [status, setStatus] = useState<ArtifactExportHistoryStatus>("idle");
  const clientRef = useRef(client);
  const requestRef = useRef(0);
  clientRef.current = client;
  const scopeRef = useRef(scopeId); scopeRef.current = scopeId;
  const generationRef = useRef(sessionGeneration); generationRef.current = sessionGeneration;
  const assetsRef = useRef(assets); assetsRef.current = assets;

  async function loadRecords(preservedError?: string) {
    const requestId = ++requestRef.current;
    setStatus("loading");
    if (!preservedError) setError(undefined);
    try {
      const nextRecords = await clientRef.current.list();
      if (requestId !== requestRef.current) return;
      setRecords(nextRecords);
      setError(preservedError);
      setStatus("ready");
    } catch (loadError) {
      if (requestId !== requestRef.current) return;
      setError(errorMessage(loadError));
      setStatus("error");
    }
  }

  useEffect(() => {
    void loadRecords();
    return () => {
      requestRef.current += 1;
    };
  }, []);

  async function compileArtifact(tab: ArtifactTab, options: Partial<ExportOptions> = {}, signal?: AbortSignal) {
    const capturedScope = scopeRef.current;
    const capturedGeneration = generationRef.current;
    const document = await compileArtifactDocument(tab, { options, signal, assets: assetsRef.current,
      basePath: capturedScope ? liteasyPath(capturedScope, { kind: "artifact", artifactId: tab.artifactId }) : undefined,
      active: () => capturedScope === scopeRef.current && capturedGeneration === generationRef.current });
    document.scopeId = capturedScope;
    document.sessionGeneration = capturedGeneration;
    document.protectedPaths = [tab.sourcePath, tab.resultPath].filter((path): path is string => Boolean(path));
    return document;
  }
  async function compileNote(item: NotesItem, options: Partial<ExportOptions>, signal?: AbortSignal) {
    const capturedScope = scopeRef.current;
    const capturedGeneration = generationRef.current;
    const document = await compileNoteDocument(item, { scopeId: capturedScope, assets: assetsRef.current, options, signal, active: () => capturedScope === scopeRef.current && capturedGeneration === generationRef.current });
    document.sessionGeneration = capturedGeneration; return document;
  }
  async function publish(payload: ArtifactExportPayload, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (payload.scopeId !== scopeRef.current || payload.sessionGeneration !== generationRef.current) throw new Error("账号已切换，导出已中止。");
    const outcome = await clientRef.current.export(payload);
    if (outcome.status !== "cancelled") await loadRecords(outcome.warnings?.includes("history_write_failed") ? "文件已交付，但未写入导出历史。" : undefined);
    return outcome;
  }
  async function exportArtifact(
    tab: ArtifactTab,
    format: ArtifactDocumentFormat,
    options: Partial<ExportOptions> = {}
  ): Promise<ArtifactExportOutcome> {
    try {
      return await publish(await renderExportDocument(await compileArtifact(tab, options), format));
    } catch (exportError) {
      setError(errorMessage(exportError));
      throw exportError;
    }
  }

  async function openExport(recordId: string) {
    try {
      await clientRef.current.open(recordId);
      setError(undefined);
    } catch (openError) {
      const message = errorMessage(openError);
      setError(message);
      await loadRecords(message);
    }
  }

  async function revealExport(recordId: string) {
    try {
      await clientRef.current.reveal(recordId);
      setError(undefined);
    } catch (revealError) {
      const message = errorMessage(revealError);
      setError(message);
      await loadRecords(message);
    }
  }

  async function removeExport(recordId: string) {
    try {
      await clientRef.current.remove(recordId);
      await loadRecords();
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  }

  return {
    actions: {
      exportArtifact,
      compileArtifact,
      compileNote,
      publish,
      openExport,
      refresh: () => loadRecords(),
      removeExport,
      revealExport
    },
    model: {
      error,
      records,
      status
    }
  };
}

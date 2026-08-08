import { useEffect, useRef, useState } from "react";
import { createArtifactExportPayload } from "../features/artifacts/artifactDocumentExport";
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
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useArtifactExportController({ client }: UseArtifactExportControllerInput) {
  const [error, setError] = useState<string>();
  const [records, setRecords] = useState<ArtifactExportRecord[]>([]);
  const [status, setStatus] = useState<ArtifactExportHistoryStatus>("idle");
  const clientRef = useRef(client);
  const requestRef = useRef(0);
  clientRef.current = client;

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

  async function exportArtifact(
    tab: ArtifactTab,
    format: ArtifactDocumentFormat
  ): Promise<ArtifactExportOutcome> {
    try {
      const outcome = await clientRef.current.export(createArtifactExportPayload(tab, format));
      if (outcome.status === "saved") {
        await loadRecords();
      }
      return outcome;
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

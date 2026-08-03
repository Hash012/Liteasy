import { useEffect, useRef, useState } from "react";

import { loadUserPaperArtifact, saveUserPaperArtifact } from "../library/userPaperArtifactClient";
import type { Paper } from "../workspace/workspace.types";
import {
  createGrobidCitationClient,
  readGrobidCitationSnapshot,
  type GrobidCitationSnapshot
} from "./grobidCitationClient";

type UsePdfCitationParsingInput = {
  activePaper: Paper | null;
  allowServerPdfParsing: boolean;
  enabled?: boolean;
  endpoint: string;
  fullDocumentTextReady: boolean;
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  pageTexts: Readonly<Record<number, string>>;
};

async function fetchPdfBytes(sourcePath: string, signal: AbortSignal) {
  const response = await fetch(sourcePath, { signal });
  if (!response.ok) throw new Error(`无法读取 PDF（${response.status}）。`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadPaperPdfBytes(input: {
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  signal: AbortSignal;
  sourcePath: string;
}) {
  if (input.loadPdfSource) return input.loadPdfSource(input.sourcePath);
  return fetchPdfBytes(input.sourcePath, input.signal);
}

/**
 * Hydrates a structured citation snapshot, then optionally creates it with explicit consent.
 *
 * The snapshot is stored as the paper's `citations` artifact and read back by thin reading, which
 * attributes references to the concepts it generated. Nothing here interprets the citations
 * itself — the reader only parses and persists them.
 */
export function usePdfCitationParsing({
  activePaper,
  allowServerPdfParsing,
  enabled = true,
  endpoint,
  fullDocumentTextReady,
  loadPdfSource,
  pageTexts
}: UsePdfCitationParsingInput) {
  const [snapshot, setSnapshot] = useState<GrobidCitationSnapshot | null>(null);
  const [hydratedPaperId, setHydratedPaperId] = useState<string | null>(null);
  const attemptedPaperIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    const paperId = activePaper?.id;
    setSnapshot(null);
    setHydratedPaperId(null);
    attemptedPaperIdRef.current = null;
    setLoading(false);
    setWarning("");
    if (!enabled || !paperId) return;
    let cancelled = false;
    void loadUserPaperArtifact<unknown>({ artifactKind: "citations", paperId })
      .then((stored) => {
        if (cancelled) return;
        setSnapshot(readGrobidCitationSnapshot(stored));
        setHydratedPaperId(paperId);
      })
      .catch(() => {
        if (!cancelled) setHydratedPaperId(paperId);
      });
    return () => {
      cancelled = true;
    };
  }, [activePaper?.id, enabled]);

  useEffect(() => {
    const paperId = activePaper?.id;
    const sourcePath = activePaper?.sourcePath?.trim();
    if (!enabled || !paperId || hydratedPaperId !== paperId || snapshot || attemptedPaperIdRef.current === paperId ||
      !fullDocumentTextReady) return;
    if (!allowServerPdfParsing) {
      setWarning("云端结构解析已关闭，当前使用本地引用解析。");
      return;
    }
    if (!endpoint.trim()) {
      setWarning("结构解析服务尚未配置，当前使用本地引用解析。");
      return;
    }
    if (!sourcePath) {
      setWarning("当前论文没有可读取的 PDF 源，使用本地引用解析。");
      return;
    }

    const controller = new AbortController();
    attemptedPaperIdRef.current = paperId;
    setLoading(true);
    setWarning("");
    void loadPaperPdfBytes({ loadPdfSource, signal: controller.signal, sourcePath })
      .then((pdfBytes) => createGrobidCitationClient({ endpoint })({
        pageTexts,
        pdfBytes,
        signal: controller.signal
      }))
      .then((parsed) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setSnapshot(parsed);
        void saveUserPaperArtifact({
          artifactKind: "citations",
          paperId,
          snapshot: parsed
        }).catch(() => undefined);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setWarning(
          `${reason instanceof Error ? reason.message : "结构解析暂时不可用。"} 已回退到本地引用解析。`
        );
      });
    return () => controller.abort();
  }, [
    activePaper?.id,
    activePaper?.sourcePath,
    allowServerPdfParsing,
    enabled,
    endpoint,
    fullDocumentTextReady,
    hydratedPaperId,
    loadPdfSource,
    pageTexts,
    snapshot
  ]);

  return {
    loading,
    parser: snapshot ? "grobid" as const : "local_patterns" as const,
    parserVersion: snapshot?.parserVersion ?? 1,
    warning
  };
}

import { useEffect, useMemo, useState } from "react";
import type { AccountSession } from "../account/account.types";
import type { Paper } from "../workspace/workspace.types";
import {
  createDocumentMetadataClient,
  type DocumentMetadataTransport
} from "./documentMetadataClient";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "./metadata.types";

type UseDocumentMetadataSyncInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  documents: Paper[];
  transport?: DocumentMetadataTransport;
  workspaceRevision: number;
};

function buildDocumentCacheKey(documents: Paper[]) {
  return documents
    .map((document) => `${document.id}:${document.title}:${document.sourcePath ?? ""}`)
    .sort()
    .join("|");
}

export function useDocumentMetadataSync({
  accountSession,
  controlPlaneEndpoint,
  documents,
  transport,
  workspaceRevision
}: UseDocumentMetadataSyncInput) {
  const documentCacheKey = useMemo(() => buildDocumentCacheKey(documents), [documents]);
  const [lastResult, setLastResult] = useState<DocumentMetadataSyncResult | null>(null);
  const [message, setMessage] = useState("连接云账号后会同步当前工作区的文献元数据。");
  const [status, setStatus] = useState<DocumentMetadataSyncStatus>("unauthenticated");

  useEffect(() => {
    if (!accountSession) {
      setLastResult(null);
      setStatus("unauthenticated");
      setMessage("连接云账号后会同步当前工作区的文献元数据。");
      return;
    }

    if (documents.length === 0) {
      setLastResult(null);
      setStatus("idle");
      setMessage("当前工作区没有需要同步的文献元数据。");
      return;
    }

    let active = true;
    setStatus("syncing");
    setMessage("正在同步当前工作区文献元数据...");

    const client = createDocumentMetadataClient({
      endpoint: controlPlaneEndpoint,
      transport
    });

    void client({
      documents: documents.map((document) => ({
        id: document.id,
        sourcePath: document.sourcePath,
        title: document.title
      })),
      sessionId: accountSession.sessionId,
      workspaceRevision
    })
      .then((result) => {
        if (!active) {
          return;
        }

        setLastResult(result);
        setStatus("success");
        setMessage(`已同步 ${result.acceptedCount} 篇文献元数据。`);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const detail = error instanceof Error ? error.message : "未知错误";
        setLastResult(null);
        setStatus("error");
        setMessage(`文献元数据同步失败。详细信息：${detail}`);
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, documentCacheKey, transport, workspaceRevision]);

  return {
    lastResult,
    message,
    status
  };
}

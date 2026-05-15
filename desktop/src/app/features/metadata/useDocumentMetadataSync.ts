import { formatCloudConnectionError } from "../network/cloudErrorMessage";
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
  const [message, setMessage] = useState("当前已退化为本地阅读器，文献元数据同步不可用。联网并登录后，将自动恢复云端能力。");
  const [retryCount, setRetryCount] = useState(0);
  const [status, setStatus] = useState<DocumentMetadataSyncStatus>("unauthenticated");

  function retrySync() {
    setRetryCount((current) => current + 1);
  }

  useEffect(() => {
    if (!accountSession) {
      setLastResult(null);
      setStatus("unauthenticated");
      setMessage("当前已退化为本地阅读器，文献元数据同步不可用。联网并登录后，将自动恢复云端能力。");
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

        const detail = formatCloudConnectionError(error, {
          controlPlaneEndpoint
        });
        setLastResult(null);
        setStatus("error");
        setMessage(`文献元数据同步失败。详细信息：${detail}`);
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, documentCacheKey, retryCount, transport, workspaceRevision]);

  return {
    lastResult,
    message,
    retrySync,
    status
  };
}

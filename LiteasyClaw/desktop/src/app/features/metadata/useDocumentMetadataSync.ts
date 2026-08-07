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
  enabled: boolean;
  transport?: DocumentMetadataTransport;
  workspaceRevision: number;
};

function buildDocumentCacheKey(documents: Paper[]) {
  return documents
    .map((document) => [
      document.id,
      document.contentHash ?? "",
      document.title,
      Array.isArray(document.authors) ? document.authors.join(";") : document.authors ?? "",
      document.doi ?? "",
      document.year ?? ""
    ].join(":"))
    .sort()
    .join("|");
}

export async function buildAccountScopedSyncDocumentId(
  accountIdentity: string,
  documentId: string
) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前环境无法生成账号域内的文献同步标识。");
  }
  const bytes = new TextEncoder().encode(`${accountIdentity.trim().toLowerCase()}:${documentId}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `local-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function useDocumentMetadataSync({
  accountSession,
  controlPlaneEndpoint,
  documents,
  enabled,
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

    if (!enabled) {
      setLastResult(null);
      setStatus("idle");
      setMessage("个性化已关闭，本地文献清单不会上传。");
      return;
    }

    let active = true;
    setStatus("syncing");
    setMessage("正在同步当前工作区文献元数据...");

    const client = createDocumentMetadataClient({
      endpoint: controlPlaneEndpoint,
      transport
    });

    const accountIdentity = accountSession.userId ?? accountSession.email;
    void Promise.all(documents.map(async (document) => {
      const publicationYear = typeof document.year === "number"
        ? document.year
        : typeof document.year === "string" && /^\d{4}$/.test(document.year)
          ? Number(document.year)
          : undefined;
      const authors = Array.isArray(document.authors)
        ? [...document.authors]
        : typeof document.authors === "string" && document.authors.trim()
          ? [document.authors.trim()]
          : undefined;
      return {
        authors,
        contentHash: document.contentHash,
        doi: document.doi,
        publicationYear,
        syncDocumentId: await buildAccountScopedSyncDocumentId(accountIdentity, document.id),
        title: document.title
      };
    })).then((sanitizedDocuments) => client({
      documents: sanitizedDocuments,
      sessionId: accountSession.sessionId,
      workspaceRevision
    }))
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
  }, [accountSession?.sessionId, controlPlaneEndpoint, documentCacheKey, enabled, retryCount, transport, workspaceRevision]);

  return {
    lastResult,
    message,
    retrySync,
    status
  };
}

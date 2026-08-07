import { useCallback, useEffect, useState } from "react";
import {
  createCloudLibraryStorageClient,
  type CloudLibraryQuota,
  type CloudLibraryTree
} from "./cloudLibraryStorageClient";

type CloudLibraryTreeStatus = "idle" | "loading" | "ready" | "error";

export function useCloudLibraryTree(input: {
  enabled: boolean;
  endpoint: string;
  refreshKey?: number;
  scopeId?: string;
  scopeType: "organization" | "user";
}) {
  const [tree, setTree] = useState<CloudLibraryTree | null>(null);
  const [trashTree, setTrashTree] = useState<CloudLibraryTree | null>(null);
  const [quota, setQuota] = useState<CloudLibraryQuota | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<CloudLibraryTreeStatus>("idle");

  const refresh = useCallback(async () => {
    if (!input.enabled || !input.scopeId) {
      setTree(null);
      setTrashTree(null);
      setQuota(null);
      setMessage("");
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
      const scope = { scopeId: input.scopeId, scopeType: input.scopeType } as const;
      const [active, trash] = await Promise.all([
        client.getTree(scope, "active"),
        client.getTree(scope, "trashed")
      ]);
      setTree(active.tree);
      setTrashTree(trash.tree);
      setQuota(active.quota);
      setMessage("");
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "云端文献树加载失败。");
      setStatus("error");
    }
  }, [input.enabled, input.endpoint, input.scopeId, input.scopeType]);

  useEffect(() => {
    void refresh();
  }, [refresh, input.refreshKey]);

  return { message, quota, refresh, status, trashTree, tree };
}

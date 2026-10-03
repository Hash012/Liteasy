import { useCallback, useEffect, useRef, useState } from "react";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";
import {
  createCloudLibraryStorageClient,
  type CloudLibraryQuota,
  type CloudLibraryTree
} from "./cloudLibraryStorageClient";

type CloudLibraryTreeStatus = "idle" | "loading" | "ready" | "error";
type TreeState = {
  key: string;
  tree: CloudLibraryTree | null;
  trashTree: CloudLibraryTree | null;
  quota: CloudLibraryQuota | null;
  message: string;
  status: CloudLibraryTreeStatus;
};
const emptyState: TreeState = { key: "", tree: null, trashTree: null, quota: null, message: "", status: "idle" };

export function useCloudLibraryTree(input: {
  enabled: boolean;
  endpoint: string;
  refreshKey?: number;
  scopeId?: string;
  scopeType: "organization" | "user";
}) {
  const generation = getAccountSessionGeneration();
  const key = JSON.stringify([input.enabled, input.endpoint, input.scopeType, input.scopeId, generation]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const requestRevision = useRef(0);
  const [state, setState] = useState<TreeState>(emptyState);

  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    const isCurrent = () => currentKey.current === key && requestRevision.current === revision && generation === getAccountSessionGeneration();
    if (!input.enabled || !input.scopeId) {
      setState({ ...emptyState, key });
      return;
    }
    setState({ ...emptyState, key, status: "loading" });
    try {
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
      const scope = { scopeId: input.scopeId, scopeType: input.scopeType } as const;
      const [active, trash] = await Promise.all([
        client.getTree(scope, "active"),
        client.getTree(scope, "trashed")
      ]);
      if (!isCurrent()) return;
      setState({ key, tree: active.tree, trashTree: trash.tree, quota: active.quota, message: "", status: "ready" });
    } catch (error) {
      if (!isCurrent()) return;
      setState({ ...emptyState, key, message: error instanceof Error ? error.message : "云端文献树加载失败。", status: "error" });
    }
  }, [key, generation, input.enabled, input.endpoint, input.scopeId, input.scopeType]);

  useEffect(() => {
    void refresh();
    return () => { ++requestRevision.current; };
  }, [refresh, input.refreshKey]);

  const visible = state.key === key ? state : emptyState;
  return { message: visible.message, quota: visible.quota, refresh, status: visible.status, trashTree: visible.trashTree, tree: visible.tree };
}

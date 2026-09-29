import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLocalAssetMcp } from "../../features/local-mcp/localAssetMcp";
import type { LocalMcpInfo, LocalMcpModel } from "../../features/local-mcp/localMcpContext";
import type { AgentAssetService } from "../../features/resource-filesystem/agentAssetService";

let configurationQueue: Promise<unknown> = Promise.resolve();
function configureHost(args: { enabled: boolean; writable: boolean; scopeId: string }) {
  const task = configurationQueue.catch(() => undefined).then(() => invoke<LocalMcpInfo>("local_mcp_configure", args));
  configurationQueue = task;
  return task;
}
type Request = { requestId: string; scopeId: string; generation: string; writable: boolean; line: string };

export function useLocalAssetMcp(scopeId: string, assets: AgentAssetService): LocalMcpModel {
  const [policy, setPolicy] = useState({ scopeId, enabled: false, writable: false });
  const [info, setInfo] = useState<LocalMcpInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<LocalMcpModel["recent"]>();
  const current = useRef({ scopeId, policy });
  current.current = { scopeId, policy };
  // Explicit opt-in per app run; account switches revoke access until re-enabled.
  useEffect(() => {
    setRecent(undefined);
    setPolicy((previous) => previous.scopeId === scopeId ? previous : { scopeId, enabled: false, writable: false });
  }, [scopeId]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    let stopCancel: (() => void) | undefined;
    let host: LocalMcpInfo | undefined;
    const requests = new Map<string, AbortController>();
    const mcp = createLocalAssetMcp(assets);
    setBusy(true); setError("");
    const active = () => !disposed && current.current.scopeId === scopeId && current.current.policy === policy;
    void (async () => {
      stop = await listen<Request>("liteasy-local-mcp-request", async ({ payload }) => {
        if (!active() || !host?.enabled || payload.scopeId !== scopeId || payload.generation !== host.generation) return;
        const abort = new AbortController();
        requests.set(payload.requestId, abort);
        try {
          const line = await mcp.handleLine(payload.line, { writable: host.writable && payload.writable, signal: abort.signal });
          await invoke("local_mcp_reply", { requestId: payload.requestId, response: { line } });
          try {
            const request = JSON.parse(payload.line);
            if (active() && request.method === "tools/call" && line) {
              const reply = JSON.parse(line);
              setRecent({ tool: String(request.params?.name ?? ""), failed: !!(reply.error || reply.result?.isError), at: new Date().toLocaleTimeString() });
            }
          } catch { /* Protocol errors already have a reply. */ }
        } catch (e) {
          await invoke("local_mcp_reply", { requestId: payload.requestId, response: { error: String(e) } }).catch(() => undefined);
        } finally { requests.delete(payload.requestId); }
      });
      stopCancel = await listen<{ requestId: string }>("liteasy-local-mcp-cancel", ({ payload }) => requests.get(payload.requestId)?.abort());
      if (!active()) { stop(); stopCancel(); return; }
      host = await configureHost({ enabled: policy.scopeId === scopeId && policy.enabled,
        writable: policy.scopeId === scopeId && policy.writable, scopeId });
      if (active()) setInfo(host);
    })().catch((e) => { if (active()) { setInfo(undefined); setError(String(e)); } }).finally(() => { if (active()) setBusy(false); });
    return () => {
      disposed = true;
      requests.forEach((abort) => abort.abort());
      stop?.(); stopCancel?.();
      void configureHost({ enabled: false, writable: false, scopeId }).catch(() => undefined);
    };
  }, [scopeId, assets, policy]);
  return { info: info?.scopeId && info.scopeId !== scopeId ? undefined : info, busy, error, recent,
    configure: (enabled, writable) => setPolicy({ scopeId, enabled, writable: enabled && writable }) };
}

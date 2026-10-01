import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { AccountSession } from "../features/account/account.types";
import type { DeviceControlModel } from "../features/device-control/DeviceControlPanel";
import { createDeviceControlClient } from "../features/device-control/deviceControlClient";
import { DeviceExecutor } from "../features/device-control/deviceExecutor";
import { emptyDeviceJournal, type DeviceTaskKind, type DeviceSnapshot } from "../features/device-control/deviceControl.types";
import { prepareDeviceTask, type DeviceTaskActions } from "./deviceTaskActions";

const emptySnapshot = (): DeviceSnapshot => ({ devices: [], pairs: [], tasks: [] });
export function useDeviceControlController(input: Omit<DeviceTaskActions, "current"> & { endpoint: string; session: AccountSession | null; libraryRoot: string | null }): DeviceControlModel {
  const latest = useRef(input); latest.current = input;
  const scope = input.session?.userId ? `${input.endpoint}:${input.session.userId}:${input.libraryRoot ?? ""}` : "";
  const activeScope = useRef(scope); activeScope.current = scope;
  const [loadedScope, setLoadedScope] = useState(""); const [executor, setExecutor] = useState<DeviceExecutor>();
  const [snapshot, setSnapshot] = useState<DeviceSnapshot>(emptySnapshot); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number }>(); const [, render] = useState(0);
  const clientRef = useRef<ReturnType<typeof createDeviceControlClient>>();
  useEffect(() => {
    setLoadedScope(""); setExecutor(undefined); setSnapshot(emptySnapshot()); setCode(undefined); setError(""); setBusy(false);
    if (!scope || !isTauri()) return;
    let alive = true; let runner: DeviceExecutor | undefined;
    const current = () => alive && activeScope.current === scope;
    const client = createDeviceControlClient(input.endpoint, input.session!.userId!, () => current() ? latest.current.session : null);
    clientRef.current = client;
    const tick = async () => { if (!current() || !runner) return; try { await runner.tick(); if (current()) { setError(""); render((value) => value + 1); } }
      catch (failure) { if (current()) setError(String(failure)); } };
    void client.load().then((journal) => {
      if (!current()) return;
      const heartbeat = async () => {
        const capabilities: DeviceTaskKind[] = journal.enabled ? ["open-document", "extract-text", "sync-library", ...(journal.allowSummary ? ["summarize-document" as const] : [])] : [];
        await client.request("devices/heartbeat", { name: journal.name || "Liteasy 桌面", capabilities });
      };
      runner = new DeviceExecutor(journal, { request: client.request, save: client.save, heartbeat,
        changed: (value) => { if (current()) setSnapshot(value); },
        prepare: (task) => prepareDeviceTask(task, { ...latest.current, current }) });
      setExecutor(runner); setLoadedScope(scope);
      // Opt-in is local. An untouched installation makes no registration or polling request.
      if (journal.enabled || journal.pending) void tick();
    }).catch((failure) => { if (current()) setError(String(failure)); });
    const timer = setInterval(() => { if (runner?.journal.enabled || runner?.journal.pending) void tick(); }, 5_000);
    return () => { alive = false; clearInterval(timer); runner?.stop(); };
  }, [scope]);
  const available = Boolean(scope && loadedScope === scope && executor);
  async function action(work: (value: DeviceExecutor, client: NonNullable<typeof clientRef.current>) => Promise<void>) {
    if (!available || !executor || !clientRef.current || busy) return;
    setBusy(true); setError("");
    try { await work(executor, clientRef.current); if (activeScope.current === scope) render((value) => value + 1); }
    catch (failure) { if (activeScope.current === scope) setError(String(failure)); }
    finally { if (activeScope.current === scope) setBusy(false); }
  }
  return { available, journal: available ? executor!.journal : emptyDeviceJournal(), snapshot: available ? snapshot : emptySnapshot(), error, busy, code: available ? code : undefined,
    loadResult: async (task) => { if (!available || activeScope.current !== scope || !clientRef.current) throw new Error("账号已切换。");
      const value = await clientRef.current.request<{ task: typeof task }>(`tasks/${task.taskId}`); if (activeScope.current !== scope) throw new Error("账号已切换。"); return value.task; },
    configure: (enabled, summary, name) => action(async (value) => { await value.configure(enabled, summary, name); }),
    pair: () => action(async (_, client) => { const value = await client.request<{ code: string; expiresAt: number }>("devices/pair-code", {}); if (activeScope.current === scope) setCode(value); }),
    unpair: (id) => action(async (_, client) => { await client.request(`pairs/${id}`, undefined, "DELETE"); const value = await client.request<DeviceSnapshot>("devices"); if (activeScope.current === scope) setSnapshot(value); }),
    refresh: () => action(async (_, client) => { const value = await client.request<DeviceSnapshot>("devices"); if (activeScope.current === scope) setSnapshot(value); }) };
}

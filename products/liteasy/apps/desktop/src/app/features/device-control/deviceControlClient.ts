import { invoke } from "@tauri-apps/api/core";
import type { AccountSession } from "../account/account.types";
import type { DeviceJournal } from "./deviceControl.types";

export function createDeviceControlClient(endpointUrl: string, subject: string, getSession: () => AccountSession | null) {
  function identity() {
    const session = getSession();
    if (!session?.sessionId || session.userId !== subject) throw new Error("账号已变更，请重新打开设备设置。");
    return { endpointUrl, subject, sessionId: session.sessionId };
  }
  return {
    request: <T>(route: string, body?: Record<string, unknown>, method?: "GET" | "POST" | "DELETE") => invoke<T>("device_control_request", { ...identity(), route, body: body ?? null, method: method ?? (body ? "POST" : "GET") }),
    load: () => invoke<DeviceJournal>("device_control_journal", { ...identity(), snapshot: null }),
    save: async (snapshot: DeviceJournal) => { await invoke("device_control_journal", { ...identity(), snapshot }); }
  };
}

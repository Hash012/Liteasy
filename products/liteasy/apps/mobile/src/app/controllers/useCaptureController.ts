import { useCallback, useEffect, useState } from "react";
import { shareInbox, type ShareInbox, type SharedCapture, type CaptureEdit } from "../features/capture/shareInbox";

export function useCaptureController(scope: string, onImported: () => Promise<void>, inbox: ShareInbox = shareInbox) {
  const [captures, setCaptures] = useState<SharedCapture[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setCaptures(await inbox.list()); }, [inbox]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try { const items = await inbox.list(); if (active) setCaptures(items); }
      catch (reason) { if (active) setError(String(reason)); }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2000);
    window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    return () => { active = false; clearInterval(interval); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); };
  }, [inbox]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); await refresh(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusy(false); }
  };
  return { captures, error, busy,
    save: (id: string, input: CaptureEdit) => run(async () => { await inbox.import(scope, id, input); await onImported(); }),
    discard: (id: string) => run(() => inbox.discard(id)) };
}

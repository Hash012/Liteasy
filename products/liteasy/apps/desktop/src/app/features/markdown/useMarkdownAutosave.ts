import { useEffect, useRef, useState } from "react";

/** Debounce edits, serialize writes, and stop on conflicts/errors. Never flush a stale callback on unmount. */
export function useMarkdownAutosave(input: { identity?: string; value?: string; saved?: string; enabled: boolean; busy: boolean; blocked?: boolean; save(): Promise<void> }) {
  const latest = useRef(input); latest.current = input;
  const inFlight = useRef(false);
  const [composing, setComposing] = useState(false);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    const start = () => setComposing(true), end = () => setComposing(false);
    document.addEventListener("compositionstart", start); document.addEventListener("compositionend", end);
    return () => { document.removeEventListener("compositionstart", start); document.removeEventListener("compositionend", end); };
  }, []);
  useEffect(() => { setFailed(undefined); }, [input.identity, input.saved]);
  useEffect(() => {
    if (!input.identity || !input.enabled || input.busy || input.blocked || failed || composing || input.value === input.saved) return;
    const key = input.identity, text = input.value;
    const timer = setTimeout(() => {
      const now = latest.current;
      if (inFlight.current || now.identity !== key || now.value !== text || now.busy || now.blocked || !now.enabled) return;
      inFlight.current = true;
      void now.save().catch((e) => { if (latest.current.identity === key) setFailed(String(e)); }).finally(() => { inFlight.current = false; });
    }, 1500);
    return () => clearTimeout(timer);
  }, [input.identity, input.value, input.saved, input.enabled, input.busy, input.blocked, composing, failed]);
  return failed;
}

import { useEffect, useRef, useState } from "react";
import { rankContextRecommendations } from "../features/recommendations/recommendationHybridPipeline";
export function useContextRankedRecommendations(input: Omit<Parameters<typeof rankContextRecommendations>[0], "signal" | "active"> & { enabled: boolean }) {
  const signature = JSON.stringify([input.enabled, input.scope, input.workspace, input.items, input.context, input.preferences, input.style]);
  const latest = useRef(signature); latest.current = signature;
  const [state, setState] = useState({ signature: "", items: input.items, pending: false, warning: "" });
  useEffect(() => {
    if (!input.enabled) return;
    const abort = new AbortController();
    setState({ signature, items: input.items, pending: true, warning: "" });
    const active = () => latest.current === signature && !abort.signal.aborted;
    void rankContextRecommendations({ ...input, signal: abort.signal, active }).then((result) => {
      if (active()) setState({ signature, ...result, pending: false });
    }, (error: unknown) => { if (active()) setState({ signature, items: input.items, pending: false, warning: String(error) }); });
    return () => abort.abort();
  }, [signature]);
  return state.signature === signature ? state : { items: input.items, pending: input.enabled, warning: "" };
}

import { useEffect, useId, useRef, useState } from "react";
import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import type { ContextAssetPreview } from "../assistant/contextAssetPreview";
import { createPreviewRequest, previewErrorMessage } from "../resource-links/previewRequest";
import { assetPreviewKey, createPreviewResourceCache, tracePreview } from "../resource-links/previewResource";

const previews = createPreviewResourceCache<ContextAssetPreview>(12, 32 * 1024 * 1024, value =>
  (value.text?.length ?? 0) * 2 + (value.images ?? []).reduce((sum, image) => sum + image.url.length * 2, 0));
export function useStableAssetPreview(asset: AssistantComposerSuggestion | undefined, enabled: boolean, attempt: number) {
  const fallback = useId();
  const key = asset ? assetPreviewKey(asset, "asset", fallback) : "";
  const latest = useRef(asset); latest.current = asset;
  const hasLoader = Boolean(asset?.loadPreview && !asset.unavailableReason);
  const [result, setResult] = useState<{ key: string; value?: ContextAssetPreview; error?: string }>();
  useEffect(() => {
    if (!enabled || !hasLoader) return;
    const abort = new AbortController();
    tracePreview("preview.mount", key);
    const lease = previews.acquire(`${key}:${attempt}`, async signal => {
      const request = createPreviewRequest({ signal });
      try { tracePreview("preview.read-bytes", key); return await request.stage("read", signal => latest.current!.loadPreview!(signal)); }
      finally { request.dispose(); }
    }, abort.signal);
    void lease.promise.then(value => {
      if (!abort.signal.aborted) { setResult({ key, value }); tracePreview("preview.publish", key); }
    }).catch(error => { if (!abort.signal.aborted) setResult({ key, error: previewErrorMessage(error) }); }).finally(lease.release);
    return () => { tracePreview("preview.unmount", key); abort.abort(); lease.release(); };
  }, [key, hasLoader, enabled, attempt]);
  return asset?.unavailableReason ? { key, error: asset.unavailableReason } : result?.key === key ? result : undefined;
}

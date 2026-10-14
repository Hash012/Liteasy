import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { messageWithFallback } from "../../shared/i18n/i18n";
import { useEffect, useRef, useState, useId } from "react";
import { Button } from "@fluentui/react-components";
import { ImageRegular } from "@fluentui/react-icons";
import { createPreviewQueue, createPreviewRequest, PreviewRequestError, previewErrorMessage } from "../resource-links/previewRequest";
import type { AssistantComposerSuggestion } from "./assistant.types";
import "./contextAssetThumbnail.css";
import { assetPreviewKey, createPreviewResourceCache, tracePreview } from "../resource-links/previewResource";

const bounded = createPreviewQueue(2);
const thumbnails = createPreviewResourceCache<string>(96, 12 * 1024 * 1024, url => url.length * 2);
/** Image source cancellation releases browser decoding; retain a bounded raster only. */
export async function resizeContextThumbnail(url: string, request: ReturnType<typeof createPreviewRequest>): Promise<string> {
  if (!/^data:image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml);base64,/i.test(url)) throw new PreviewRequestError("decode", messageWithFallback("preview.imageFormat", "无法预览此图片格式。"));
  const draw = (source: CanvasImageSource, width: number, height: number) => request.stage("resize", async (signal) => {
    signal.throwIfAborted();
    if (!width || !height) throw new PreviewRequestError("decode", messageWithFallback("preview.imageSize", "图片尺寸无效。"));
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 320 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new PreviewRequestError("canvas", messageWithFallback("preview.imageCanvas", "图片预览不可用。"));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.8);
    } finally { canvas.width = 0; canvas.height = 0; }
  });
  const img = new Image();
  const cancel = () => { img.src = ""; };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    await request.stage("decode", async () => { img.src = url; await img.decode(); });
    return await draw(img, img.naturalWidth, img.naturalHeight);
  } finally { request.signal.removeEventListener("abort", cancel); img.src = ""; }

}

export function ContextAssetThumbnail({ asset, compact = false }: { asset: AssistantComposerSuggestion; compact?: boolean }) {
  const { tChinese } = useUiTranslation();
  const root = useRef<HTMLSpanElement>(null), cancellation = useRef<AbortController>();
  const load = asset.loadThumbnail;
  const fallback = useId();
  const key = assetPreviewKey(asset, "thumbnail", fallback);
  const latestLoad = useRef(load); latestLoad.current = load;
  const hasLoader = Boolean(load && !asset.unavailableReason);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; url?: string; error?: string }>();
  useEffect(() => {
    if (!hasLoader || !root.current) return;
    let active = true, completed = false;
    let current: AbortController | undefined;
    const start = () => {
      if (current || completed) return;
      const abort = new AbortController(); current = abort; cancellation.current = abort;
      setResult(undefined);
      const lease = thumbnails.acquire(key, async signal => {
        const request = createPreviewRequest({ signal });
        try {
          return await bounded(async () => {
            tracePreview("thumbnail.read-bytes", key);
            const preview = await request.stage("read-bytes", signal => latestLoad.current!(signal));
            const url = preview.images?.[0]?.url;
            if (!url) throw new PreviewRequestError("unavailable", messageWithFallback("preview.imageMissing", "图片暂不可用。"));
            tracePreview("thumbnail.decode", key);
            return resizeContextThumbnail(url, request);
          }, request.signal);
        } finally { request.dispose(); }
      }, abort.signal);
      void lease.promise.then(url => {
        if (active && current === abort && !abort.signal.aborted) { completed = true; setResult({ key, attempt, url }); tracePreview("thumbnail.publish", key); }
      }).catch(error => { if (active && current === abort) setResult({ key, attempt, error: previewErrorMessage(error) }); }).finally(lease.release);
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
      if (entries.at(-1)?.isIntersecting) start();
      else if (!completed) {
        // Invalidate before aborting so an old rejection cannot replace the next visible request.
        const previous = current; current = undefined;
        if (cancellation.current === previous) cancellation.current = undefined;
        previous?.abort();
      }
    }, { rootMargin: "120px" });
    if (observer) observer.observe(root.current); else start();
    return () => { active = false; current?.abort(); observer?.disconnect(); };
  }, [key, hasLoader, attempt]);
  if (!hasLoader) return null;
  const current = result?.key === key && result.attempt === attempt ? result : undefined;
  return <span ref={root} className={`context-asset-thumbnail${compact ? " compact" : ""}`}>
    {current?.url ? <img src={current.url} alt={`${asset.label} 缩略图`} /> : <><ImageRegular /><span role={current?.error ? "status" : undefined}>{current?.error ?? tChinese("preview.thumbnailLoading", "正在加载缩略图")}</span>
      {!compact && (current?.error ? <Button size="small" onClick={(event) => { event.stopPropagation(); setAttempt((value) => value + 1); }} aria-label={tChinese("preview.thumbnailRetry", "重试缩略图")}>{tChinese("preview.retry", "重试")}</Button> : <Button size="small" onClick={(event) => { event.stopPropagation(); cancellation.current?.abort(); }} aria-label={tChinese("preview.thumbnailCancel", "取消缩略图读取")}>{tChinese("preview.cancel", "取消")}</Button>)}</>}
  </span>;
}

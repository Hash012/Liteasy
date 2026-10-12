import { useEffect, useRef, useState } from "react";
import { ImageRegular } from "@fluentui/react-icons";
import type { AssistantComposerSuggestion } from "./assistant.types";
import "./contextAssetThumbnail.css";

let running = 0;
const queue: Array<() => void> = [];
async function bounded<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resolve) => queue.push(resolve));
  else running++;
  try { return await task(); }
  finally { const next = queue.shift(); if (next) next(); else running--; }
}

/** Keep only a small raster after decoding; never retain the original image in a global cache. */
async function resize(url: string): Promise<string> {
  if (!/^data:image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml);base64,/i.test(url)) throw new Error("无法预览此图片格式");
  const draw = (source: CanvasImageSource, width: number, height: number) => {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 320 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片预览不可用");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.8);
  };
  // SVG stays in an image context (no DOM insertion or script execution), then becomes a raster.
  if (/^data:image\/svg\+xml;/i.test(url)) {
    const img = new Image();
    try { img.src = url; await img.decode(); return draw(img, img.naturalWidth, img.naturalHeight); }
    finally { img.src = ""; }
  }
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { resizeWidth: 320, resizeQuality: "medium" });
  try { return draw(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
}

export function ContextAssetThumbnail({ asset, compact = false }: { asset: AssistantComposerSuggestion; compact?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const load = asset.loadThumbnail;
  const [result, setResult] = useState<{ load: typeof load; url?: string; failed?: boolean }>();
  useEffect(() => {
    if (!load || !root.current) return;
    let active = true;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void bounded(async () => {
        if (!active) return;
        const preview = await load();
        if (!active) return;
        const url = preview.images?.[0]?.url;
        if (!url) throw new Error("图片暂不可用");
        const thumbnail = await resize(url);
        if (active) setResult({ load, url: thumbnail });
      }).catch(() => { if (active) setResult({ load, failed: true }); });
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { start(); observer?.disconnect(); }
    }, { rootMargin: "120px" });
    if (observer) observer.observe(root.current); else start();
    return () => { active = false; observer?.disconnect(); };
  }, [load]);
  if (!load) return null;
  const current = result?.load === load ? result : undefined;
  return <span ref={root} className={`context-asset-thumbnail${compact ? " compact" : ""}`}>
    {current?.url ? <img src={current.url} alt={`${asset.label} 缩略图`} /> : <><ImageRegular /><span>{current?.failed ? "预览不可用，可点开重试" : "正在加载缩略图"}</span></>}
  </span>;
}

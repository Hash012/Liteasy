import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { decodedMediaBytes, reserveVisualMedia, readVisualMedia } from "./mediaBudget";
import { safeMarkdownUrl } from "../markdown/MarkdownContent";
export const VisualResourceContext = createContext<string | undefined>(undefined);
export const VisualAssetContext = createContext<AgentAssetService | null>(null);
export function AssetImage({ source, alt = "图片", basePath }: { source: string; alt?: string; basePath?: string }) {
  const inherited = useContext(VisualResourceContext);
  basePath ??= inherited;
  const assets = useContext(VisualAssetContext), element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined"), [url, setUrl] = useState<string>(), [error, setError] = useState("");
  useEffect(() => { if (!element.current || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" }); observer.observe(element.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    setUrl(undefined); setError("");
    const relative = !/^[a-z][a-z0-9+.-]*:|^[\/\\]/i.test(source);
    const path = relative ? basePath : source;
    if (!path?.startsWith("liteasy://") || !assets || !visible) return;
    const abort = new AbortController(); let url: string | undefined, release: (() => void) | undefined;
    setUrl(undefined); setError("");
    void readVisualMedia(() => assets.resolveImages(path, { signal: abort.signal, ...(relative ? { relativePath: source } : {}) }), abort.signal).then((images) => { if (abort.signal.aborted) return; const image = images[0]; if (!image) throw new Error("资源中没有可显示的图片。"); const bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0)); release = reserveVisualMedia(decodedMediaBytes(bytes, image.mediaType)); url = URL.createObjectURL(new Blob([bytes], { type: image.mediaType })); setUrl(url); }).catch((e) => { if (!abort.signal.aborted) setError(String(e)); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); release?.(); };
  }, [source, basePath, assets, visible]);
  const remote = safeMarkdownUrl(source, "src");
  return <span ref={element} className="visual-block-image">{url || remote ? <img src={url || remote} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span role="status">{error || (source ? `正在加载 ${alt}` : "图片引用为空")}</span>}</span>;
}

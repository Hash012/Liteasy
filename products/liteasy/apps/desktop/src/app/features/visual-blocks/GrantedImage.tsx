import { useEffect, useRef, useState } from "react";
import { createNoteFileService } from "../note-files/noteFileService";

export function relativeImagePath(documentPath: string, imagePath: string) {
  const decoded = decodeURIComponent(imagePath.split("#")[0]);
  if (/^[a-z][a-z0-9+.-]*:|^[\/\\]/i.test(decoded) || decoded.includes("\\")) throw new Error("图片必须位于已连接目录中。");
  const parts = documentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("图片超出已连接目录。"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

/** Reading binary media is bounded and follows the original directory grant. */
export function GrantedImage({ scope, mountId, path, alt }: { scope: string; mountId: string; path: string; alt: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) { setUrl(undefined); return; }
    let alive = true;
    let objectUrl: string | undefined;
    setUrl(undefined); setError("");
    const service = createNoteFileService(scope, () => alive ? scope : "");
    void service.readImage!(mountId, path).then((image) => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(image.base64), (char) => char.charCodeAt(0));
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mediaType }));
      setUrl(objectUrl);
    }).catch((failure) => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [scope, mountId, path, visible]);
  return <span ref={host} className="visual-block-image">{url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : <span role="status">{error || `正在加载图片：${alt}`}</span>}</span>;
}

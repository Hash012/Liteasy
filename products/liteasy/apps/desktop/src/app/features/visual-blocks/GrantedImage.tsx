import { decodedMediaBytes, reserveVisualMedia, readVisualMedia } from "./mediaBudget";
import { useEffect, useRef, useState } from "react";
import { createNoteFileService } from "../note-files/noteFileService";

export { relativeImagePath } from "../resource-filesystem/attachmentPath";

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
    const abort = new AbortController();
    let alive = true;
    let objectUrl: string | undefined;
    let release: (() => void) | undefined;
    setUrl(undefined); setError("");
    const service = createNoteFileService(scope, () => alive ? scope : "");
    void readVisualMedia(() => service.readImage!(mountId, path), abort.signal).then((image) => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(image.base64), (char) => char.charCodeAt(0));
      release = reserveVisualMedia(decodedMediaBytes(bytes, image.mediaType));
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mediaType }));
      setUrl(objectUrl);
    }).catch((failure) => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { abort.abort(); alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); release?.(); };
  }, [scope, mountId, path, visible]);
  return <span ref={host} className="visual-block-image">{url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : <span role="status">{error || `正在加载图片：${alt}`}</span>}</span>;
}

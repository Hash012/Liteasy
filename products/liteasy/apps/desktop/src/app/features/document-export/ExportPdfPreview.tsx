import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ArtifactExportPayload } from "../artifacts/artifactExport.types";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export function ExportPdfPreview({ payload }: { payload: ArtifactExportPayload }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const document = useRef<pdfjs.PDFDocumentProxy>();
  const [page, setPage] = useState(1), [pages, setPages] = useState(0), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const task = pdfjs.getDocument({ data: Uint8Array.from(atob(payload.content), char => char.charCodeAt(0)) });
    void task.promise.then(value => { if (active) { document.current = value; setPages(value.numPages); setPage(1); } else void value.destroy(); }).catch(() => { if (active) setError("PDF 预览读取失败，请重新生成。"); });
    return () => { active = false; document.current = undefined; void task.destroy(); };
  }, [payload]);
  useEffect(() => {
    let active = true, render: pdfjs.RenderTask | undefined;
    if (!document.current || !canvas.current) return;
    void document.current.getPage(page).then(value => {
      if (!active || !canvas.current) return;
      const viewport = value.getViewport({ scale: 1 });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      render = value.render({ canvas: canvas.current, viewport });
      return render.promise;
    }).catch(error => { if (active && error?.name !== "RenderingCancelledException") setError("PDF 页面预览失败。"); });
    return () => { active = false; render?.cancel(); };
  }, [page, pages, payload]);
  return <div>{error ? <p role="alert">{error}</p> : null}<div><Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} / {pages} 页</span><Button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>下一页</Button></div><canvas ref={canvas} aria-label="本次实际生成的 PDF 页面" style={{ maxWidth: "100%", height: "auto" }} /></div>;
}

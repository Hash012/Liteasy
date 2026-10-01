import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import type { PDFDocumentProxy } from "./pdfEngine";

export function ReflowPage({ document, page, onOriginal }: { document: PDFDocumentProxy; page: number; onOriginal: () => void }) {
  const [text, setText] = useState<string>(); const [error, setError] = useState(""); const [size, setSize] = useState(18);
  useEffect(() => {
    let active = true; setText(undefined); setError("");
    void document.getPage(page).then((value) => value.getTextContent()).then((content) => {
      if (active) setText(content.items.map((item) => "str" in item ? item.str : "").join(" ").trim().slice(0, 200_000));
    }).catch(() => { if (active) setError("此页文字无法读取，请查看原页。"); });
    return () => { active = false; };
  }, [document, page]);
  return <article className="reflow-page" aria-label={`第 ${page} 页重排文本`}>
    <div className="reflow-controls"><label>文字大小 <input aria-label="重排文字大小" type="range" min={14} max={30} step={2} value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
      <Button onClick={onOriginal}>查看第 {page} 页原文</Button></div>
    <p className="reading-hint">文本重排可能改变分栏与公式的顺序。图表、批注和手写请查看原页。</p>
    {error ? <p role="alert">{error}</p> : text === undefined ? <Spinner label="正在读取本页文字…" /> : text ? <div className="reflow-text" style={{ fontSize: size }}>{text}</div> : <p>此页没有文字层，可能是扫描页。请查看原页。</p>}
    {text?.length === 200_000 ? <p>本页文字过长，只显示前 200000 个字符；完整内容请查看原页。</p> : null}
  </article>;
}

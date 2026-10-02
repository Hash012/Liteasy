import { useEffect, useRef, useState } from "react";
import { Button, Spinner, Tooltip } from "@fluentui/react-components";
import { CopyRegular, DismissRegular, Speaker2Regular, SparkleRegular } from "@fluentui/react-icons";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
import { lookupResultNote } from "./selectionLookupText";
import type { SelectionLookupPort, SelectionLookupRequest, SelectionLookupResult } from "./selectionLookup.types";
import "./selectionLookup.css";

export function SelectionLookupCard({ lookup, text, context, paperId, paperTitle, initialMode = "auto", onClose, onExplain, onSave }: {
  lookup: SelectionLookupPort; text: string; context?: string; paperId?: string; paperTitle?: string;
  initialMode?: "auto" | "explain";
  onClose(): void; onExplain?(): void; onSave?(note: string): Promise<void>;
}) {
  const [result, setResult] = useState<SelectionLookupResult>();
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>();
  const [mode, setMode] = useState<SelectionLookupRequest["mode"]>(initialMode);
  const abort = useRef<AbortController>();
  const audio = useRef<HTMLAudioElement>();
  const serial = useRef(0);
  async function query(mode: NonNullable<SelectionLookupRequest["mode"]>) {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const id = ++serial.current;
    setMode(mode); setPending(true); setResult(undefined); setError(""); setMessage(""); setExpanded(false);
    try {
      const next = await lookup.query(mode === "explain"
        ? { text, mode, signal: controller.signal }
        : { text, context, paperId, paperTitle, mode,
          allowTranslation: mode === "translate" || !lookup.translationUsesAi, systemPrompt, signal: controller.signal });
      if (!controller.signal.aborted && serial.current === id) setResult(next);
    } catch (failure) {
      if (!controller.signal.aborted && serial.current === id) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (!controller.signal.aborted && serial.current === id) setPending(false); }
  }
  useEffect(() => {
    // Defer until the effect survives cleanup; development StrictMode probes must not send a duplicate request.
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void query(initialMode); });
    return () => { disposed = true; ++serial.current; abort.current?.abort(); audio.current?.pause(); };
  }, [lookup.query, lookup.configurationKey, text, context, paperId, paperTitle, lookup.translationUsesAi, initialMode]);
  const available = result && result.kind !== "missing";
  return <section className="selection-lookup-card" aria-label="查词与翻译结果" onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header><strong title={text}>{text}</strong>
      <Tooltip content="关闭查词与翻译" relationship="description"><Button appearance="subtle" size="small" icon={<DismissRegular />}
        aria-label="关闭查词与翻译" onClick={onClose} /></Tooltip>
    </header>
    {pending ? <div role="status"><Spinner size="tiny" label={mode === "explain" ? "正在解释…" : "正在查询…"} /><Button size="small" appearance="subtle" onClick={() => {
      ++serial.current; abort.current?.abort(); setPending(false); setMessage("查询已取消。");
    }}>取消查询</Button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result?.kind === "missing" ? <p>未找到词典释义，可翻译这个选段。</p> : null}
    {result?.pronunciations.length ? <div className="selection-lookup-pronunciations">
      {result.pronunciations.map((pronunciation, index) => <span key={index}>
        <small>{pronunciation.label} {pronunciation.phonetic}</small>
        {pronunciation.audioUrl ? <Tooltip content={`播放${pronunciation.label}发音`} relationship="description"><Button appearance="subtle" size="small"
          aria-label={`播放${pronunciation.label}发音`} icon={<Speaker2Regular />} onClick={() => {
            audio.current?.pause(); audio.current = new Audio(pronunciation.audioUrl);
            void audio.current.play().catch(() => setMessage("发音播放失败，请稍后重试。"));
          }} /></Tooltip> : null}
      </span>)}
    </div> : null}
    {result?.senses.length ? <ul className="selection-lookup-senses">
      {result.senses.slice(0, expanded ? undefined : 3).map((sense, index) => <li key={index}>
        {sense.partOfSpeech ? <small>{sense.partOfSpeech}</small> : null}<span>{sense.definition}</span>
        {expanded && sense.example ? <blockquote>{sense.example}</blockquote> : null}
      </li>)}
    </ul> : null}
    {result && (result.senses.length > 3 || result.senses.some((sense) => sense.example)) ? <Button size="small" appearance="subtle"
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起释义与例句" : "更多释义与例句"}</Button> : null}
    {result?.translation ? <PdfAnnotationMarkdown value={result.translation} /> : null}
    {result?.explanation ? <PdfAnnotationMarkdown value={result.explanation} /> : null}
    {available ? <small className="selection-lookup-source">{result.sourceLabel}{result.fallback ? " · 词典未返回释义，已翻译选段" : ""}</small> : null}
    <div className="selection-lookup-actions">
      <Tooltip content="只发送选中的词，请 AI 简明解释" relationship="description"><Button size="small" icon={<SparkleRegular />} disabled={pending}
        onClick={() => void query("explain")}>{mode === "explain" ? "重新解释" : "AI 查词"}</Button></Tooltip>
      {available ? <Tooltip content="复制查询结果" relationship="description"><Button size="small" appearance="subtle" icon={<CopyRegular />} onClick={() => {
        const copied = navigator.clipboard?.writeText(lookupResultNote(result)) ?? Promise.reject(new Error("clipboard_unavailable"));
        void copied.then(() => setMessage("查询结果已复制。")).catch(() => setMessage("复制失败，请选择结果文字手动复制。"));
      }}>复制结果</Button></Tooltip> : null}
      {available && onSave ? <Button size="small" disabled={saving} onClick={() => {
        setSaving(true); setError("");
        void onSave(lookupResultNote(result)).then(() => setMessage("查询结果已保存为批注。"))
          .catch((failure) => setError(String(failure))).finally(() => setSaving(false));
      }}>{saving ? "正在保存…" : "保存为批注"}</Button> : null}
      {onExplain ? <Button size="small" disabled={pending} onClick={onExplain}>结合本句解释</Button> : null}
    </div>
    <details className="selection-lookup-translation" open={mode !== "explain" && Boolean(error || result?.kind === "missing")}>
      <summary>翻译选段</summary>
      {context ? <details><summary>所在句子</summary><p>{context}</p></details> : null}
      {lookup.translationUsesAi ? <GenerationPromptEditor task="selection_translation" value={systemPrompt} onChange={setSystemPrompt} disabled={pending} /> : null}
      <div className="selection-lookup-actions">
        <Button size="small" appearance="primary" disabled={pending} onClick={() => void query("translate")}>翻译选段</Button>
        <Button size="small" disabled={pending} onClick={() => void query("auto")}>重新查词</Button>
      </div>
    </details>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

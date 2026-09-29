import { useSyncExternalStore, type CSSProperties } from "react";
import { Button, Field, Popover, PopoverSurface, PopoverTrigger, Slider, Tooltip } from "@fluentui/react-components";
import { TextFontSizeRegular } from "@fluentui/react-icons";
import "./markdownFontControl.css";

const key = "liteasy.markdown.font-size.v1";
const changed = "liteasy:markdown-font-size";
let fallback = 16;
function read() {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isInteger(value) && value >= 12 && value <= 32 ? value : fallback;
  } catch { return fallback; }
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changed, listener); };
}
export function useMarkdownFontSize() {
  const fontSize = useSyncExternalStore(subscribe, read, () => 16);
  return { fontSize, style: { "--markdown-font-size": `${fontSize}px` } as CSSProperties,
    setFontSize(value: number) {
      fallback = Math.min(32, Math.max(12, Math.round(value)));
      try { localStorage.setItem(key, String(fallback)); } catch { /* Reading remains usable without storage. */ }
      window.dispatchEvent(new Event(changed));
    } };
}

export function MarkdownFontControl({ fontSize, setFontSize }: Pick<ReturnType<typeof useMarkdownFontSize>, "fontSize" | "setFontSize">) {
  return <Popover><PopoverTrigger disableButtonEnhancement><Tooltip content="调整 Markdown 字号" relationship="label">
    <Button appearance="subtle" aria-label="调整 Markdown 字号" icon={<TextFontSizeRegular />} />
  </Tooltip></PopoverTrigger><PopoverSurface className="markdown-font-control">
    <Field label={`字号 · ${fontSize} px`}><Slider aria-label="Markdown 字号" min={12} max={32} step={1} value={fontSize}
      onChange={(_, data) => setFontSize(data.value)} /></Field>
    <Button size="small" appearance="subtle" onClick={() => setFontSize(16)}>恢复默认字号</Button>
  </PopoverSurface></Popover>;
}

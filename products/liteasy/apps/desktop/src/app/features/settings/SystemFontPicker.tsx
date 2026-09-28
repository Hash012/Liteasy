import { useEffect, useState } from "react";
import { Button, Combobox, Option } from "@fluentui/react-components";
import { invoke, isTauri } from "@tauri-apps/api/core";

import "./systemFontPicker.css";

type FontOption = { label: string; value: string };
export function fontFamilyCss(name: string) { return `${JSON.stringify(name)}, sans-serif`; }
let cached: string[] | undefined;
async function loadFonts() {
  if (cached) return cached;
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  const fonts = isTauri() ? await invoke<string[]>("list_system_fonts") : query ? (await query()).map((font) => font.family) : [];
  if (!fonts.length) throw new Error("当前浏览器无法列举系统字体。请在桌面版选择，或输入已安装字体的名称。" );
  cached = [...new Set(fonts.filter((name) => name.trim() && name.length <= 256 && !/[\x00-\x1f]/.test(name)))].sort((a, b) => a.localeCompare(b));
  return cached;
}
export function SystemFontPicker({ label, value, options, onChange }: { label: string; value: string; options: readonly FontOption[]; onChange(value: string): void }) {
  const [fonts, setFonts] = useState<string[]>(cached ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = [...options, ...fonts.map((name) => ({ label: name, value: fontFamilyCss(name) }))];
  const selected = choices.find((font) => font.value === value)?.label ?? value.split(",")[0].replace(/^"|"$/g, "");
  useEffect(() => { setQuery(selected); }, [selected]);
  const load = async () => { setBusy(true); setError(""); try { setFonts(await loadFonts()); } catch (failure) { setError(String(failure)); } finally { setBusy(false); } };
  // Browser font permissions must follow a user gesture; desktop enumeration needs none.
  useEffect(() => { if (isTauri()) void load(); }, []);
  const matches = choices.filter((font) => query === selected || font.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const custom = query.trim().length > 0 && query.trim().length <= 256 && !/[\x00-\x1f]/.test(query);
  return <div className="system-font-picker">
    <Combobox aria-label={label} value={query} selectedOptions={[value]} freeform
      onChange={(event) => setQuery(event.target.value)} onOptionSelect={(_, data) => data.optionValue && onChange(data.optionValue)}>
      {matches.slice(0, 100).map((font) => <Option key={font.value} value={font.value} style={{ fontFamily: font.value }}>{font.label}</Option>)}
      {custom && !choices.some((font) => font.label === query.trim()) ? <Option text={`使用字体：${query.trim()}`} value={fontFamilyCss(query.trim())}>使用字体：{query.trim()}</Option> : null}
    </Combobox>
    <Button size="small" appearance="subtle" disabled={busy} onClick={() => { cached = undefined; void load(); }}>{busy ? "读取中…" : "读取系统字体"}</Button>
    {matches.length > 100 ? <small>输入名称搜索全部 {fonts.length} 种系统字体</small> : null}
    {error ? <small role="status">{error}</small> : null}
  </div>;
}

import { message } from "../../shared/i18n/i18n";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { useEffect, useRef, useState } from "react";
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
  if (!fonts.length) throw new Error(message("view.fonts.unavailable") );
  cached = [...new Set(fonts.filter((name) => name.trim() && name.length <= 256 && !/[\x00-\x1f]/.test(name)))].sort((a, b) => a.localeCompare(b));
  return cached;
}
export function SystemFontPicker({ label, value, options, onChange }: { label: string; value: string; options: readonly FontOption[]; onChange(value: string): void }) {
  useUiTranslation();
  const [fonts, setFonts] = useState<string[]>(cached ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = [...options, ...fonts.map((name) => ({ label: name, value: fontFamilyCss(name) }))];
  const selected = choices.find((font) => font.value === value)?.label ?? value.split(",")[0].replace(/^"|"$/g, "");
  const previousSelection = useRef<{ value: string; label: string }>();
  useEffect(() => {
    const previous = previousSelection.current;
    setQuery(current => !previous || previous.value !== value || current === previous.label ? selected : current);
    previousSelection.current = { value, label: selected };
  }, [selected, value]);
  const load = async () => { setBusy(true); setError(""); try { setFonts(await loadFonts()); } catch (failure) { setError(String(failure)); } finally { setBusy(false); } };
  // Browser font permissions must follow a user gesture; desktop enumeration needs none.
  useEffect(() => { if (isTauri()) void load(); }, []);
  const matches = choices.filter((font) => query === selected || font.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const custom = query.trim().length > 0 && query.trim().length <= 256 && !/[\x00-\x1f]/.test(query);
  return <div className="system-font-picker">
    <Combobox aria-label={label} value={query} selectedOptions={[value]} freeform
      onChange={(event) => setQuery(event.target.value)} onOptionSelect={(_, data) => data.optionValue !== undefined && onChange(data.optionValue)}>
      {matches.slice(0, 100).map((font) => <Option key={font.value} value={font.value} style={{ fontFamily: font.value }}>{font.label}</Option>)}
      {custom && !choices.some((font) => font.label === query.trim()) ? <Option text={message("view.fonts.use", { font: query.trim() })} value={fontFamilyCss(query.trim())}>{message("view.fonts.use", { font: query.trim() })}</Option> : null}
    </Combobox>
    <details className="system-font-options"><summary>{message("view.fonts.manual")}</summary>
    <Button size="small" appearance="subtle" disabled={busy} onClick={() => { cached = undefined; void load(); }}>{busy ? message("view.fonts.loading") : message("view.fonts.load")}</Button>
    {matches.length > 100 ? <small>{message("view.fonts.count", { count: fonts.length })}</small> : null}
    {error ? <small role="status">{error}</small> : null}
    </details>
  </div>;
}

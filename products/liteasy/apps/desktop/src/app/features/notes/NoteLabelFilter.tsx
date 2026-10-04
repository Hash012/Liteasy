import { Button, Checkbox, Input, Popover, PopoverSurface, PopoverTrigger, Select } from "@fluentui/react-components";
import { FilterRegular } from "@fluentui/react-icons";
import { isAiOnlyNote, noteLabelEntries, type NoteLabel } from "./noteLabels";
import "./noteLabelFilter.css";

export type NoteFilter = { label: NoteLabel | ""; hideTranslations: boolean; hideLookup: boolean; hideAiOnly: boolean };
export const emptyNoteFilter: NoteFilter = { label: "", hideTranslations: false, hideLookup: false, hideAiOnly: false };
export function matchesNoteFilter(labels: readonly NoteLabel[], filter: NoteFilter) {
  return (!filter.label || labels.includes(filter.label)) && (!filter.hideTranslations || !labels.includes("translation")) &&
    (!filter.hideLookup || !labels.includes("lookup")) && (!filter.hideAiOnly || !isAiOnlyNote(labels));
}
export function NoteLabelFilter({ value, onChange, query, onQueryChange }: {
  value: NoteFilter; onChange(value: NoteFilter): void; query?: string; onQueryChange?(value: string): void;
}) {
  const count = Number(Boolean(value.label)) + Number(value.hideTranslations) + Number(value.hideLookup) + Number(value.hideAiOnly) + Number(Boolean(query));
  return <div className="notes-label-filters">
    <Popover positioning={{ position: "below", align: "start", autoSize: true }} trapFocus>
      <PopoverTrigger disableButtonEnhancement><Button size="small" appearance={count ? "secondary" : "subtle"} icon={<FilterRegular />} title="按来源与编辑痕迹筛选">
        {count ? `标签筛选 · ${count}` : "标签筛选"}
      </Button></PopoverTrigger>
      <PopoverSurface aria-label="笔记标签筛选" className="notes-filter-popover">
        {onQueryChange && <Input aria-label="搜索批注内容" placeholder="搜索原文或批注" value={query ?? ""} onChange={(_, data) => onQueryChange(data.value)} />}
        <label>包含标签<Select aria-label="包含笔记标签" value={value.label} onChange={(_, data) => onChange({ ...value, label: data.value as NoteLabel | "" })}>
          <option value="">全部笔记</option>
          {noteLabelEntries.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </Select></label>
        <Checkbox label="隐藏翻译结果" checked={value.hideTranslations} onChange={(_, data) => onChange({ ...value, hideTranslations: data.checked === true })} />
        <Checkbox label="隐藏查词结果" checked={value.hideLookup} onChange={(_, data) => onChange({ ...value, hideLookup: data.checked === true })} />
        <Checkbox label="隐藏纯 AI 内容" checked={value.hideAiOnly} onChange={(_, data) => onChange({ ...value, hideAiOnly: data.checked === true })} />
        <small>按已记录的来源和编辑痕迹筛选；来源不明的旧笔记会保留。</small>
      </PopoverSurface>
    </Popover>
    {count > 0 && <Button size="small" appearance="subtle" onClick={() => { onChange(emptyNoteFilter); onQueryChange?.(""); }}>清除筛选</Button>}
  </div>;
}

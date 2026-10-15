import { useId, useRef, useState } from "react";
import { Button, Input, Tag, TagGroup, Tooltip } from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { MAX_RESOURCE_TAGS, normalizeResourceTags, parseResourceTags, resourceTagKey, splitResourceTags } from "./resourceTagValues";
import "./resourceTagEditor.css";

export type ResourceTagDraft = { tags: string[]; input: string };
export function createResourceTagDraft(tags: readonly string[] = []): ResourceTagDraft {
  return { tags: normalizeResourceTags(tags), input: "" };
}
export function resourceTagDraftValues(value: ResourceTagDraft) {
  return parseResourceTags([...value.tags, ...splitResourceTags(value.input)]);
}

export function ResourceTagEditor({ value, onChange, label, suggestions = [], disabled = false }: {
  value: ResourceTagDraft; onChange(value: ResourceTagDraft): void; label: string; suggestions?: readonly string[]; disabled?: boolean;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const selected = new Set(value.tags.map(resourceTagKey));
  const query = resourceTagKey(value.input);
  const available = normalizeResourceTags(suggestions).filter((tag) => !selected.has(resourceTagKey(tag)) && resourceTagKey(tag).includes(query)).slice(0, 8);
  function add(tags: string[], pendingInput = value.input) {
    if (disabled) return;
    try {
      onChange({ tags: parseResourceTags([...value.tags, ...tags]), input: "" });
      setError("");
      input.current?.focus();
    } catch (failure) {
      onChange({ ...value, input: pendingInput });
      setError(failure instanceof Error ? failure.message : "标签未添加，请检查后重试。");
    }
  }
  return <div className="resource-tag-editor">
    {value.tags.length ? <TagGroup aria-label={`${label}列表`} size="small" disabled={disabled} onDismiss={(_, data) => {
      onChange({ ...value, tags: value.tags.filter((tag) => resourceTagKey(tag) !== data.value) });
      setError("");
      input.current?.focus();
    }}>
      {value.tags.map((tag) => <Tooltip key={resourceTagKey(tag)} content={`移除标签 ${tag}`} relationship="description"><Tag value={resourceTagKey(tag)} dismissible aria-label={`移除标签 ${tag}`}>{tag}</Tag></Tooltip>)}
    </TagGroup> : null}
    <div className="resource-tag-editor-input">
      <Input ref={input} aria-label={label} aria-describedby={hintId} aria-invalid={Boolean(error)} value={value.input} disabled={disabled} placeholder="输入标签，按回车添加"
        onChange={(_, data) => { onChange({ ...value, input: data.value }); setError(""); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          if (value.input.trim()) add(splitResourceTags(value.input));
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!/[,，;；\r\n]/u.test(pasted)) return;
          event.preventDefault();
          const field = event.currentTarget;
          const next = value.input.slice(0, field.selectionStart ?? value.input.length) + pasted + value.input.slice(field.selectionEnd ?? value.input.length);
          add(splitResourceTags(next), next);
        }} />
      <Tooltip content="添加标签" relationship="description"><Button type="button" size="small" icon={<AddRegular />} aria-label="添加标签" disabled={disabled || !value.input.trim()} onClick={() => add(splitResourceTags(value.input))} /></Tooltip>
    </div>
    <small id={hintId}>可粘贴用逗号、分号或换行分隔的标签；{value.tags.length} / {MAX_RESOURCE_TAGS} 个。</small>
    {available.length ? <div className="resource-tag-suggestions" aria-label="文库标签建议"><small>文库标签</small>{available.map((tag) => <Button type="button" key={resourceTagKey(tag)} size="small" appearance="subtle" disabled={disabled} aria-label={`添加标签 ${tag}`} onClick={() => add([tag])}>{tag}</Button>)}</div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

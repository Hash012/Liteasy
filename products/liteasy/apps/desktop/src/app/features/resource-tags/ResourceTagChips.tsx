import { useState, type ReactNode } from "react";
import { Tooltip } from "@fluentui/react-components";
import "./resourceTags.css";

export type ResourceTag = { value: string; label: string; kind: string; description?: string; compactLabel?: string };
export function ResourceTagChips<T extends ResourceTag>({ tags, label, limit = 3, onSelect, className = "", children }: {
  tags: T[]; label: string; limit?: number; onSelect?: (tag: T) => void; className?: string; children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return <span className={`resource-tag-chips ${className}`} aria-label={label}>
    {(expanded ? tags : tags.slice(0, limit)).map((tag) => <Tooltip key={`${tag.kind}:${tag.value}`} content={tag.description || tag.label} relationship="description">
      {onSelect ? <button type="button" className={`resource-tag-chip resource-tag-${tag.kind}`} title={tag.description || tag.label}
        aria-label={tag.description || tag.label} onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelect(tag); }}>{tag.compactLabel || tag.label}</button>
        : <span className={`resource-tag-chip resource-tag-${tag.kind}`} title={tag.description || tag.label} tabIndex={0}>{tag.compactLabel || tag.label}</span>}
    </Tooltip>)}
    {tags.length > limit ? <button type="button" className="resource-tags-overflow" aria-expanded={expanded} aria-label={expanded ? "收起标签" : `展开其余 ${tags.length - limit} 个标签`}
      onKeyDown={(event) => event.stopPropagation()} title={tags.slice(limit).map((tag) => tag.label).join(" · ")} onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}>{expanded ? "收起" : `+${tags.length - limit}`}</button> : null}
    {children}
  </span>;
}

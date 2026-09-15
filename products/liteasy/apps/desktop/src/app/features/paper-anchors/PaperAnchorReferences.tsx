import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { Button } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { MarkdownContent } from "../markdown/MarkdownContent";
import {
  formatPaperAnchorText,
  paperAnchorLabel,
  type PaperAnchorEntity,
} from "./paperAnchorEntity";
import "./paperAnchors.css";

/** All prose surfaces use the entity's fixed, below-content citation view. */
export function PaperAnchorReferences({ anchors, onOpen, label = "查看引用原文", open = true, className = "" }: {
  anchors: readonly PaperAnchorEntity[];
  onOpen?: (anchor: PaperAnchorEntity) => void;
  label?: string;
  open?: boolean;
  className?: string;
}) {
  const workbench = useObjectWorkbench();
  const navigate = onOpen ?? workbench?.openPaperAnchor;
  const [navigationError, setNavigationError] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  useEffect(() => setVisibleCount(12), [anchors]);
  if (!anchors.length) return null;
  return <details className={`paper-anchor-references ${className}`} open={open}>
    <summary>{label}</summary>
    <ol>
      {anchors.slice(0, visibleCount).map((anchor, index) => <li key={`${anchor.id}:${index}`} data-paper-anchor-id={anchor.id}>
        <Button
          appearance="subtle"
          aria-label={`打开原文证据 ${index + 1}：${formatPaperAnchorText(anchor.presentation.title)} ${formatPaperAnchorText(anchor.presentation.location)}`}
          disabled={!navigate || !anchor.locator.page}
          onClick={() => {
            setNavigationError("");
            const failed = (error: unknown) => setNavigationError(error instanceof Error
              ? error.message : "来源暂时不可用，原文摘录仍可阅读。");
            try { void Promise.resolve(navigate?.(anchor)).catch(failed); } catch (error) { failed(error); }
          }}
          size="small"
        >{paperAnchorLabel(anchor)}</Button>
        {anchor.snapshot.quote ? <blockquote><MarkdownContent value={anchor.snapshot.quote} /></blockquote> : null}
        {anchor.snapshot.summary && anchor.snapshot.summary !== anchor.snapshot.quote ? (
          <p>摘要：{formatPaperAnchorText(anchor.snapshot.summary)}</p>
        ) : null}
        {!anchor.locator.page ? <span>来源位置未记录，保留原文摘录。</span> : null}
      </li>)}
    </ol>
    {navigationError ? <p role="status">{navigationError}</p> : null}
    {visibleCount < anchors.length ? <Button appearance="subtle" size="small"
      onClick={() => setVisibleCount((current) => current + 12)}>
      显示更多引用（剩余 {anchors.length - visibleCount} 条）
    </Button> : null}
  </details>;
}

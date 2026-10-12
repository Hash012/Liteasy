import { Button } from "@fluentui/react-components";
import { useState } from "react";
import { MarkdownContent, type MarkdownContentProps } from "./MarkdownContent";
import type { ContentFragment } from "./contentFragment";

export type ContentViewProps = Omit<MarkdownContentProps, "value" | "html" | "rehypePluginsBeforeMath"> & {
  content: ContentFragment;
  purpose?: "reading" | "evidence";
  allowSource?: boolean;
};
/** Public rich-body boundary. Titles, paths and diagnostics remain literal React text. */
export function ContentView({ content, purpose = "reading", allowSource = false, ...props }: ContentViewProps) {
  const [source, setSource] = useState(false);
  const evidence = purpose === "evidence";
  if (!evidence && !allowSource && content.profile !== "literal/v1" && content.integrity !== "budget-exceeded") return <MarkdownContent {...props} value={content.viewContext.text} html="sanitized" />;
  return <div className="content-view" data-content-integrity={content.integrity}>
    {allowSource && <Button size="small" appearance="subtle" onClick={() => setSource(!source)} aria-pressed={source}>{source ? "查看正文" : "查看源码"}</Button>}
    {(evidence || content.integrity === "budget-exceeded") && content.integrity !== "complete" && content.integrity !== "structured-partial" &&
      <small>{content.integrity === "budget-exceeded" ? "完整结构超过展示预算，已保留原始摘录。" : "历史快照：结构完整性与精确位置尚未确认。"}</small>}
    {content.exactSelection.text.length > 200000 && <small>此处仅预览前 200,000 个字符；完整内容仍保存在来源中，请分段读取。</small>}
    {content.viewContext.materialBeyondSelection && <small>含用于展示的周边内容；不代表当时已送入模型。</small>}
    {source || content.profile === "literal/v1" || content.integrity === "budget-exceeded"
      ? <pre className="content-view__source">{content.exactSelection.text.slice(0, 200000)}</pre>
      : <MarkdownContent {...props} value={content.viewContext.text} html="sanitized" mediaPolicy={evidence ? "blocked" : "default"} />}
  </div>;
}

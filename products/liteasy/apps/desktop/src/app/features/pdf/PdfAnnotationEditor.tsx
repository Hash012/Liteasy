import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { useLayoutEffect, useRef } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, DismissRegular } from "@fluentui/react-icons";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import "./pdfAnnotationEditor.css";

export function PdfAnnotationEditor({
  value,
  onChange,
  onSave,
  onCancel,
  inline = false,
}: {
  value: string;
  onChange(value: string): void;
  onSave(): void;
  onCancel(): void;
  inline?: boolean;
}) {
  const preference = useMarkdownEditing();
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const textarea = container.current?.querySelector("textarea");
    if (!textarea) return;
    const fitContent = () => {
      const scrollTop = textarea.scrollTop;
      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.scrollTop = scrollTop;
    };
    fitContent();
    let width = textarea.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitContent();
    });
    observer?.observe(textarea);
    return () => observer?.disconnect();
  }, [value, preference.mode]);
  return (
    <div className="pdf-annotation-note-editor" ref={container}>
      <MarkdownEditor documentKey="annotation-note" label={inline ? "页内批注内容" : "补充批注笔记"} value={value} onChange={(text) => onChange(text.slice(0, 10000))} autoFocus toolbarDefaultExpanded={false} />
      {preference.mode === "manual" && value.trim() ? (
        <div
          aria-label={
            inline ? "页内批注 Markdown 实时预览" : "批注 Markdown 实时预览"
          }
          aria-live="polite"
        >
          <PdfAnnotationMarkdown value={value} />
        </div>
      ) : null}
      <div className="pdf-annotation-editor-actions">
        <Tooltip
          content={inline ? "保存注释" : "保存笔记"}
          relationship="description"
        >
          <Button
            aria-label={inline ? "保存注释" : "保存笔记"}
            appearance="primary"
            icon={!inline ? <CheckmarkRegular /> : undefined}
            onClick={onSave}
            size="small"
          >
            {inline ? "保存注释" : null}
          </Button>
        </Tooltip>
        <Tooltip content="取消编辑" relationship="description">
          <Button
            aria-label="取消"
            appearance="secondary"
            icon={!inline ? <DismissRegular /> : undefined}
            onClick={onCancel}
            size="small"
          >
            {inline ? "取消" : null}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

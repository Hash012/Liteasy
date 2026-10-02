import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { Button, Textarea, Tooltip } from "@fluentui/react-components";
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
  return (
    <div className="pdf-annotation-note-editor">
      <MarkdownEditor documentKey="annotation-note" label={inline ? "页内批注内容" : "补充批注笔记"} value={value} onChange={(text) => onChange(text.slice(0, 10000))} autoFocus={inline} />
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

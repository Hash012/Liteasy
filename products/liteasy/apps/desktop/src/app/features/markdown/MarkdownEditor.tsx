import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { MarkdownLiveEditor, type MarkdownEditorProps } from "./MarkdownLiveEditor";
import { useMarkdownEditing } from "./MarkdownEditingContext";

/** One editable Markdown surface for documents, notes, canvas cards and extension editors. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { mode } = useMarkdownEditing();
  return mode === "manual" ? <MarkdownSourceEditor {...props} /> : <MarkdownLiveEditor {...props} />;
}

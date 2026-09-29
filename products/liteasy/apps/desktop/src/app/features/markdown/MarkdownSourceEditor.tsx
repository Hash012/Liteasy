import { useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@fluentui/react-components";
import { MarkdownEditingToolbar } from "./MarkdownEditingToolbar";
import { formatMarkdown, type MarkdownCommand, type MarkdownEdit, type MarkdownSelection } from "./markdownEditing";
import { MarkdownEditHistory } from "./markdownEditHistory";
import "./markdownSourceEditor.css";

export function MarkdownSourceEditor({ value, onChange, documentKey, className = "", label = "Markdown 源码" }: {
  value: string; onChange(value: string): void; documentKey: string; className?: string; label?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const history = useRef(new MarkdownEditHistory());
  const known = useRef({ value, documentKey });
  const selection = useRef<MarkdownSelection>({ start: 0, end: 0 });
  const composing = useRef(false);
  const compositionStart = useRef<{ value: string; selection: MarkdownSelection }>();
  const pending = useRef<{ selection: MarkdownSelection; scrollTop: number; scrollLeft: number }>();
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((current) => current + 1);
  useLayoutEffect(() => {
    if (known.current.documentKey !== documentKey || known.current.value !== value) {
      history.current.clear();
      known.current = { value, documentKey };
      pending.current = undefined;
      selection.current = { start: 0, end: 0 };
      refresh();
    }
    if (pending.current && textarea.current) {
      const restore = pending.current;
      pending.current = undefined;
      textarea.current.focus({ preventScroll: true });
      textarea.current.setSelectionRange(restore.selection.start, restore.selection.end);
      textarea.current.scrollTop = restore.scrollTop;
      textarea.current.scrollLeft = restore.scrollLeft;
      selection.current = restore.selection;
    }
  }, [value, documentKey, revision]);
  const rememberSelection = () => {
    if (textarea.current) selection.current = { start: textarea.current.selectionStart, end: textarea.current.selectionEnd };
  };
  const apply = (edit: MarkdownEdit) => {
    pending.current = { selection: edit.selection, scrollTop: textarea.current?.scrollTop ?? 0, scrollLeft: textarea.current?.scrollLeft ?? 0 };
    known.current = { value: edit.value, documentKey };
    onChange(edit.value);
    refresh();
  };
  const execute = (command: MarkdownCommand) => {
    if (composing.current) return;
    const edit = formatMarkdown(value, selection.current, command);
    history.current.record(value, edit.value, selection.current, edit.selection);
    apply(edit);
  };
  const travel = (undo: boolean) => {
    if (composing.current) return;
    const edit = undo ? history.current.undo(value) : history.current.redo(value);
    if (edit) apply(edit); else refresh();
  };
  return <div className={`markdown-source-editor ${className}`}>
    <MarkdownEditingToolbar execute={execute} undo={() => travel(true)} redo={() => travel(false)} canUndo={history.current.canUndo} canRedo={history.current.canRedo} />
    <Textarea ref={textarea} className="markdown-source-input" aria-label={label} value={value} resize="none" spellCheck={false}
      onSelect={rememberSelection} onBeforeInput={rememberSelection}
      onCompositionStart={() => { composing.current = true; compositionStart.current = { value, selection: { ...selection.current } }; }}
      onCompositionEnd={() => {
        const before = compositionStart.current;
        if (before && textarea.current) {
          rememberSelection();
          history.current.record(before.value, textarea.current.value, before.selection, selection.current);
        }
        composing.current = false;
        compositionStart.current = undefined;
        refresh();
      }}
      onChange={(event, data) => {
        const after = { start: event.target.selectionStart, end: event.target.selectionEnd };
        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (!composing.current) history.current.record(value, data.value, selection.current, after, inputType === "insertText" || inputType === "deleteContentBackward");
        known.current = { value: data.value, documentKey };
        selection.current = after;
        onChange(data.value);
        refresh();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current || !(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") { event.preventDefault(); travel(key === "z" && !event.shiftKey); return; }
        const commands: Record<string, MarkdownCommand> = { b: "bold", i: "italic", k: "link", e: "code", "]": "indent", "[": "outdent" };
        const command = !event.altKey && !event.shiftKey ? commands[key] : undefined;
        if (command) { event.preventDefault(); rememberSelection(); execute(command); }
      }} />
  </div>;
}

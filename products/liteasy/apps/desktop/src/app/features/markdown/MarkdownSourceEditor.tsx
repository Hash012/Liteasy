import { useContext, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@fluentui/react-components";
import { MarkdownEditingToolbar } from "./MarkdownEditingToolbar";
import { formatMarkdown, type MarkdownCommand, type MarkdownEdit, type MarkdownSelection } from "./markdownEditing";
import { MarkdownEditHistory } from "./markdownEditHistory";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { WikiLinkEditor } from "../resource-links/WikiLinkEditor";
import { activeWiki } from "../resource-links/referenceText";
import { textareaCaret } from "./textareaCaret";
import "./markdownSourceEditor.css";

export function MarkdownSourceEditor({ value, onChange, documentKey, className = "", label = "Markdown 源码", readOnly = false, autoFocus = false }: {
  value: string; onChange(value: string): void; documentKey: string; className?: string; label?: string; readOnly?: boolean; autoFocus?: boolean;
}) {
  const references = useContext(ResourceReferencesContext);
  const [editingLink, setEditingLink] = useState(false);
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
      setEditingLink(false);
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
  const apply = (edit: MarkdownEdit, focus = true) => {
    pending.current = !focus ? undefined : { selection: edit.selection, scrollTop: textarea.current?.scrollTop ?? 0, scrollLeft: textarea.current?.scrollLeft ?? 0 };
    known.current = { value: edit.value, documentKey };
    onChange(edit.value);
    refresh();
  };
  const execute = (command: MarkdownCommand) => {
    if (composing.current || readOnly) return;
    const edit = formatMarkdown(value, selection.current, command);
    history.current.record(value, edit.value, selection.current, edit.selection);
    apply(edit);
  };
  const travel = (undo: boolean) => {
    if (composing.current || readOnly) return;
    const edit = undo ? history.current.undo(value) : history.current.redo(value);
    if (edit) apply(edit); else refresh();
  };
  const wiki = editingLink ? activeWiki(value, selection.current.start) : undefined;
  const editWiki = (raw: string, finish = false, beforeLastBracket = false) => {
    if (!wiki || readOnly) return;
    const replacement = `[[${raw}]]`;
    const next = value.slice(0, wiki.start) + replacement + value.slice(wiki.end);
    const caret = wiki.start + replacement.length - (finish ? beforeLastBracket ? 1 : 0 : 2);
    const after = { start: caret, end: caret };
    history.current.record(value, next, selection.current, after);
    selection.current = after;
    if (finish) setEditingLink(false);
    apply({ value: next, selection: after }, finish);
  };
  const insertReference = () => {
    if (readOnly) return;
    rememberSelection();
    const start = selection.current.start, end = selection.current.end;
    const next = value.slice(0, start) + "[[]]" + value.slice(end);
    const after = { start: start + 2, end: start + 2 };
    history.current.record(value, next, selection.current, after);
    selection.current = after; setEditingLink(true); apply({ value: next, selection: after });
  };
  return <div className={`markdown-source-editor ${className}`}>
    <MarkdownEditingToolbar execute={execute} undo={() => travel(true)} redo={() => travel(false)} canUndo={history.current.canUndo} canRedo={history.current.canRedo} insertReference={references ? insertReference : undefined} />
    {wiki && references ? <WikiLinkEditor key={`${documentKey}:${wiki.start}`} raw={value.slice(wiki.start + 2, wiki.end - 2)} target={{ getBoundingClientRect: () => textarea.current ? textareaCaret(textarea.current, wiki.start) : new DOMRect() }}
      onChange={(raw) => editWiki(raw)} onFinish={(raw, beforeLast) => editWiki(raw, true, beforeLast)} onHistory={(undo) => { setEditingLink(false); travel(undo); }} /> : null}
    <Textarea ref={textarea} autoFocus={autoFocus} className="markdown-source-input" aria-label={label} value={value} readOnly={readOnly} resize="none" spellCheck={false}
      onSelect={() => { rememberSelection(); }} onBeforeInput={rememberSelection}
      onDoubleClick={() => { rememberSelection(); if (activeWiki(value, selection.current.start)) setEditingLink(true); }}
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
        let next = data.value;
        let after = { start: event.target.selectionStart, end: event.target.selectionEnd };
        const paired = next.slice(0, after.start).endsWith("[[") && next.length === value.length + 1 && after.start === after.end;
        if (!composing.current && paired && activeWiki(next.slice(0, after.start) + "]]" + next.slice(after.start), after.start)) {
          if (!next.slice(after.start).startsWith("]]")) next = next.slice(0, after.start) + "]]" + next.slice(after.start);
          pending.current = { selection: after, scrollTop: textarea.current?.scrollTop ?? 0, scrollLeft: textarea.current?.scrollLeft ?? 0 };
          setEditingLink(Boolean(references));
        }
        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (!composing.current) history.current.record(value, next, selection.current, after, inputType === "insertText" || inputType === "deleteContentBackward");
        known.current = { value: next, documentKey };
        selection.current = after;
        onChange(next);
        refresh();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return;
        if (event.key === "]" && !(event.ctrlKey || event.metaKey) && event.currentTarget.selectionStart === event.currentTarget.selectionEnd && value[event.currentTarget.selectionStart] === "]" && (activeWiki(value, event.currentTarget.selectionStart) || activeWiki(value, event.currentTarget.selectionStart - 1))) {
          event.preventDefault(); const end = event.currentTarget.selectionStart + 1; event.currentTarget.setSelectionRange(end, end); rememberSelection(); return;
        }
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") { event.preventDefault(); travel(key === "z" && !event.shiftKey); return; }
        const commands: Record<string, MarkdownCommand> = { b: "bold", i: "italic", k: "link", e: "code", "]": "indent", "[": "outdent" };
        const command = !event.altKey && !event.shiftKey ? commands[key] : undefined;
        if (command) { event.preventDefault(); rememberSelection(); execute(command); }
      }} />
  </div>;
}

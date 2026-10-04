import { DocumentFindBar } from "../search/DocumentFindBar";
import { useResourceReveal, revealOffset } from "../resource-links/resourceReveal";
import { useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { MarkdownContent, type MarkdownContentProps } from "./MarkdownContent";
import { MarkdownEditingToolbar } from "./MarkdownEditingToolbar";
import { formatMarkdown, type MarkdownCommand } from "./markdownEditing";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { WikiLinkEditor } from "../resource-links/WikiLinkEditor";
import { activeWiki } from "../resource-links/referenceText";
import "./markdownLiveEditor.css";

const focused = StateEffect.define<boolean>();
const focusField = StateField.define({ create: () => false, update: (value, tr) => tr.effects.reduce((v, effect) => effect.is(focused) ? effect.value : v, value) });
type Preview = { dom: HTMLElement; text: string; id: number };
let previewId = 0;

/** Block widgets are mounted only in CodeMirror's visible viewport. Portals retain the app's resource and theme contexts. */
class MarkdownPreview extends WidgetType {
  constructor(readonly text: string, readonly from: number, readonly register: (entry: Preview, remove?: boolean) => void) { super(); }
  private entry?: Preview;
  eq(other: MarkdownPreview) { return this.text === other.text && this.from === other.from; }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "markdown-live-preview";
    dom.dataset.sourceFrom = String(this.from);
    dom.addEventListener("mousedown", (event) => {
      if ((event.target as Element).closest("a,button,input,textarea,select,summary")) return;
      if (event.button !== 0) return;
      // Preserve a useful caret position when a word in rendered text is clicked.
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = range?.startContainer;
      const at = node && dom.contains(node) ? this.text.indexOf(node.textContent ?? "") : -1;
      const offset = at >= 0 ? at + (range?.startOffset ?? 0) : 0;
      event.preventDefault();
      view.dispatch({ effects: focused.of(true), selection: { anchor: Math.min(view.state.doc.length, this.from + offset) } });
      view.focus();
    });
    this.entry = { dom, text: this.text, id: ++previewId };
    this.register(this.entry);
    return dom;
  }
  destroy() { if (this.entry) this.register(this.entry, true); }
  ignoreEvent() { return true; }
}

function previewField(register: MarkdownPreview["register"]) {
  const build = (state: EditorState): DecorationSet => {
    const result: Range<Decoration>[] = [];
    const active = state.field(focusField);
    const tree = syntaxTree(state);
    const definitions: string[] = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (node.name === "LinkReference") definitions.push(state.sliceDoc(node.from, node.to));
    }
    const suffix = definitions.length ? `\n\n${definitions.join("\n")}` : "";
    // Keep unsupported/very large blocks as editable source, never render a huge hidden preview tree.
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (node.to <= node.from || node.to - node.from > 24000 || node.name === "LinkReference") continue;
      if (active && state.selection.ranges.some((range) => range.from <= node!.to && range.to >= node!.from)) continue;
      result.push(Decoration.replace({ widget: new MarkdownPreview(state.sliceDoc(node.from, node.to) + suffix, node.from, register), block: true }).range(node.from, node.to));
    }
    return Decoration.set(result, true);
  };
  return StateField.define<DecorationSet>({ create: build, update: (decorations, tr) =>
    tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focused)) || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? build(tr.state) : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
}

export type MarkdownEditorProps = {
  value: string; onChange(value: string): void; documentKey: string; className?: string; label?: string;
  readOnly?: boolean; autoFocus?: boolean; compact?: boolean; previewProps?: Omit<MarkdownContentProps, "value">;
  toolbar?: "inline" | "popover" | "none";
};
export function MarkdownLiveEditor({ value, onChange, documentKey, className = "", label = "Markdown 正文", readOnly = false, autoFocus = false, compact = false, toolbar = compact ? "none" : "inline", previewProps }: MarkdownEditorProps) {
  const [findOpen, setFindOpen] = useState(false);
  const references = useContext(ResourceReferencesContext);
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView>();
  const latest = useRef({ onChange, value }); latest.current = { onChange, value };
  const [previews, setPreviews] = useState<Preview[]>([]), [tick, setTick] = useState(0), [linkOpen, setLinkOpen] = useState(false);
  const editable = useRef(readOnly); editable.current = readOnly;
  useResourceReveal((target) => {
    const view = editor.current; if (!view) return;
    const offset = revealOffset(view.state.doc.toString(), target);
    view.dispatch({ selection: { anchor: offset, head: Math.min(view.state.doc.length, offset + (target.quote?.length ?? 0)) }, effects: [focused.of(true), EditorView.scrollIntoView(offset, { y: "center" })] });
  });
  const makeState = useRef<(text: string) => EditorState>();
  useLayoutEffect(() => {
    let disposed = false, queued = false;
    const mounted = new Map<number, Preview>();
    const register = (entry: Preview, remove = false) => {
      if (remove) mounted.delete(entry.id); else mounted.set(entry.id, entry);
      if (queued) return; queued = true;
      queueMicrotask(() => { queued = false; if (!disposed) setPreviews([...mounted.values()]); });
    };
    const execute = (command: MarkdownCommand) => { const view = editor.current; if (!view || view.composing || editable.current) return false;
      const range = view.state.selection.main, edit = formatMarkdown(view.state.doc.toString(), { start: range.from, end: range.to }, command);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edit.value }, selection: { anchor: edit.selection.start, head: edit.selection.end }, userEvent: "input" }); return true; };
    makeState.current = (text) => EditorState.create({ doc: text, extensions: [
      markdown({ base: markdownLanguage, completeHTMLTags: false }), history(), focusField, previewField(register), EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      keymap.of([{ key: "Mod-b", run: () => execute("bold") }, { key: "Mod-i", run: () => execute("italic") }, { key: "Mod-k", run: () => execute("link") }, { key: "Mod-e", run: () => execute("code") }, ...historyKeymap, ...defaultKeymap]),
      EditorView.inputHandler.of((view, from, to, text) => {
        if (view.composing || editable.current) return false;
        const before = view.state.doc.toString();
        if (text === "[" && from === to && before[from - 1] === "[" && activeWiki(before.slice(0, from) + "[]]" + before.slice(to), from + 1)) {
          view.dispatch({ changes: { from, to, insert: before.slice(to).startsWith("]]") ? "[" : "[]]" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
          if (references) setLinkOpen(true); return true;
        }
        if (text === "]" && from === to && before[from] === "]" && (activeWiki(before, from) || activeWiki(before, from - 1))) {
          view.dispatch({ selection: { anchor: from + 1 } }); return true;
        }
        return false;
      }),
      EditorView.domEventHandlers({
        focus: (_, view) => { queueMicrotask(() => { if (!disposed) view.dispatch({ effects: focused.of(true) }); }); },
        blur: (_, view) => { queueMicrotask(() => { if (!disposed && !host.current?.parentElement?.contains(document.activeElement)) view.dispatch({ effects: focused.of(false) }); }); },
        dblclick: (_, view) => { if (activeWiki(view.state.doc.toString(), view.state.selection.main.head)) setLinkOpen(Boolean(references)); },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet || update.focusChanged) setTick((n) => n + 1);
      }),
    ] });
    const view = new EditorView({ state: makeState.current(latest.current.value), parent: host.current! });
    editor.current = view;
    if (autoFocus) view.focus();
    return () => { disposed = true; editor.current = undefined; view.destroy(); };
  }, [documentKey, readOnly, label]);
  useLayoutEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value || !makeState.current) return;
    // A genuine external revision must not be reachable through undo on the new document.
    view.setState(makeState.current(value)); setLinkOpen(false); setTick((n) => n + 1);
  }, [value]);
  const view = editor.current;
  const execute = (command: MarkdownCommand) => {
    if (!view || view.composing || readOnly) return;
    const range = view.state.selection.main, edit = formatMarkdown(view.state.doc.toString(), { start: range.from, end: range.to }, command);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edit.value }, selection: { anchor: edit.selection.start, head: edit.selection.end }, userEvent: "input" }); view.focus();
  };
  const wiki = linkOpen && view ? activeWiki(view.state.doc.toString(), view.state.selection.main.head) : undefined;
  const editWiki = (raw: string, finish = false, beforeLast = false) => {
    if (!view || !wiki) return;
    const text = `[[${raw}]]`;
    view.dispatch({ changes: { from: wiki.start, to: wiki.end, insert: text }, selection: { anchor: wiki.start + text.length - (finish ? beforeLast ? 1 : 0 : 2) }, userEvent: "input" });
    if (finish) { setLinkOpen(false); view.focus(); }
  };
  return <div className={`markdown-live-editor ${compact ? "is-compact" : ""} ${className}`} data-editor-revision={tick} onKeyDownCapture={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setFindOpen(true); } }}>
    {findOpen ? <DocumentFindBar text={value} onClose={() => setFindOpen(false)} onNavigate={(range) => { editor.current?.dispatch({ selection: { anchor: range.start, head: range.end }, effects: [focused.of(true), EditorView.scrollIntoView(range.start, { y: "center" })] }); }} /> : null}
    {!readOnly && toolbar !== "none" ? <MarkdownEditingToolbar presentation={toolbar} execute={execute} undo={() => { if (view) undo(view); }} redo={() => { if (view) redo(view); }} canUndo={Boolean(view && undoDepth(view.state))} canRedo={Boolean(view && redoDepth(view.state))}
      insertReference={references ? () => { if (!view) return; const range = view.state.selection.main; view.dispatch({ changes: { from: range.from, to: range.to, insert: "[[]]" }, selection: { anchor: range.from + 2 }, userEvent: "input" }); setLinkOpen(true); } : undefined} /> : null}
    <div className="markdown-live-host" ref={host} />
    {previews.map((preview) => createPortal(<MarkdownContent {...previewProps} value={preview.text} />, preview.dom, String(preview.id)))}
    {wiki && view && references ? <WikiLinkEditor key={`${documentKey}:${wiki.start}`} raw={view.state.sliceDoc(wiki.start + 2, wiki.end - 2)} target={{ getBoundingClientRect: () => { const rect = view.coordsAtPos(wiki.start); return rect ? new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top) : new DOMRect(); } }}
      onChange={(raw) => editWiki(raw)} onFinish={(raw, beforeLast) => editWiki(raw, true, beforeLast)} onHistory={(back) => { setLinkOpen(false); (back ? undo : redo)(view); view.focus(); }} /> : null}
  </div>;
}

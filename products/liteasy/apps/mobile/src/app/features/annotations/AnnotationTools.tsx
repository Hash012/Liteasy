import { useState, type RefObject } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Textarea, Tooltip } from "@fluentui/react-components";
import { CursorRegular, DrawShapeRegular, EraserRegular, HighlightRegular, TextUnderlineRegular, NoteRegular, TextboxRegular, ArrowUndoRegular, ArrowRedoRegular, CommentRegular } from "@fluentui/react-icons";
import type { PdfAnnotationV2 } from "@liteasy/reading-core/pdfAnnotations";
import type { PdfInkPoint } from "@liteasy/reading-core/pdfInk";
import type { AnnotationControls, AnnotationMode } from "./annotation.types";
import { selectedPageText } from "./annotationGeometry";
import { useBackHandler } from "../navigation/backNavigation";

export type AnnotationEditor = { existing?: PdfAnnotationV2; point?: PdfInkPoint; kind: "note" | "text"; page: number };
export function AnnotationTools({ controls, mode, setMode, page, readerRef, editor, setEditor, navigate }: {
  controls: AnnotationControls; mode: AnnotationMode; setMode: (mode: AnnotationMode) => void; page: number;
  readerRef: RefObject<HTMLElement>; editor?: AnnotationEditor; setEditor: (editor?: AnnotationEditor) => void; navigate: (page: number) => void;
}) {
  const [list, setList] = useState(false);
  const [message, setMessage] = useState("");
  useBackHandler(list, () => setList(false), 50);
  const modes = [{ mode: "select", title: "选择与滚动", icon: <CursorRegular /> }, { mode: "draw", title: "手写", icon: <DrawShapeRegular /> },
    { mode: "erase", title: "擦除批注", icon: <EraserRegular /> }, { mode: "note", title: "添加便签", icon: <NoteRegular /> }, { mode: "text", title: "添加文本框", icon: <TextboxRegular /> }] as const;
  const selection = async (kind: "highlight" | "underline") => {
    const element = readerRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${page}"]`);
    const selected = element ? selectedPageText(element) : undefined;
    if (!selected) { setMessage("请先长按选择 PDF 中的文字，再添加高亮或下划线。"); return; }
    if (await controls.add({ kind, page, ...selected })) { window.getSelection()?.removeAllRanges(); setMessage(""); }
  };
  return <>
    <div className="annotation-toolbar" role="toolbar" aria-label="批注工具">
      {modes.map((entry) => <Tooltip key={entry.mode} content={entry.title} relationship="label"><Button icon={entry.icon} aria-label={entry.title}
        aria-pressed={mode === entry.mode} appearance={mode === entry.mode ? "primary" : "subtle"} disabled={!controls.ready}
        onClick={() => { setMode(entry.mode); setMessage(""); }} /></Tooltip>)}
      <Tooltip content="高亮选区" relationship="label"><Button icon={<HighlightRegular />} aria-label="高亮选区" disabled={!controls.ready}
        onPointerDown={(event) => event.preventDefault()} onClick={() => void selection("highlight")} /></Tooltip>
      <Tooltip content="下划线选区" relationship="label"><Button icon={<TextUnderlineRegular />} aria-label="下划线选区" disabled={!controls.ready}
        onPointerDown={(event) => event.preventDefault()} onClick={() => void selection("underline")} /></Tooltip>
      <Tooltip content="撤销批注" relationship="label"><Button icon={<ArrowUndoRegular />} aria-label="撤销批注" disabled={!controls.canUndo || controls.busy} onClick={() => void controls.undo()} /></Tooltip>
      <Tooltip content="重做批注" relationship="label"><Button icon={<ArrowRedoRegular />} aria-label="重做批注" disabled={!controls.canRedo || controls.busy} onClick={() => void controls.redo()} /></Tooltip>
      <Tooltip content="批注列表" relationship="label"><Button icon={<CommentRegular />} aria-label="批注列表" aria-pressed={list} onClick={() => setList(!list)} /></Tooltip>
    </div>
    <div role="status" className="annotation-status">{controls.error ? "批注操作未完成" : controls.busy ? "正在保存批注…" : controls.ready ? "批注已保存到本机" : "正在读取批注…"}
      {mode === "draw" ? " · 手写模式，切换到选择工具可滚动页面" : mode === "note" || mode === "text" ? " · 轻点页面放置批注" : ""}</div>
    {message ? <p role="status">{message}</p> : null}
    {controls.error ? <p role="alert" className="error-message">{controls.error}</p> : null}
    {list ? <section className="reader-panel" aria-label="批注列表"><h2>批注（{controls.annotations.length}）</h2><ul>
      {controls.annotations.map((value) => <li key={value.id} className="annotation-list-item"><button onClick={() => navigate(value.page)}>第 {value.page} 页 · {value.text || value.excerpt || (value.kind === "ink" ? "手写批注" : "批注")}</button>
        {value.conflictOf ? <span>同步冲突副本 · 比较后可编辑或删除</span> : null}
        <Button onClick={() => setEditor({ existing: value, kind: "note", page: value.page })}>编辑</Button><Button disabled={controls.busy} onClick={() => void controls.remove(value.id)}>删除</Button>
      </li>)}
    </ul></section> : null}
    {editor ? <AnnotationEditDialog key={`${editor.existing?.id ?? "new"}:${editor.page}`} editor={editor} controls={controls} onClose={() => { setEditor(undefined); setMode("select"); }} /> : null}
  </>;
}

function AnnotationEditDialog({ editor, controls, onClose }: { editor: AnnotationEditor; controls: AnnotationControls; onClose: () => void }) {
  const [text, setText] = useState(editor.existing?.text || editor.existing?.note || "");
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !controls.busy) onClose(); }}><DialogSurface><DialogBody>
    <DialogTitle>{editor.existing ? "编辑批注" : editor.kind === "text" ? "添加文本框" : "添加便签"}</DialogTitle>
    <DialogContent><Field label="批注内容"><Textarea value={text} resize="vertical" onChange={(_, data) => setText(data.value)} /></Field>
      {controls.error ? <p role="alert">{controls.error}</p> : null}</DialogContent>
    <DialogActions><Button disabled={controls.busy} onClick={onClose}>取消</Button><Button appearance="primary" disabled={controls.busy || !text.trim()} onClick={async () => {
      const point = editor.point ?? { x: 10, y: 10 };
      const success = editor.existing ? await controls.edit(editor.existing.id, text) : await controls.add({ kind: editor.kind, page: editor.page,
        text, note: text, rects: [{ left: Math.min(point.x, 75), top: Math.min(point.y, 90), width: 25, height: 10 }] });
      if (success) onClose();
    }}>保存批注</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { WorkbenchViewModel } from "./ObjectWorkbench";
import { refOf } from "../objects/object.types";
export function BoardLayoutTools({ model, selected }: { model: WorkbenchViewModel; selected: string[] }) {
  const [busy, setBusy] = useState(false), current = useRef(model); current.current = model;
  const act = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); await current.current.refresh(); } catch (e) { current.current.setStatus(String(e)); } finally { setBusy(false); } };
  const restore = (direction: "undo" | "redo") => act(async () => { const board = current.current.board; if (board) await current.current.repository.restoreBoardLayout(refOf(board), direction, crypto.randomUUID()); });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "z" || !(event.target instanceof Element) || !event.target.closest(".object-workbench") || event.target.closest("input,textarea,[contenteditable=true]")) return; event.preventDefault(); void restore(event.shiftKey ? "redo" : "undo"); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  const align = (mode: "left" | "top" | "distribute" | "fit") => act(async () => {
    if (!model.board) return;
    const items = model.placements.filter((item) => selected.includes(item.placementId)).sort((a, b) => a.position.x - b.position.x);
    if (!items.length) return;
    const left = Math.min(...items.map((item) => item.position.x)), top = Math.min(...items.map((item) => item.position.y));
    let cursor = left;
    const geometries = items.map((item) => {
      const position = mode === "left" ? { ...item.position, x: left } : mode === "top" ? { ...item.position, y: top } : mode === "distribute" ? { x: cursor, y: top } : item.position;
      cursor += item.size.width + 32;
      const element = Array.from(document.querySelectorAll<HTMLElement>("[data-placement-id]")).find((element) => element.dataset.placementId === item.placementId);
      const content = element?.querySelector<HTMLElement>(".visual-block-base");
      const size = mode === "fit" ? { ...item.size, height: Math.min(4000, Math.max(120, (content?.scrollHeight ?? item.size.height) + 100)) } : item.size;
      return { placementId: item.placementId, revision: item.revision, position, size };
    });
    await model.repository.applyBoardPatch({ boardRef: refOf(model.board), operationId: crypto.randomUUID(), resize: geometries });
  });
  return <div className="extension-toolbar" role="toolbar" aria-label="整理白板布局">
    <Button disabled={busy} onClick={() => void restore("undo")}>撤销布局</Button><Button disabled={busy} onClick={() => void restore("redo")}>重做布局</Button>
    <Button disabled={busy || !selected.length} onClick={() => void align("left")}>左对齐</Button><Button disabled={busy || !selected.length} onClick={() => void align("top")}>顶端对齐</Button><Button disabled={busy || selected.length < 2} onClick={() => void align("distribute")}>横向整理</Button><Button disabled={busy || !selected.length} onClick={() => void align("fit")}>适应内容</Button>
    <Button disabled={busy || !selected.length} onClick={() => void act(async () => { if (model.board) await model.repository.groupPlacements(refOf(model.board), selected, crypto.randomUUID()); })}>组合所选卡片</Button>
  </div>;
}

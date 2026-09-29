import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Button, Menu, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular, MoreHorizontalRegular, NoteRegular } from "@fluentui/react-icons";
import { LibraryIconMenuItem, LibraryItemIcon } from "../library/LibraryItemIcon";
import { notesAncestors, notesFolderPath, notesTreeIndex } from "./notesHierarchy";
import { NOTES_ROOT, type NotesViewModel } from "./notes.types";

export function NotesFolderTree({ model, onDragOver }: {
  model: NotesViewModel;
  onDragOver(event: DragEvent): void;
}) {
  const [expanded, setExpanded] = useState(() => new Set(["default", "extern"]));
  const [hover, setHover] = useState("");
  const index = useMemo(() => notesTreeIndex(model.folders), [model.folders]);
  useEffect(() => {
    setExpanded((current) => new Set([...current, ...notesAncestors(model.folderId, model.folders).map((folder) => folder.folderId)]));
  }, [model.folderId, model.folders]);
  const toggle = (id: string, open = !expanded.has(id)) => setExpanded((current) => {
    const next = new Set(current);
    if (open) next.add(id); else next.delete(id);
    return next;
  });
  const rows = (parent: string, depth = 0, ancestors = new Set<string>()): React.ReactNode =>
    (index.children.get(parent) ?? []).filter((folder) => !ancestors.has(folder.folderId)).map((folder) => {
      const id = folder.folderId;
      const children = index.children.get(id) ?? [];
      const open = expanded.has(id);
      const itemKey = `notes-folder:${id}`;
      return <div key={id} role="none">
        <Menu openOnContext>
          <MenuTrigger disableButtonEnhancement>
            <div className={`notes-tree-row${model.folderId === id ? " is-selected" : ""}${hover === id ? " is-drop-target" : ""}`}
              role="treeitem" aria-level={depth + 1} aria-selected={model.folderId === id}
              aria-expanded={children.length ? open : undefined} aria-label={notesFolderPath(id, index.byId)}
              title={notesFolderPath(id, index.byId)} tabIndex={0} style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => model.selectFolder(id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") { event.preventDefault(); if (children.length) toggle(id, true); }
                else if (event.key === "ArrowLeft") { event.preventDefault(); if (open && children.length) toggle(id, false); else model.selectFolder(folder.parentId); }
                else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); model.selectFolder(id); }
                else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const items = Array.from(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
                  items[items.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
                }
              }}
              onDragOver={(event) => { onDragOver(event); if (event.defaultPrevented) setHover(id); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(""); }}
              onDrop={(event) => { event.preventDefault(); setHover(""); void model.drop(event.dataTransfer, id).catch(() => undefined); }}>
              {children.length ? <button className="notes-tree-toggle" aria-label={`${open ? "折叠" : "展开"} ${folder.name}`}
                onClick={(event) => { event.stopPropagation(); toggle(id); }} onKeyDown={(event) => event.stopPropagation()}>
                {open ? <ChevronDownRegular /> : <ChevronRightRegular />}
              </button> : <span className="notes-tree-toggle" />}
              <LibraryItemIcon itemKey={itemKey} kind="folder" />
              <span className="notes-tree-name">{folder.name}</span>
              <Menu>
                <MenuTrigger disableButtonEnhancement><Button size="small" appearance="subtle" className="notes-folder-menu"
                  aria-label={`目录操作 ${folder.name}`} title="目录操作" icon={<MoreHorizontalRegular />}
                  onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} /></MenuTrigger>
                <MenuPopover><MenuList><LibraryIconMenuItem itemKey={itemKey} title={folder.name} /></MenuList></MenuPopover>
              </Menu>
            </div>
          </MenuTrigger>
          <MenuPopover><MenuList><LibraryIconMenuItem itemKey={itemKey} title={folder.name} /></MenuList></MenuPopover>
        </Menu>
        {open && children.length ? <div role="group">{rows(id, depth + 1, new Set([...ancestors, id]))}</div> : null}
      </div>;
    });
  return <nav className="notes-folders" aria-label="笔记目录">
    <Button appearance={model.folderId === NOTES_ROOT ? "secondary" : "subtle"} icon={<NoteRegular />}
      aria-pressed={model.folderId === NOTES_ROOT} onClick={() => model.selectFolder(NOTES_ROOT)}>所有笔记</Button>
    <div role="tree" aria-label="笔记文件夹">{rows(NOTES_ROOT)}</div>
  </nav>;
}

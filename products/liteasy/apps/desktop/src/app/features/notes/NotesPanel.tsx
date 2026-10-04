import { isAiOnlyNote, noteLabelEntries, noteLabels, resolvedNoteLabels, type NoteLabel } from "./noteLabels";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { NotesInlineEditor } from "./NotesInlineEditor";
import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import { ResourceLocationButton } from "../resource-filesystem/ResourceLocationButton";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  MenuItemCheckbox,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Tooltip,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowImportRegular,
  FolderOpenRegular,
  ArrowUpRightRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  FolderAddRegular,
  MoreHorizontalRegular,
  NoteRegular,
  SaveRegular,
  SearchRegular,
  FilterRegular,
} from "@fluentui/react-icons";
import {
  OBJECT_TRANSFER_MIME,
  PENDING_CAPTURE_MIME,
} from "../object-transfer/objectTransfer";
import { NOTES_REFERENCE_MIME } from "./notesPort";
import {
  NOTES_ROOT,
  type NotesFolder,
  type NotesItem,
  type NotesViewModel,
} from "./notes.types";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { ReferenceSourceContext } from "../resource-links/ResourceReferencesContext";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
import { LibraryIconProvider, LibraryIconMenuItem, LibraryItemIcon } from "../library/LibraryItemIcon";
import { NotesFolderTree } from "./NotesFolderTree";
import { notesFolderChildren, notesFolderPath } from "./notesHierarchy";
import "./notes.css";

function IconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactElement;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label} relationship="label">
      <Button
        size="small"
        appearance="subtle"
        aria-label={label}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
      />
    </Tooltip>
  );
}
export function NotesPanel({ model }: { model: NotesViewModel }) {
  const scope = model.scopeId ?? "local";
  return <LibraryIconProvider key={scope} scope={scope}><NotesPanelContent model={model} /></LibraryIconProvider>;
}
function noteIconKey(item: NotesItem) {
  return item.object ? `object:${item.object.objectId}` : item.key;
}
function NotesPanelContent({ model }: { model: NotesViewModel }) {
  const preference = useMarkdownEditing();
  const [labelFilter, setLabelFilter] = useState<NoteLabel | "">("");
  const [hideTranslations, setHideTranslations] = useState(false);
  const [hideAiOnly, setHideAiOnly] = useState(false);
  const labeledItems = useMemo(() => model.items.map((item) => ({ ...item, labels: item.labels ?? resolvedNoteLabels(item) })), [model.items]);
  const filteredItems = labeledItems.filter((item) => (!labelFilter || item.labels.includes(labelFilter)) &&
    (!hideTranslations || !item.labels.includes("translation")) && (!hideAiOnly || !isAiOnlyNote(item.labels)));
  const filterCount = Number(Boolean(labelFilter)) + Number(hideTranslations) + Number(hideAiOnly);
  const selected = filteredItems.find((item) => item.key === model.selected?.key);
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => setVisibleCount(100), [model.folderId, model.query, labelFilter, hideTranslations, hideAiOnly]);
  const [folderName, setFolderName] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [editingItem, setEditingItem] = useState<NotesItem>();
  const [destination, setDestination] = useState(NOTES_ROOT);
  const [collecting, setCollecting] = useState<NotesItem>();
  useEffect(() => {
    setDraft(undefined);
    setEditingItem(undefined);
    setCollecting(undefined);
  }, [model.folderId]);
  const run = (action: Promise<void>) => {
    void action.catch(() => undefined);
  };
  const paths = useMemo(() => {
    const byId = new Map(model.folders.map((folder) => [folder.folderId, folder]));
    return new Map(model.folders.map((folder) => [folder.folderId, notesFolderPath(folder.folderId, byId)]));
  }, [model.folders]);
  const path = (folder: NotesFolder) => paths.get(folder.folderId) ?? folder.name;
  const folders = [...model.folders].sort((a, b) =>
    path(a).localeCompare(path(b)),
  );
  const folder = model.folders.find((item) => item.folderId === model.folderId);
  const filename = (item: NotesItem) =>
    /\.(md|markdown|canvas)$/i.test(item.title)
      ? item.title
      : `${item.title}.${item.object?.kind === "workspace.board" ? "canvas" : "md"}`;
  const onDragOver = (event: React.DragEvent) => {
    if (
      [
        NOTES_REFERENCE_MIME,
        OBJECT_TRANSFER_MIME,
        PENDING_CAPTURE_MIME,
        "Files",
      ].some((type) => event.dataTransfer.types.includes(type))
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };
  return (
    <section className="notes-panel" aria-label="笔记" aria-busy={model.busy}>
      <header className="notes-toolbar">
        <NoteRegular aria-hidden="true" />
        <strong>笔记</strong>
        <IconButton
          label="新建笔记"
          icon={<AddRegular />}
          onClick={() => {
            setDraft("");
            setEditingItem(undefined);
          }}
        />
        <IconButton
          label="新建目录"
          icon={<FolderAddRegular />}
          onClick={() => setFolderName("")}
        />
        <IconButton
          label="导入 Markdown 文件"
          icon={<ArrowImportRegular />}
          onClick={() => run(model.importFiles())}
        />
        <IconButton
          label="连接文件夹 / Obsidian Vault"
          icon={<FolderOpenRegular />}
          onClick={() => run(model.connectFolder())}
        />
        <IconButton
          label="刷新笔记"
          icon={<ArrowClockwiseRegular />}
          onClick={() => run(model.refresh())}
        />
        {folder && !folder.system && (
          <IconButton
            label="删除空目录"
            icon={<DeleteRegular />}
            onClick={() => run(model.removeFolder())}
          />
        )}
      </header>
      <Input
        className="notes-search"
        aria-label="搜索笔记"
        placeholder="搜索笔记"
        contentBefore={<SearchRegular />}
        value={model.query}
        onChange={(_, data) => model.search(data.value)}
      />
      <div className="notes-label-filters">
        <Popover positioning="below-start" trapFocus>
          <PopoverTrigger disableButtonEnhancement>
            <Button size="small" appearance={filterCount ? "secondary" : "subtle"} icon={<FilterRegular />}>
              {filterCount ? `标签筛选 · ${filterCount}` : "标签筛选"}
            </Button>
          </PopoverTrigger>
          <PopoverSurface aria-label="笔记标签筛选" className="notes-filter-popover">
            <label>包含标签
              <Select aria-label="包含笔记标签" value={labelFilter} onChange={(_, data) => setLabelFilter(data.value as NoteLabel | "")}>
                <option value="">全部笔记</option>
                {noteLabelEntries.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </Select>
            </label>
            <Checkbox label="隐藏翻译结果" checked={hideTranslations} onChange={(_, data) => setHideTranslations(data.checked === true)} />
            <Checkbox label="隐藏纯 AI 内容" checked={hideAiOnly} onChange={(_, data) => setHideAiOnly(data.checked === true)} />
            <small>按已记录的来源和编辑痕迹筛选；来源不明的旧笔记会保留。可在笔记操作中补充标签。</small>
          </PopoverSurface>
        </Popover>
        {filterCount > 0 && <Button size="small" appearance="subtle" onClick={() => { setLabelFilter(""); setHideTranslations(false); setHideAiOnly(false); }}>清除筛选</Button>}
      </div>
      {model.error && (
        <p role="alert" className="notes-error">
          {model.error}
        </p>
      )}
      {model.sourceWarning && (
        <p role="status" className="notes-source-warning">
          {model.sourceWarning}
        </p>
      )}
      {folderName !== undefined && (
        <form
          className="notes-create-folder"
          onSubmit={(event) => {
            event.preventDefault();
            void model
              .createFolder(folderName)
              .then(() => setFolderName(undefined))
              .catch(() => undefined);
          }}
        >
          <Input
            autoFocus
            aria-label="目录名称"
            value={folderName}
            onChange={(_, data) => setFolderName(data.value)}
          />
          <Button
            size="small"
            type="submit"
            icon={<SaveRegular />}
            aria-label="创建目录"
          />
          <IconButton
            label="取消创建目录"
            icon={<DismissRegular />}
            onClick={() => setFolderName(undefined)}
          />
        </form>
      )}
      <div className="notes-body">
        <NotesFolderTree model={model} onDragOver={onDragOver} />
        <div
          className="notes-content"
          onDragOver={onDragOver}
          onDrop={(event) => {
            event.preventDefault();
            run(model.drop(event.dataTransfer, model.folderId));
          }}
        >
          <div className="notes-breadcrumb">
            {folder ? path(folder) : "所有笔记"}
            <span>{filterCount ? `${filteredItems.length} / ${model.items.length}` : model.items.length}</span>
          </div>
          {notesFolderChildren(model.folderId, model.folders).length > 0 && (
            <div className="notes-child-folders" aria-label="子目录">
              {notesFolderChildren(model.folderId, model.folders).map((child) => <Button key={child.folderId} appearance="subtle"
                icon={<LibraryItemIcon itemKey={`notes-folder:${child.folderId}`} kind="folder" />}
                onClick={() => model.selectFolder(child.folderId)}>{child.name}</Button>)}
            </div>
          )}
          {collecting && (
            <form
              className="notes-collect"
              onSubmit={(event) => {
                event.preventDefault();
                void model
                  .collect(collecting, destination)
                  .then(() => setCollecting(undefined))
                  .catch(() => undefined);
              }}
            >
              <Select
                aria-label="复制引用到目录"
                value={destination}
                onChange={(_, data) => setDestination(data.value)}
              >
                <option value={NOTES_ROOT}>Note</option>
                {folders.map((item) => (
                  <option key={item.folderId} value={item.folderId}>
                    Note/{path(item)}
                  </option>
                ))}
              </Select>
              <Button size="small" type="submit" icon={<CopyRegular />}>
                复制引用
              </Button>
              <IconButton
                label="取消复制引用"
                icon={<DismissRegular />}
                onClick={() => setCollecting(undefined)}
              />
            </form>
          )}
          {draft !== undefined && (
            <form
              className="notes-editor"
              onSubmit={(event) => {
                event.preventDefault();
                const item = editingItem;
                const save = item
                  ? model.editNote(item, draft)
                  : model.createNote(draft);
                void save
                  .then(() => {
                    setDraft(undefined);
                    setEditingItem(undefined);
                  })
                  .catch(() => undefined);
              }}
            >
              <ReferenceSourceContext.Provider value={editingItem ? liteasyPath(model.scopeId ?? "local", editingItem.target) : undefined}>
                <MarkdownEditor documentKey={editingItem?.key ?? `new:${model.folderId}`} label="笔记正文" value={draft} onChange={setDraft} />
              </ReferenceSourceContext.Provider>
              <div>
                <Button size="small" type="submit" icon={<SaveRegular />}>
                  保存
                </Button>
                <IconButton
                  label="取消编辑笔记"
                  icon={<DismissRegular />}
                  onClick={() => {
                    setDraft(undefined);
                    setEditingItem(undefined);
                  }}
                />
              </div>
            </form>
          )}
          {!model.busy && !filteredItems.length && draft === undefined && (
            <p className="notes-empty">
              {filterCount ? "没有符合筛选条件的笔记。试试清除筛选。" : "此目录还没有笔记。可以新建笔记，或将内容引用拖到这里。"}
            </p>
          )}
          <div className="notes-list" role="list" aria-label="笔记条目">
            {filteredItems.slice(0, visibleCount).map((item) => (
              <article
                key={item.key}
                role="listitem"
                className={`notes-item${model.selected?.key === item.key ? " is-selected" : ""}`}
                draggable={!item.unavailable}
                onDragStart={(event) => model.drag(item, event.dataTransfer)}
              >
                <button
                  className="notes-item-content"
                  onClick={() => {
                    model.selectItem(item);
                  }}
                  onDoubleClick={() => model.openSource(item)}
                  data-reading-entry={!item.unavailable ? "true" : undefined}
                  aria-label={`查看笔记 ${item.title}`}
                  aria-expanded={model.selected?.key === item.key}
                >
                  <span className="notes-item-title">
                    <LibraryItemIcon itemKey={noteIconKey(item)} kind={item.object?.kind === "workspace.board" || /\.canvas$/i.test(item.title) ? "board" : item.target.kind === "pdf-annotation" ? "pdf" : "note"} />
                    <strong title={item.title}>{item.title}</strong>
                  </span>
                  <span className="notes-item-source" title={item.source}>{item.source}</span>
                  {item.labels.length > 0 && <span className="notes-item-labels" aria-label="笔记标签">
                    {item.labels.map((label) => <span key={label} className={`notes-label notes-label-${label}`}>{noteLabels[label]}</span>)}
                  </span>}
                </button>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button
                      className="notes-item-menu"
                      size="small"
                      appearance="subtle"
                      icon={<MoreHorizontalRegular />}
                      aria-label={`笔记操作 ${item.title}`}
                      title="笔记操作"
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {model.setLabel && <Menu>
                        <MenuTrigger disableButtonEnhancement><MenuItem>笔记标签</MenuItem></MenuTrigger>
                        <MenuPopover><MenuList checkedValues={{ labels: item.labels }} onCheckedValueChange={(_, data) => {
                          const label = noteLabelEntries.find(([id]) => data.checkedItems.includes(id) !== item.labels.includes(id))?.[0];
                          if (label) run(model.setLabel!(item, label, data.checkedItems.includes(label)));
                        }}>
                          {noteLabelEntries.map(([id, title]) => <MenuItemCheckbox key={id} name="labels" value={id}>{title}</MenuItemCheckbox>)}
                        </MenuList></MenuPopover>
                      </Menu>}
                      <LibraryIconMenuItem itemKey={noteIconKey(item)} title={item.title} />
                      <MenuItem
                        icon={<ArrowUpRightRegular />}
                        disabled={item.unavailable}
                        onClick={() => model.openSource(item)}
                      >
                        打开来源
                      </MenuItem>
                      <MenuItem
                        icon={<CopyRegular />}
                        onClick={() => {
                          setCollecting(item);
                          setDestination(model.folderId);
                        }}
                      >
                        复制引用到…
                      </MenuItem>
                      {item.editable && (
                        <MenuItem
                          icon={<EditRegular />}
                          onClick={() => {
                            if (item.target.kind === "external-file") model.openSource(item);
                            else { setDraft(item.text); setEditingItem(item); }
                          }}
                        >
                          编辑笔记
                        </MenuItem>
                      )}
                      {item.entryId && (
                        <MenuItem
                          icon={<DeleteRegular />}
                          onClick={() => run(model.removeReference(item))}
                        >
                          移除目录引用
                        </MenuItem>
                      )}
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <ResourceLocationButton className="notes-item-location" target={item.target} />
              </article>
            ))}
          </div>
          {visibleCount < filteredItems.length ? <Button onClick={() => setVisibleCount((count) => count + 100)}>显示更多（已显示 {visibleCount} / {filteredItems.length}）</Button> : null}
          {selected &&
            draft === undefined &&
            (() => {
              const item = selected;
              const quote =
                item.annotation?.excerpt ||
                (item.object?.kind === "content.fragment"
                  ? item.object.content.payload.anchors
                      .map((anchor) =>
                        "quote" in anchor ? anchor.quote.exact : "",
                      )
                      .filter(Boolean)
                      .join("\n")
                  : "");
              return (
                <section className="notes-item-detail" aria-label="打开的笔记">
                  <header>
                    <strong>{filename(item)}</strong>
                    <span>{item.source}</span>
                  </header>
                  {item.target.kind === "external-file" ? <Button appearance="subtle" icon={<ArrowUpRightRegular />} onClick={() => model.openSource(item)}>在阅读区打开</Button> : item.annotation ? <PdfAnnotationMarkdown value={item.text} images={item.annotation.images} />
                    : <ReferenceSourceContext.Provider value={liteasyPath(model.scopeId ?? "local", item.target)}>{preference.mode === "live" && item.editable && item.object?.kind === "content.note" ? <NotesInlineEditor key={item.key} item={item} model={model} path={liteasyPath(model.scopeId ?? "local", item.target)} /> : <MarkdownContent value={item.text} paperAnchors={item.paperAnchors ?? item.object?.paperAnchors} />}</ReferenceSourceContext.Provider>}
                  <PaperAnchorReferences anchors={item.paperAnchors ?? item.object?.paperAnchors ?? []} />
                  {quote && !item.text.includes(quote) && (
                    <details>
                      <summary>原文</summary>
                      <blockquote><MarkdownContent value={quote} /></blockquote>
                    </details>
                  )}
                  <div className="notes-item-actions">
                    <IconButton
                      label="打开来源"
                      icon={<ArrowUpRightRegular />}
                      disabled={item.unavailable}
                      onClick={() => model.openSource(item)}
                    />
                    <IconButton
                      label="复制引用到目录"
                      icon={<CopyRegular />}
                      onClick={() => {
                        setCollecting(item);
                        setDestination(model.folderId);
                      }}
                    />
                    {item.editable && (
                      <IconButton
                        label="编辑笔记"
                        icon={<EditRegular />}
                        onClick={() => {
                          if (item.target.kind === "external-file") model.openSource(item);
                          else { setDraft(item.text); setEditingItem(item); }
                        }}
                      />
                    )}
                  </div>
                </section>
              );
            })()}
        </div>
      </div>
    </section>
  );
}

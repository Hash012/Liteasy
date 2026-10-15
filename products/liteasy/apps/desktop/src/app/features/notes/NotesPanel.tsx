import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { OptionPicker, ControlToolbar } from "../../shared/ui/productPrimitives";
import { ActionButton as Button, IconAction, ContextualActions } from "../../shared/ui/productPrimitives";
import { DocumentExportDialog } from "../document-export/DocumentExportDialog";
import { useDocumentExportPort } from "../document-export/documentExportPort";
import { SearchHighlight } from "../search/SearchOptions";
import { NoteLabelFilter, emptyNoteFilter, matchesNoteFilter } from "./NoteLabelFilter";
import { noteLabelEntries, noteLabels, resolvedNoteLabels, type NoteLabel } from "./noteLabels";
import { useMarkdownEditing } from "../markdown/MarkdownEditingContext";
import { NotesInlineEditor } from "./NotesInlineEditor";
import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import { ResourceLocationButton } from "../resource-filesystem/ResourceLocationButton";
import { useEffect, useMemo, useState } from "react";
import { MenuItemCheckbox, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip,  } from "@fluentui/react-components";
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
import { ContentView } from "../markdown/ContentView";
import { ContentExcerpt } from "../markdown/ContentExcerpt";
import { ResourceLink, ResourceReferenceView } from "../resource-links/ResourceReferenceView";
import { groupNotes, sortNotes, type NotesSort } from "./notesPresentation";
import { legacyContent } from "../markdown/contentFragment";
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
  const { tChinese } = useUiTranslation();
  const groupTitle = (group: { title: string; label?: string }) => {
    switch (group.label) {
      case "多篇论文": return tChinese("notes.group.multiple", "多篇论文");
      case "论文笔记": return tChinese("notes.group.paper", "论文笔记");
      case "产物笔记": return tChinese("notes.group.artifact", "产物笔记");
      case "白板": return tChinese("notes.group.board", "白板");
      case "外部笔记": return tChinese("notes.group.external", "外部笔记");
      case "个人笔记": return tChinese("notes.group.personal", "个人笔记");
      default: return group.title;
    }
  };
  const preference = useMarkdownEditing();
  const exportPort = useDocumentExportPort();
  const [exportMessage, setExportMessage] = useState("");
  const [exportItem, setExportItem] = useState<NotesItem>();
  const [filter, setFilter] = useState(emptyNoteFilter);
  const labeledItems = useMemo(() => model.items.map((item) => ({ ...item, labels: item.labels ?? resolvedNoteLabels(item) })), [model.items]);
  const [sort, setSort] = useState<NotesSort>("updated");
  const filteredItems = sortNotes(labeledItems.filter((item) => matchesNoteFilter(item.labels, filter)), sort);
  const groups = groupNotes(filteredItems);
  const [itemMenu, setItemMenu] = useState<string>();
  const filterCount = Number(Boolean(filter.label)) + Number(filter.hideTranslations) + Number(filter.hideLookup) + Number(filter.hideAiOnly);
  const selected = filteredItems.find((item) => item.key === model.selected?.key);
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => setVisibleCount(100), [model.folderId, model.query, filter]);
  const [folderName, setFolderName] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, { text?: string; item?: NotesItem }>>({});
  const draft = drafts[model.folderId]?.text;
  const editingItem = drafts[model.folderId]?.item;
  const setDraft = (text: string | undefined) => setDrafts(previous => ({ ...previous, [model.folderId]: { ...previous[model.folderId], text } }));
  const setEditingItem = (item: NotesItem | undefined) => setDrafts(previous => ({ ...previous, [model.folderId]: { ...previous[model.folderId], item } }));
  const [destination, setDestination] = useState(NOTES_ROOT);
  const [collecting, setCollecting] = useState<NotesItem>();
  const [inlineEditing, setInlineEditing] = useState<string>();
  const startEditing = (item: NotesItem) => {
    if (item.target.kind === "external-file") model.openSource(item);
    else if (preference.mode === "live" && item.object?.kind === "content.note") { model.selectItem(item); setInlineEditing(item.key); }
    else { setDraft(item.text); setEditingItem(item); }
  };
  useEffect(() => {
    setCollecting(undefined);
    setExportItem(undefined);
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
  const renderDetail = (item: NotesItem) => {
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
          {item.titleOrigin !== "derived-body" ? <strong>{filename(item)}</strong> : null}
          <span><ResourceLink locator={liteasyPath(model.scopeId ?? "local", item.target)} previewOnClick intent={item.annotation ? "origin" : "asset"}>{item.source}</ResourceLink></span>
          {exportPort && item.object?.kind !== "workspace.board" ? <Button size="small" appearance="subtle" disabled={item.unavailable} onClick={() => setExportItem(item)}>导出阅读文档</Button> : null}
        </header>
        {item.object?.kind === "workspace.board" ? <ResourceReferenceView locator={liteasyPath(model.scopeId ?? "local", item.target)} /> : item.target.kind === "external-file" ? <Button appearance="subtle" icon={<ArrowUpRightRegular />} onClick={() => model.openSource(item)}>在阅读区打开</Button> : item.annotation ? <PdfAnnotationMarkdown value={item.text} images={item.annotation.images} />
          : <ReferenceSourceContext.Provider value={liteasyPath(model.scopeId ?? "local", item.target)}>{inlineEditing === item.key && preference.mode === "live" && item.editable && item.object?.kind === "content.note" ? <NotesInlineEditor key={item.key} item={item} model={model} path={liteasyPath(model.scopeId ?? "local", item.target)} /> : <ContentView content={legacyContent(item.text)} paperAnchors={item.paperAnchors ?? item.object?.paperAnchors} />}</ReferenceSourceContext.Provider>}
        <PaperAnchorReferences anchors={item.paperAnchors ?? item.object?.paperAnchors ?? []} />
        {quote && (item.annotation?.note?.trim() || !item.text.includes(quote)) && (
          <DisclosureSection  title={<>原文</>}>

            <blockquote><ContentView content={legacyContent(quote)} /></blockquote>
          </DisclosureSection>
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
                startEditing(item);
              }}
            />
          )}
        </div>
      </section>
    );

  };
  return (
    <section className="notes-panel" aria-label="笔记" aria-busy={model.busy}>
      {exportPort && exportItem ? <DocumentExportDialog open jobScope={exportPort.jobScope} sourceIdentity={JSON.stringify([model.scopeId, exportItem.key, exportItem.updatedAt, exportItem.target, exportItem.title, exportItem.text])} title={exportItem.title} initialFormat="markdown"
        compile={(options, signal) => exportPort.compileNote(exportItem, options, signal)} publish={exportPort.publish}
        onClose={() => setExportItem(undefined)} onOutcome={outcome => { if (outcome.status !== "cancelled") setExportMessage(outcome.record.location === "desktop" ? `已导出到 ${outcome.record.path}` : "已交给浏览器下载，保存位置由浏览器管理。"); }} /> : null}
      {exportMessage ? <p aria-live="polite">{exportMessage}</p> : null}
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
        <Menu><MenuTrigger disableButtonEnhancement><IconAction density="compact" label="更多笔记操作" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList>
          <MenuItem icon={<FolderAddRegular />} onClick={() => setFolderName("")}>新建目录</MenuItem>
          <MenuItem icon={<ArrowImportRegular />} onClick={() => run(model.importFiles())}>导入 Markdown 文件</MenuItem>
          <MenuItem icon={<FolderOpenRegular />} onClick={() => run(model.connectFolder())}>连接文件夹 / Obsidian Vault</MenuItem>
          <MenuItem icon={<ArrowClockwiseRegular />} onClick={() => run(model.refresh())}>刷新笔记</MenuItem>
          {folder && !folder.system ? <MenuItem icon={<DeleteRegular />} onClick={() => run(model.removeFolder())}>删除空目录</MenuItem> : null}
        </MenuList></MenuPopover></Menu>
      </header>
      <ControlToolbar className="notes-filter-toolbar" label="笔记筛选与排序"><Input size="small"
        className="notes-search"
        aria-label="搜索笔记"
        placeholder="搜索笔记"
        contentBefore={<SearchRegular />}
        value={model.query}
        onChange={(_, data) => model.search(data.value)}
      />
      <OptionPicker aria-label={tChinese("notes.sort.label", "笔记排序")} value={sort} onValueChange={value => setSort(value as NotesSort)} options={[{ value: "updated", label: tChinese("notes.sort.updated", "最近修改") }, { value: "page", label: tChinese("notes.sort.page", "页码") }, { value: "title", label: tChinese("notes.sort.title", "标题") }]} />
      <NoteLabelFilter compact value={filter} onChange={setFilter} query={model.query} onQueryChange={model.search} /></ControlToolbar>
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
              <OptionPicker aria-label="复制引用到目录" value={String(destination ?? "")} onValueChange={nextValue => setDestination(nextValue)} options={[{ value: String(NOTES_ROOT), label: String("Note") }, ...(folders.map((item) => ({ value: String(item.folderId), label: String(["Note/", path(item)].join(" ")) })))]} />
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
              {filterCount ? tChinese("notes.empty.filtered", "没有符合筛选条件的笔记") : tChinese("notes.empty.folder", "暂无笔记")}
            </p>
          )}
          <div className="notes-list" role="list" aria-label="笔记条目">
            {groups.filter(group => group.items.some(item => filteredItems.indexOf(item) < visibleCount)).map((group) => <section key={group.id} className="notes-paper-group" aria-label={groupTitle(group)} data-paper-group={group.id}>
              <h3>{groupTitle(group)}<span>{group.items.length}</span></h3>
              {group.items.filter(item => filteredItems.indexOf(item) < visibleCount).map((item) => (
              <article
                key={item.key}
                role="listitem"
                className={`notes-item product-contextual-owner${model.selected?.key === item.key ? " is-selected" : ""}`}
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
                    <strong title={item.title}>{item.titleOrigin === "derived-body" ? "批注" : <SearchHighlight text={item.title} query={model.query} />}</strong>
                  </span>

                  {model.selected?.key === item.key && (item.labels ?? []).length > 0 && <span className="notes-item-labels" aria-label="笔记标签">
                    {(item.labels ?? []).map((label) => <span key={label} className={`notes-label notes-label-${label}`}>{noteLabels[label]}</span>)}
                  </span>}
                </button>
                {item.boardMembers ? <span className="notes-item-source">{item.boardMembers.length} 个元素{item.memberHits?.length ? ` · 命中 ${item.memberHits.length} 个元素` : ""}</span> : <div className="notes-item-source" title={item.source}>{item.unavailable ? "来源不可用" : <ResourceLink locator={liteasyPath(model.scopeId ?? "local", item.target)} previewOnClick intent={item.annotation ? "origin" : "asset"}>{item.source || "来源不明"}</ResourceLink>}</div>}
                {model.selected?.key !== item.key && item.text.trim() ? <div className="notes-item-excerpt"><ContentExcerpt content={legacyContent(item.text)} paperAnchors={item.paperAnchors ?? item.object?.paperAnchors} /></div> : null}
                {item.memberHits?.length ? <DisclosureSection title="查看命中元素">{item.memberHits.map(hit => <Button key={hit.placementId} size="small" appearance="subtle" onClick={() => model.openBoardMember?.(item, hit.placementId)}>{hit.title}</Button>)}</DisclosureSection> : null}
                <ContextualActions selected={model.selected?.key === item.key} menuOpen={itemMenu === item.key}><Menu onOpenChange={(_, data) => setItemMenu(data.open ? item.key : undefined)}>
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
                        <MenuPopover><MenuList checkedValues={{ labels: item.labels ?? [] }} onCheckedValueChange={(_, data) => {
                          const label = noteLabelEntries.find(([id]) => data.checkedItems.includes(id) !== (item.labels ?? []).includes(id))?.[0];
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
                            startEditing(item);
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
                <ResourceLocationButton className="notes-item-location" target={item.target} onOpenChange={open => setItemMenu(open ? item.key : undefined)} /></ContextualActions>
                {selected?.key === item.key && draft === undefined ? renderDetail(item) : null}
              </article>
            ))}</section>)}
          </div>
          {visibleCount < filteredItems.length ? <Button onClick={() => setVisibleCount((count) => count + 100)}>显示更多（已显示 {visibleCount} / {filteredItems.length}）</Button> : null}

        </div>
      </div>
    </section>
  );
}

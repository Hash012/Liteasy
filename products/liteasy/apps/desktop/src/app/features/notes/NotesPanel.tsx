import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Textarea,
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
  DocumentRegular,
  EditRegular,
  FolderAddRegular,
  FolderRegular,
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
import { MarkdownContent } from "../markdown/MarkdownContent";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
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
  const path = (folder: NotesFolder): string => {
    const parent = model.folders.find(
      (candidate) => candidate.folderId === folder.parentId,
    );
    return parent ? `${path(parent)}/${folder.name}` : folder.name;
  };
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
        <nav className="notes-folders" aria-label="Note 目录">
          <Button
            appearance={model.folderId === NOTES_ROOT ? "secondary" : "subtle"}
            icon={<FolderRegular />}
            aria-pressed={model.folderId === NOTES_ROOT}
            onClick={() => model.selectFolder(NOTES_ROOT)}
            onDragOver={onDragOver}
            onDrop={(event) => {
              event.preventDefault();
              run(model.drop(event.dataTransfer, NOTES_ROOT));
            }}
          >
            Note
          </Button>
          {folders.map((item) => (
            <Button
              key={item.folderId}
              className="notes-folder"
              appearance={
                model.folderId === item.folderId ? "secondary" : "subtle"
              }
              icon={<FolderRegular />}
              aria-pressed={model.folderId === item.folderId}
              aria-label={path(item)}
              title={`Note/${path(item)}`}
              onClick={() => model.selectFolder(item.folderId)}
              onDragOver={onDragOver}
              onDrop={(event) => {
                event.preventDefault();
                run(model.drop(event.dataTransfer, item.folderId));
              }}
            >
              {item.name}
            </Button>
          ))}
        </nav>
        <div
          className="notes-content"
          onDragOver={onDragOver}
          onDrop={(event) => {
            event.preventDefault();
            run(model.drop(event.dataTransfer, model.folderId));
          }}
        >
          <div className="notes-breadcrumb">
            Note{folder ? `/${path(folder)}` : ""}
            <span>{model.items.length}</span>
          </div>
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
              <Textarea
                autoFocus
                resize="vertical"
                aria-label="笔记正文"
                value={draft}
                onChange={(_, data) => setDraft(data.value)}
              />
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
          {!model.busy && !model.items.length && draft === undefined && (
            <p className="notes-empty">
              此目录还没有笔记。可以新建笔记，或将内容引用拖到这里。
            </p>
          )}
          <div className="notes-list" role="list" aria-label="笔记条目">
            {model.items.map((item) => (
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
                    if (
                      item.object?.kind === "workspace.board" ||
                      item.file?.path.endsWith(".canvas")
                    )
                      model.openSource(item);
                  }}
                  aria-label={`查看笔记 ${item.title}`}
                  aria-expanded={model.selected?.key === item.key}
                >
                  <span className="notes-item-title">
                    {item.target.kind === "pdf-annotation" ? (
                      <DocumentRegular aria-hidden="true" />
                    ) : (
                      <NoteRegular aria-hidden="true" />
                    )}
                    <strong title={filename(item)}>{filename(item)}</strong>
                  </span>
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
                            setDraft(item.text);
                            setEditingItem(item);
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
              </article>
            ))}
          </div>
          {model.selected &&
            draft === undefined &&
            (() => {
              const item = model.selected;
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
                  {item.annotation ? <PdfAnnotationMarkdown value={item.text} images={item.annotation.images} />
                    : <MarkdownContent value={item.text} paperAnchors={item.paperAnchors ?? item.object?.paperAnchors} />}
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
                          setDraft(item.text);
                          setEditingItem(item);
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

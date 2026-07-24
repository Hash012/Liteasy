import {
  useEffect,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import { Tooltip } from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  BookmarkRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DocumentPdfRegular,
  FolderRegular,
  LockClosedRegular,
  LockOpenRegular,
  LibraryRegular,
  LightbulbRegular,
  NoteRegular,
  SparkleRegular
} from "@fluentui/react-icons";
import type { CollectionItem } from "../collection/collection.types";
import "./library.css";
import type { ImportJob } from "../import/import.types";
import type { RecommendationItem, RecommendationStatus } from "../recommendations/recommendation.types";
import type { Paper, WorkspaceSourceType } from "../workspace/workspace.types";
import { parseLibraryDragPayload } from "./libraryDragPayload";
import {
  buildWorkspaceFolderTree,
  type WorkspaceFolderNode
} from "../workspace/workspaceFolderTree";
import {
  getWorkspaceParentPath,
  normalizeWorkspacePath
} from "../workspace/workspacePathOperations";

export type LibraryPaperChildItem = {
  id: string;
  kind: "artifact" | "note";
  label: string;
  meta?: string;
};

type LibraryPaneProps = {
  accountSessionAvailable?: boolean;
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  collectionItems: CollectionItem[];
  collectionMessage: string;
  collectionStatus: "idle" | "loading" | "ready" | "error";
  importJobs: Record<string, ImportJob>;
  activePaperId?: string | null;
  paperChildren?: Record<string, LibraryPaperChildItem[]>;
  recommendationItems: RecommendationItem[];
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  canOpenOrganizationWorkspace: boolean;
  organizationWorkspaceLabel?: string;
  onAddExternalPaper: (item: CollectionItem | RecommendationItem) => void;
  onAddDroppedPdfFiles?: (files: File[]) => void;
  onClearRecommendations: () => void;
  onCollectRecommendation: (recommendation: RecommendationItem) => void;
  onImportSelectedSet: () => void;
  onLoginRequired?: () => void;
  onOpenOrganizationWorkspace: () => void;
  onOpenPaper?: (paperId: string) => void;
  onOpenPaperChild?: (item: LibraryPaperChildItem, paper: Paper) => void;
  onRefreshLocalLibrary?: () => Promise<void>;
  onMoveFolder?: (folderPath: string, targetFolderPath: string) => Promise<string>;
  onMovePaper?: (paperId: string, targetFolderPath: string) => Promise<string>;
  onRetryCollectionSync?: () => void;
  onRenameFolder?: (folderPath: string, requestedName: string) => Promise<string>;
  onRenamePaper?: (paperId: string, requestedName: string) => Promise<string>;
  onReturnToLocalWorkspace: () => void;
  onToggleLock: () => void;
  onToggleSelection: (paperId: string) => void;
  workspaceLabel: string;
  workspaceSourceType: WorkspaceSourceType;
};

type LibraryCollectionId =
  | "my-library"
  | "courses"
  | "vector-search"
  | "late-interaction"
  | "vector-database";

type LibrarySectionId = "library" | "collections" | "recommendations";

type LibraryCollection = {
  children: LibraryCollection[];
  id: LibraryCollectionId;
  label: string;
};

type ResourceContextMenu = {
  left: number;
  target:
    | { folder: WorkspaceFolderNode; kind: "folder" }
    | { kind: "paper"; paper: Paper };
  top: number;
};

type ResourceOperationDialog = {
  action: "move" | "rename";
  target:
    | { folder: WorkspaceFolderNode; kind: "folder" }
    | { kind: "paper"; paper: Paper };
  value: string;
};

const workspaceResourceMimeType = "application/x-liteasy-workspace-resource";

function flattenFolderPaths(nodes: WorkspaceFolderNode[]): string[] {
  return nodes.flatMap((node) => [node.path, ...flattenFolderPaths(node.children)]);
}

const importStatusLabels: Record<ImportJob["status"], string> = {
  failed: "PDF 解析失败",
  parsed: "PDF 已就绪",
  parsing: "正在解析 PDF",
  queued: "等待解析 PDF"
};

const libraryCollections: LibraryCollection[] = [
  {
    children: [
      {
        children: [
          {
            children: [
              { children: [], id: "late-interaction", label: "Late Interaction" }
            ],
            id: "vector-search",
            label: "Vector Search"
          },
          { children: [], id: "vector-database", label: "Vector Database" }
        ],
        id: "courses",
        label: "Courses"
      }
    ],
    id: "my-library",
    label: "My Library"
  }
];

function findLibraryCollection(
  collections: LibraryCollection[],
  collectionId: LibraryCollectionId
): LibraryCollection | undefined {
  for (const collection of collections) {
    if (collection.id === collectionId) {
      return collection;
    }

    const child = findLibraryCollection(collection.children, collectionId);
    if (child) {
      return child;
    }
  }

  return undefined;
}

function getRelevanceLabel(band: RecommendationItem["relevanceBand"]) {
  if (band === "high") {
    return "高关联";
  }

  if (band === "medium") {
    return "中关联";
  }

  return "低关联";
}

function paperMatchesCollection(paper: Paper, collectionId: LibraryCollectionId) {
  const searchableText = `${paper.title} ${paper.sourcePath ?? ""}`.toLowerCase();

  if (collectionId === "my-library" || collectionId === "courses") {
    return true;
  }

  if (collectionId === "late-interaction") {
    return searchableText.includes("colbert") || searchableText.includes("late-interaction");
  }

  if (collectionId === "vector-database") {
    return searchableText.includes("vector database");
  }

  return (
    searchableText.includes("vector") ||
    searchableText.includes("colbert") ||
    searchableText.includes("acorn")
  );
}

export function LibraryPane({
  accountSessionAvailable = false,
  activePaperId,
  papers,
  paperChildren = {},
  selectedPaperIds,
  selectionLocked,
  collectionItems,
  collectionMessage,
  collectionStatus,
  importJobs,
  recommendationItems,
  recommendationMessage,
  recommendationPending,
  recommendationStatus,
  canOpenOrganizationWorkspace,
  organizationWorkspaceLabel = "组织共享文献库",
  onAddExternalPaper,
  onAddDroppedPdfFiles,
  onClearRecommendations,
  onCollectRecommendation,
  onLoginRequired,
  onOpenOrganizationWorkspace,
  onOpenPaper,
  onOpenPaperChild,
  onRefreshLocalLibrary,
  onMoveFolder,
  onMovePaper,
  onRetryCollectionSync,
  onRenameFolder,
  onRenamePaper,
  onReturnToLocalWorkspace,
  onToggleLock,
  onToggleSelection,
  workspaceLabel,
  workspaceSourceType
}: LibraryPaneProps) {
  const selectedCount = selectedPaperIds.length;
  const [activeCollectionId, setActiveCollectionId] = useState<LibraryCollectionId>("my-library");
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<LibrarySectionId[]>([]);
  const activeCollection =
    findLibraryCollection(libraryCollections, activeCollectionId) ??
    libraryCollections[0];
  const visiblePapers = papers.filter((paper) => paperMatchesCollection(paper, activeCollection.id));
  const folderTree = buildWorkspaceFolderTree(
    visiblePapers,
    workspaceSourceType === "local_library" ? workspaceLabel : undefined
  );
  const folderPaths = flattenFolderPaths(folderTree);
  const [collapsedCollectionIds, setCollapsedCollectionIds] = useState<LibraryCollectionId[]>([]);
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<string[]>([]);
  const [expandedPaperIds, setExpandedPaperIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ResourceContextMenu | null>(null);
  const [operationDialog, setOperationDialog] = useState<ResourceOperationDialog | null>(null);
  const [resourceActionMessage, setResourceActionMessage] = useState("");
  const [dropTargetFolderPath, setDropTargetFolderPath] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const resourceEditingEnabled = workspaceSourceType === "local_library";
  const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceLabel);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    function closeContextMenu(event: KeyboardEvent | Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") {
        return;
      }
      setContextMenu(null);
    }
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("keydown", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenu);
    };
  }, [contextMenu]);

  function openContextMenu(
    event: ReactMouseEvent,
    target: ResourceContextMenu["target"]
  ) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      left: Math.min(event.clientX, Math.max(8, window.innerWidth - 230)),
      target,
      top: Math.min(event.clientY, Math.max(8, window.innerHeight - 330))
    });
  }

  function openOperationDialog(
    action: ResourceOperationDialog["action"],
    target: ResourceOperationDialog["target"]
  ) {
    const value = action === "rename"
      ? target.kind === "paper"
        ? target.paper.title
        : target.folder.name
      : target.kind === "paper"
        ? getWorkspaceParentPath(target.paper.sourcePath ?? "")
        : getWorkspaceParentPath(target.folder.path);
    setContextMenu(null);
    setOperationDialog({ action, target, value });
  }

  async function submitResourceOperation(event: FormEvent) {
    event.preventDefault();
    const dialog = operationDialog;
    if (!dialog || !dialog.value.trim()) {
      return;
    }
    let message = "";
    if (dialog.target.kind === "paper") {
      message = dialog.action === "rename"
        ? await onRenamePaper?.(dialog.target.paper.id, dialog.value) ?? ""
        : await onMovePaper?.(dialog.target.paper.id, dialog.value) ?? "";
    } else {
      message = dialog.action === "rename"
        ? await onRenameFolder?.(dialog.target.folder.path, dialog.value) ?? ""
        : await onMoveFolder?.(dialog.target.folder.path, dialog.value) ?? "";
    }
    setResourceActionMessage(message);
    setOperationDialog(null);
  }

  async function copyResourceText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setResourceActionMessage(`已复制${label}。`);
    } catch {
      setResourceActionMessage(`无法访问剪贴板；${label}为：${value}`);
    }
    setContextMenu(null);
  }

  function readDraggedResource(event: ReactDragEvent) {
    const serialized = event.dataTransfer.getData(workspaceResourceMimeType);
    if (!serialized) {
      return null;
    }
    try {
      return JSON.parse(serialized) as { id?: string; kind?: string; path?: string };
    } catch {
      return null;
    }
  }

  async function dropResourceIntoFolder(event: ReactDragEvent, folderPath: string) {
    if (!resourceEditingEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDropTargetFolderPath(null);
    const resource = readDraggedResource(event);
    if (resource?.kind === "paper" && resource.id) {
      setResourceActionMessage(await onMovePaper?.(resource.id, folderPath) ?? "");
    } else if (resource?.kind === "folder" && resource.path) {
      setResourceActionMessage(await onMoveFolder?.(resource.path, folderPath) ?? "");
    }
  }

  function toggleFolder(path: string) {
    setCollapsedFolderPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }

  function toggleCollection(collectionId: LibraryCollectionId) {
    setCollapsedCollectionIds((current) =>
      current.includes(collectionId)
        ? current.filter((item) => item !== collectionId)
        : [...current, collectionId]
    );
  }

  function toggleSection(sectionId: LibrarySectionId) {
    setCollapsedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId]
    );
  }

  function renderSectionHeader(
    sectionId: LibrarySectionId,
    title: string,
    icon: ReactNode,
    count?: number
  ) {
    const expanded = !collapsedSectionIds.includes(sectionId);
    return (
      <button
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}${title}`}
        className="library-section-header"
        onClick={() => toggleSection(sectionId)}
        type="button"
      >
        <span aria-hidden="true" className="library-section-disclosure">
          {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </span>
        <span aria-hidden="true" className="library-section-icon">{icon}</span>
        <span className="library-section-title">{title}</span>
        {count !== undefined ? <span className="library-section-count">{count}</span> : null}
      </button>
    );
  }

  function togglePaper(paperId: string) {
    setExpandedPaperIds((current) =>
      current.includes(paperId)
        ? current.filter((item) => item !== paperId)
        : [...current, paperId]
    );
  }

  function renderPaper(paper: Paper, depth: number) {
    const children = paperChildren[paper.id] ?? [];
    const expanded = expandedPaperIds.includes(paper.id);
    const selected = selectedPaperIds.includes(paper.id);
    const active = activePaperId === paper.id;

    return (
      <li
        className={`library-item${selected ? " selected" : ""}${active ? " active" : ""}`}
        data-selected={selected}
        key={paper.id}
      >
        <div
          className="paper-row"
          draggable={resourceEditingEnabled}
          onContextMenu={(event) => openContextMenu(event, { kind: "paper", paper })}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              workspaceResourceMimeType,
              JSON.stringify({ id: paper.id, kind: "paper" })
            );
          }}
          style={{ paddingLeft: `${depth * 10}px` }}
          title="右键查看更多文件操作；也可拖动到其他目录"
        >
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}${paper.title}的关联条目`}
            className="library-disclosure"
            onClick={() => togglePaper(paper.id)}
            title={`${expanded ? "收起" : "展开"}相关产物和笔记`}
            type="button"
          >
            <span aria-hidden="true">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          </button>
          <label className="library-paper-selector" title={selectionLocked ? "选中文献集已锁定" : "加入或移出选中文献集"}>
            <input
              aria-label={paper.title}
              checked={selected}
              disabled={selectionLocked}
              onChange={() => onToggleSelection(paper.id)}
              type="checkbox"
            />
          </label>
          <button
            className="library-paper-title"
            onClick={() => onOpenPaper?.(paper.id)}
            title={`打开 PDF：${paper.title}`}
            type="button"
          >
            <span aria-hidden="true" className="library-file-icon"><DocumentPdfRegular /></span>
            <span>{paper.title}</span>
          </button>
          {importJobs[paper.id] ? (
            <span className={`job-badge ${importJobs[paper.id].status}`}>
              {importStatusLabels[importJobs[paper.id].status]}
            </span>
          ) : null}
        </div>
        {expanded ? (
          <ul aria-label={`${paper.title}的关联条目`} className="library-paper-children">
            {children.length > 0 ? children.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  className="library-paper-child"
                  onClick={() => onOpenPaperChild?.(item, paper)}
                  title={item.meta ?? item.label}
                  type="button"
                >
                  <span aria-hidden="true" className={`library-child-icon ${item.kind}`}>
                    {item.kind === "artifact" ? <SparkleRegular /> : <NoteRegular />}
                  </span>
                  <span className="library-child-label">{item.label}</span>
                  {item.meta ? <span className="library-child-meta">{item.meta}</span> : null}
                </button>
              </li>
            )) : (
              <li className="library-paper-child-empty">暂无已保存的多模态产物或用户笔记</li>
            )}
          </ul>
        ) : null}
      </li>
    );
  }

  function renderFolder(node: WorkspaceFolderNode, depth = 0, rootFolder = true) {
    const expanded = !collapsedFolderPaths.includes(node.path);
    const folderLabel = rootFolder ? workspaceLabel : node.name;
    const workspaceRootFolder = normalizeWorkspacePath(node.path) === normalizedWorkspaceRoot;

    return (
      <li className="library-folder-node" key={node.path}>
        <div
          className={`library-folder-row${dropTargetFolderPath === node.path ? " drop-target" : ""}`}
          draggable={resourceEditingEnabled && node.path !== "未归档文献" && !workspaceRootFolder}
          onContextMenu={(event) => openContextMenu(event, { folder: node, kind: "folder" })}
          onDragOver={(event) => {
            if (
              resourceEditingEnabled &&
              Array.from(event.dataTransfer.types).includes(workspaceResourceMimeType)
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetFolderPath(node.path);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropTargetFolderPath((current) => current === node.path ? null : current);
            }
          }}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              workspaceResourceMimeType,
              JSON.stringify({ kind: "folder", path: node.path })
            );
          }}
          onDrop={(event) => void dropResourceIntoFolder(event, node.path)}
          style={{ paddingLeft: `${depth * 10}px` }}
          title="右键查看更多目录操作；可把文件或目录拖到这里"
        >
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}目录 ${node.path}`}
            className="library-disclosure"
            onClick={() => toggleFolder(node.path)}
            type="button"
          >
            <span aria-hidden="true">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          </button>
          <button
            className="library-folder-name"
            onClick={() => toggleFolder(node.path)}
            title={node.path}
            type="button"
          >
            <span aria-hidden="true" className="library-folder-icon"><FolderRegular /></span>
            <span>{folderLabel}</span>
          </button>
          <span className="library-folder-count">{node.paperCount} 篇文献</span>
        </div>
        {expanded ? (
          <ul className="library-tree-children">
            {node.children.map((child) => renderFolder(child, depth + 1, false))}
            {node.papers.map((paper) => renderPaper(paper, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  function renderCollection(collection: LibraryCollection, depth = 0) {
    const active = activeCollection.id === collection.id;
    const expanded = !collapsedCollectionIds.includes(collection.id);
    const hasChildren = collection.children.length > 0;

    return (
      <li className="library-collection-node" key={collection.id}>
        <div
          className={`library-collection-row${active ? " active" : ""}`}
          style={{ paddingLeft: `${depth * 10}px` }}
        >
          {hasChildren ? (
            <button
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"} Collection ${collection.label}`}
              className="library-disclosure"
              onClick={() => toggleCollection(collection.id)}
              type="button"
            >
              <span aria-hidden="true">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
            </button>
          ) : (
            <span aria-hidden="true" className="library-disclosure-spacer" />
          )}
          <button
            aria-pressed={active}
            className="library-collection-name"
            onClick={() => {
              setActiveCollectionId(collection.id);
              if (!expanded) {
                toggleCollection(collection.id);
              }
            }}
            title={`打开 Collection：${collection.label}`}
            type="button"
          >
            <span aria-hidden="true" className="library-folder-icon"><FolderRegular /></span>
            <span>{collection.label}</span>
          </button>
        </div>
        {expanded ? (
          <ul className="library-tree-children">
            {collection.children.map((child) => renderCollection(child, depth + 1))}
            {active ? (
              <li className="library-collection-content">
                <div className="library-folder-tree" aria-label="工作区目录树">
                  {folderTree.length > 0 ? (
                    <ul className="library-resource-tree">
                      {folderTree.map((node) => renderFolder(node, depth + 1))}
                    </ul>
                  ) : (
                    <div className="library-empty-collection">当前 Collection 暂无文献</div>
                  )}
                </div>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="library-pane">
      <div className="library-toolbar">
        <Tooltip
          content={selectionLocked ? "解除选中文献集锁定" : "锁定选中文献集"}
          positioning="below"
          relationship="description"
        >
          <button
            aria-label={selectionLocked ? "解除锁定" : "锁定选择"}
            className="library-button ghost library-icon-button"
            onClick={onToggleLock}
            title={selectionLocked ? "解除锁定" : "锁定选择"}
            type="button"
          >
            {selectionLocked ? <LockOpenRegular /> : <LockClosedRegular />}
          </button>
        </Tooltip>
        <Tooltip content="刷新本地文献库" positioning="below" relationship="description">
          <button
            aria-label="刷新本地文献库"
            className="library-button ghost library-icon-button"
            onClick={() => {
              setResourceActionMessage("正在刷新本地文献库…");
              void onRefreshLocalLibrary?.().then(() => {
                setResourceActionMessage("本地文献库已刷新。");
              }).catch((error) => {
                setResourceActionMessage(
                  `刷新失败：${error instanceof Error ? error.message : String(error)}`
                );
              });
            }}
            title="刷新本地文献库"
            type="button"
          >
            <ArrowSyncRegular />
          </button>
        </Tooltip>
      </div>

      <section
        aria-label="我的文献库投放区"
        className="library-section library-drop-zone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const droppedPdfFiles = Array.from(event.dataTransfer.files ?? []).filter((file) =>
            file.name.toLowerCase().endsWith(".pdf")
          );
          if (droppedPdfFiles.length > 0) {
            onAddDroppedPdfFiles?.(droppedPdfFiles);
            return;
          }

          const payload = parseLibraryDragPayload<CollectionItem | RecommendationItem>(
            event.dataTransfer,
            "application/liteasy-library-item"
          );
          if (payload) {
            onAddExternalPaper(payload);
          }
        }}
      >
        {renderSectionHeader("library", "我的文献库", <LibraryRegular />, papers.length)}
        {!collapsedSectionIds.includes("library") ? <div className="library-section-content">
        <div className="library-workspace-overview">
          <div>
            <div className="library-workspace-label">{workspaceLabel}</div>
          </div>
          <div aria-label="文献视图切换" className="library-workspace-switcher" role="group">
            <button
              aria-pressed={workspaceSourceType === "local_library"}
              className={workspaceSourceType === "local_library" ? "active" : ""}
              onClick={() => {
                if (workspaceSourceType !== "local_library") {
                  onReturnToLocalWorkspace();
                }
              }}
              title="查看本地文献库，不会退出当前组织"
              type="button"
            >
              本地
            </button>
            <button
              aria-pressed={workspaceSourceType === "organization_shared"}
              className={workspaceSourceType === "organization_shared" ? "active" : ""}
              disabled={workspaceSourceType !== "organization_shared" && !canOpenOrganizationWorkspace}
              onClick={() => {
                if (workspaceSourceType !== "organization_shared" && canOpenOrganizationWorkspace) {
                  onOpenOrganizationWorkspace();
                }
              }}
              title={
                canOpenOrganizationWorkspace || workspaceSourceType === "organization_shared"
                  ? `查看${organizationWorkspaceLabel}`
                  : "登录并加载组织空间后可切换到组织共享文献库"
              }
              type="button"
            >
              组织
            </button>
          </div>
        </div>
        <div className="library-selection-summary">
          已选 {selectedCount} 篇{selectionLocked ? " · 已锁定" : ""}
        </div>
        <div
          aria-label="PDF 文件拖拽导入区"
          className="library-file-drop-target"
          onClick={() => document.getElementById('pdf-file-input')?.click()}
        >
          <input
            key={fileInputKey}
            id="pdf-file-input"
            type="file"
            accept=".pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              const pdfFiles = files.filter(file => file.name.toLowerCase().endsWith('.pdf'));
              if (pdfFiles.length > 0) {
                onAddDroppedPdfFiles?.(pdfFiles);
                setFileInputKey(prev => prev + 1);
              }
            }}
          />
          拖入 PDF 添加到文献库
          <span className="library-file-drop-hint">或点击上传</span>
        </div>
        {resourceActionMessage ? (
          <div aria-live="polite" className="library-resource-action-message">
            {resourceActionMessage}
          </div>
        ) : null}
        <div className="library-collection-browser">
          <nav aria-label="文献库 collections" className="library-collection-tree">
            <ul className="library-resource-tree">
              {libraryCollections.map((collection) => renderCollection(collection))}
            </ul>
          </nav>
        </div>
        </div> : null}
      </section>

      <section
        aria-label="收藏投放区"
        className={`library-section muted ${collectionItems.length > 0 ? "has-collection" : ""} ${!accountSessionAvailable ? "locked" : ""}`}
        onDragOver={(event) => {
          if (!accountSessionAvailable) {
            return;
          }
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!accountSessionAvailable) {
            return;
          }
          event.preventDefault();
          const payload = parseLibraryDragPayload<RecommendationItem>(
            event.dataTransfer,
            "application/liteasy-recommendation"
          );
          if (payload) {
            onCollectRecommendation(payload);
          }
        }}
      >
        {renderSectionHeader("collections", "收藏", <BookmarkRegular />, collectionItems.length)}
        {!collapsedSectionIds.includes("collections") ? <div className="library-section-content">
        {!accountSessionAvailable ? (
          <button
            className="library-inline-button"
            onClick={onLoginRequired}
            title="登录后可用的云端收藏会显示在这里。"
            type="button"
          >
            登录后可用
          </button>
        ) : collectionStatus === "loading" ? (
          <p className="collection-status-message loading">{collectionMessage}</p>
        ) : collectionStatus === "error" ? (
          <>
            <p className="collection-status-message error">{collectionMessage}</p>
            <button className="library-inline-button" onClick={onRetryCollectionSync} type="button">
              重试同步
            </button>
          </>
        ) : collectionItems.length === 0 ? (
          <p className="collection-status-message ready">
            {collectionStatus === "ready" ? "拖入推荐以收藏" : collectionMessage}
          </p>
        ) : (
          <ul className="collection-list">
            {collectionItems.map((item) => (
              <li
                className="collection-item"
                draggable
                key={item.id}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/liteasy-library-item",
                    JSON.stringify(item)
                  );
                }}
              >
                <div className="collection-title">{item.title}</div>
                <div className="collection-meta">来源：{item.source}</div>
                <div className="collection-reason">{item.reason}</div>
              </li>
            ))}
          </ul>
        )}
        </div> : null}
      </section>

      <section className={`library-section muted ${!accountSessionAvailable ? "locked" : ""}`}>
        {renderSectionHeader("recommendations", "关联推荐", <LightbulbRegular />, recommendationItems.length)}
        {!collapsedSectionIds.includes("recommendations") ? <div className="library-section-content">
        <div className="library-section-heading">
          <button
            className="library-inline-button"
            disabled={!accountSessionAvailable || (recommendationItems.length === 0 && recommendationStatus !== "ready")}
            onClick={onClearRecommendations}
            title={recommendationMessage}
            type="button"
          >
            清理关联推荐
          </button>
        </div>
        {accountSessionAvailable && (recommendationPending || recommendationStatus === "error" || recommendationItems.length > 0) ? (
          <p className={`library-recommendation-message ${recommendationStatus}`}>
            {recommendationPending ? "正在获取推荐..." : recommendationMessage}
          </p>
        ) : null}
        {!accountSessionAvailable ? (
          <button
            className="library-inline-button"
            onClick={onLoginRequired}
            title={recommendationMessage}
            type="button"
          >
            登录后可用
          </button>
        ) : null}
        {accountSessionAvailable || recommendationPending || recommendationStatus === "error" ? null : null}
        {recommendationItems.length > 0 ? (
          <ul aria-label="关联推荐列表" className="recommendation-list">
            {recommendationItems.map((item) => (
              <li
                className={`recommendation-item ${item.relevanceBand}`}
                draggable
                key={item.id}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/liteasy-recommendation",
                    JSON.stringify(item)
                  );
                  event.dataTransfer.setData("application/liteasy-library-item", JSON.stringify(item));
                }}
              >
                <div className="recommendation-title">{item.title}</div>
                <div className="recommendation-source">{item.source}</div>
                <div className="recommendation-related">关联：{item.relatedDocumentTitle}</div>
                <div className={`recommendation-band ${item.relevanceBand}`}>
                  {getRelevanceLabel(item.relevanceBand)}
                </div>
                <div className="recommendation-reason">{item.reason}</div>
              </li>
            ))}
          </ul>
        ) : null}
        </div> : null}
      </section>

      {contextMenu ? (
        <div
          aria-label="文献资源操作"
          className="library-resource-context-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <div className="library-resource-context-heading">
            {contextMenu.target.kind === "paper"
              ? contextMenu.target.paper.title
              : contextMenu.target.folder.name}
          </div>
          {contextMenu.target.kind === "paper" ? (
            <>
              <button onClick={() => {
                onOpenPaper?.(contextMenu.target.kind === "paper" ? contextMenu.target.paper.id : "");
                setContextMenu(null);
              }} role="menuitem" type="button">
                打开 PDF
              </button>
              <button
                disabled={selectionLocked}
                onClick={() => {
                  if (contextMenu.target.kind === "paper") {
                    onToggleSelection(contextMenu.target.paper.id);
                  }
                  setContextMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                {selectedPaperIds.includes(contextMenu.target.paper.id) ? "移出选中文献集" : "加入选中文献集"}
              </button>
              <button onClick={() => {
                if (contextMenu.target.kind === "paper") {
                  togglePaper(contextMenu.target.paper.id);
                }
                setContextMenu(null);
              }} role="menuitem" type="button">
                {expandedPaperIds.includes(contextMenu.target.paper.id) ? "收起关联条目" : "展开关联条目"}
              </button>
              <div className="library-resource-context-separator" />
              <button
                disabled={!resourceEditingEnabled || !onRenamePaper}
                onClick={() => openOperationDialog("rename", contextMenu.target)}
                role="menuitem"
                type="button"
              >
                重命名…
              </button>
              <button
                disabled={!resourceEditingEnabled || !onMovePaper}
                onClick={() => openOperationDialog("move", contextMenu.target)}
                role="menuitem"
                type="button"
              >
                移动到目录…
              </button>
              <button
                onClick={() => void copyResourceText(
                  contextMenu.target.kind === "paper" ? contextMenu.target.paper.sourcePath ?? "" : "",
                  "文件路径"
                )}
                role="menuitem"
                type="button"
              >
                复制文件路径
              </button>
              <button
                onClick={() => void copyResourceText(
                  contextMenu.target.kind === "paper" ? contextMenu.target.paper.title : "",
                  "文献标题"
                )}
                role="menuitem"
                type="button"
              >
                复制文献标题
              </button>
            </>
          ) : (
            <>
              <button onClick={() => {
                if (contextMenu.target.kind === "folder") {
                  toggleFolder(contextMenu.target.folder.path);
                }
                setContextMenu(null);
              }} role="menuitem" type="button">
                {collapsedFolderPaths.includes(contextMenu.target.folder.path) ? "展开目录" : "收起目录"}
              </button>
              <div className="library-resource-context-separator" />
              <button
                disabled={
                  !resourceEditingEnabled ||
                  !onRenameFolder ||
                  contextMenu.target.folder.path === "未归档文献" ||
                  normalizeWorkspacePath(contextMenu.target.folder.path) === normalizedWorkspaceRoot
                }
                onClick={() => openOperationDialog("rename", contextMenu.target)}
                role="menuitem"
                type="button"
              >
                重命名目录…
              </button>
              <button
                disabled={
                  !resourceEditingEnabled ||
                  !onMoveFolder ||
                  contextMenu.target.folder.path === "未归档文献" ||
                  normalizeWorkspacePath(contextMenu.target.folder.path) === normalizedWorkspaceRoot
                }
                onClick={() => openOperationDialog("move", contextMenu.target)}
                role="menuitem"
                type="button"
              >
                移动目录…
              </button>
              <button
                onClick={() => void copyResourceText(
                  contextMenu.target.kind === "folder" ? contextMenu.target.folder.path : "",
                  "目录路径"
                )}
                role="menuitem"
                type="button"
              >
                复制目录路径
              </button>
            </>
          )}
        </div>
      ) : null}

      {operationDialog ? (
        <div className="library-resource-dialog-backdrop" role="presentation">
          <form
            aria-label={operationDialog.action === "rename" ? "重命名资源" : "移动资源"}
            aria-modal="true"
            className="library-resource-dialog"
            onSubmit={(event) => void submitResourceOperation(event)}
            role="dialog"
          >
            <strong>
              {operationDialog.action === "rename"
                ? `重命名${operationDialog.target.kind === "folder" ? "目录" : "文献"}`
                : `移动${operationDialog.target.kind === "folder" ? "目录" : "文献"}`}
            </strong>
            <label>
              {operationDialog.action === "rename" ? "新名称" : "目标目录"}
              <input
                autoFocus
                list={operationDialog.action === "move" ? "library-folder-path-options" : undefined}
                onChange={(event) => setOperationDialog({
                  ...operationDialog,
                  value: event.target.value
                })}
                value={operationDialog.value}
              />
            </label>
            {operationDialog.action === "move" ? (
              <datalist id="library-folder-path-options">
                {folderPaths.map((path) => <option key={path} value={path} />)}
              </datalist>
            ) : null}
            <small>
              当前：{operationDialog.target.kind === "paper"
                ? operationDialog.target.paper.sourcePath ?? operationDialog.target.paper.title
                : operationDialog.target.folder.path}
            </small>
            <div className="library-resource-dialog-actions">
              <button onClick={() => setOperationDialog(null)} type="button">取消</button>
              <button className="primary" type="submit">确认</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

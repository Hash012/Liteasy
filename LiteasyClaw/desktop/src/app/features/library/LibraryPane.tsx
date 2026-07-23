import { useState } from "react";
import type { CollectionItem } from "../collection/collection.types";
import "./library.css";
import { ImportButton } from "../import/ImportButton";
import type { ImportJob } from "../import/import.types";
import type { RecommendationItem, RecommendationStatus } from "../recommendations/recommendation.types";
import type { Paper, WorkspaceSourceType } from "../workspace/workspace.types";
import { parseLibraryDragPayload } from "./libraryDragPayload";
import {
  buildWorkspaceFolderTree,
  type WorkspaceFolderNode
} from "../workspace/workspaceFolderTree";

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
  onDismissRecommendation?: (recommendation: RecommendationItem) => void;
  onImportSelectedSet: () => void;
  onLoginRequired?: () => void;
  onOpenOrganizationWorkspace: () => void;
  onOpenPaper?: (paperId: string) => void;
  onOpenPaperChild?: (item: LibraryPaperChildItem, paper: Paper) => void;
  onRetryCollectionSync?: () => void;
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

type LibraryCollection = {
  children: LibraryCollection[];
  id: LibraryCollectionId;
  label: string;
};

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
  onDismissRecommendation,
  onImportSelectedSet,
  onLoginRequired,
  onOpenOrganizationWorkspace,
  onOpenPaper,
  onOpenPaperChild,
  onRetryCollectionSync,
  onReturnToLocalWorkspace,
  onToggleLock,
  onToggleSelection,
  workspaceLabel,
  workspaceSourceType
}: LibraryPaneProps) {
  const selectedCount = selectedPaperIds.length;
  const [activeCollectionId, setActiveCollectionId] = useState<LibraryCollectionId>("my-library");
  const activeCollection =
    findLibraryCollection(libraryCollections, activeCollectionId) ??
    libraryCollections[0];
  const visiblePapers = papers.filter((paper) => paperMatchesCollection(paper, activeCollection.id));
  const folderTree = buildWorkspaceFolderTree(visiblePapers);
  const [collapsedCollectionIds, setCollapsedCollectionIds] = useState<LibraryCollectionId[]>([]);
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<string[]>([]);
  const [expandedPaperIds, setExpandedPaperIds] = useState<string[]>([]);

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
        <div className="paper-row" style={{ paddingLeft: `${depth * 10}px` }}>
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}${paper.title}的关联条目`}
            className="library-disclosure"
            onClick={() => togglePaper(paper.id)}
            title={`${expanded ? "收起" : "展开"}相关产物和笔记`}
            type="button"
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
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
            title={`在 Reader 中打开：${paper.title}`}
            type="button"
          >
            <span aria-hidden="true" className="library-file-icon">PDF</span>
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
                    {item.kind === "artifact" ? "◇" : "✎"}
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
    const folderLabel = rootFolder ? `目录：${node.path}` : node.name;

    return (
      <li className="library-folder-node" key={node.path}>
        <div className="library-folder-row" style={{ paddingLeft: `${depth * 10}px` }}>
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}目录 ${node.path}`}
            className="library-disclosure"
            onClick={() => toggleFolder(node.path)}
            type="button"
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
          <button
            className="library-folder-name"
            onClick={() => toggleFolder(node.path)}
            title={node.path}
            type="button"
          >
            <span aria-hidden="true" className="library-folder-icon">▱</span>
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
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
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
            <span aria-hidden="true" className="library-folder-icon">▱</span>
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
        <ImportButton label="交给AI流程" onImport={onImportSelectedSet} />
        <button className="library-button ghost" type="button" onClick={onToggleLock}>
          {selectionLocked ? "解除锁定" : "锁定选择"}
        </button>
        <button className="library-button ghost" type="button">
          刷新本地文献库
        </button>
      </div>

      <div
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
        <div className="library-section-title">我的文献库</div>
        <div className="library-workspace-overview">
          <div>
            <div className="library-workspace-label">当前工作区：{workspaceLabel}</div>
            <div className="library-workspace-root">工作区母目录：{workspaceLabel}</div>
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
          当前选中文献集：{selectedCount} 篇{selectionLocked ? " · 已锁定" : " · 未锁定"}
        </div>
        <div aria-label="PDF 文件拖拽导入区" className="library-file-drop-target">
          拖入 PDF 添加到文献库
        </div>
        <div className="library-active-collection">当前 Collection：{activeCollection.label}</div>
        <div className="library-collection-browser">
          <nav aria-label="文献库 collections" className="library-collection-tree">
            <ul className="library-resource-tree">
              {libraryCollections.map((collection) => renderCollection(collection))}
            </ul>
          </nav>
        </div>
      </div>

      <div
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
        <div className="library-section-title">收藏</div>
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
            {collectionStatus === "ready" ? "把关联推荐拖到这里，收藏不会随着推荐刷新而消失。" : collectionMessage}
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
      </div>

      <div className={`library-section muted ${!accountSessionAvailable ? "locked" : ""}`}>
        <div className="library-section-heading">
          <div className="library-section-title">关联推荐</div>
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
                <button
                  className="library-inline-button"
                  onClick={() => onDismissRecommendation?.(item)}
                  type="button"
                >
                  不感兴趣
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

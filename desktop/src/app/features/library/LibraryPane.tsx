import type { CollectionItem } from "../collection/collection.types";
import "./library.css";
import { ImportButton } from "../import/ImportButton";
import type { ImportJob } from "../import/import.types";
import type { RecommendationItem, RecommendationStatus } from "../recommendations/recommendation.types";
import type { Paper } from "../workspace/workspace.types";
import { parseLibraryDragPayload } from "./libraryDragPayload";
import { groupWorkspacePapersByFolder } from "../workspace/workspaceFolderTree";

type LibraryPaneProps = {
  accountSessionAvailable?: boolean;
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  collectionItems: CollectionItem[];
  collectionMessage: string;
  collectionStatus: "idle" | "loading" | "ready" | "error";
  importJobs: Record<string, ImportJob>;
  recommendationItems: RecommendationItem[];
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  canReturnToLocalWorkspace: boolean;
  onAddExternalPaper: (item: CollectionItem | RecommendationItem) => void;
  onClearRecommendations: () => void;
  onCollectRecommendation: (recommendation: RecommendationItem) => void;
  onImportSelectedSet: () => void;
  onLoginRequired?: () => void;
  onRetryCollectionSync?: () => void;
  onReturnToLocalWorkspace: () => void;
  onToggleLock: () => void;
  onToggleSelection: (paperId: string) => void;
  workspaceLabel: string;
};

function getRelevanceLabel(band: RecommendationItem["relevanceBand"]) {
  if (band === "high") {
    return "高关联";
  }

  if (band === "medium") {
    return "中关联";
  }

  return "低关联";
}

export function LibraryPane({
  accountSessionAvailable = false,
  papers,
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
  canReturnToLocalWorkspace,
  onAddExternalPaper,
  onClearRecommendations,
  onCollectRecommendation,
  onImportSelectedSet,
  onLoginRequired,
  onRetryCollectionSync,
  onReturnToLocalWorkspace,
  onToggleLock,
  onToggleSelection,
  workspaceLabel
}: LibraryPaneProps) {
  const selectedCount = selectedPaperIds.length;
  const folderGroups = groupWorkspacePapersByFolder(papers);

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
        {canReturnToLocalWorkspace ? (
          <button className="library-button ghost" type="button" onClick={onReturnToLocalWorkspace}>
            返回本地文献库
          </button>
        ) : null}
      </div>

      <div
        aria-label="我的文献库投放区"
        className="library-section library-drop-zone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
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
        <div className="library-workspace-label">当前工作区：{workspaceLabel}</div>
        <div className="library-workspace-root">工作区母目录：{workspaceLabel}</div>
        <div className="library-selection-summary">
          当前选中文献集：{selectedCount} 篇{selectionLocked ? " · 已锁定" : " · 未锁定"}
        </div>
        <div className="library-folder-tree" aria-label="工作区目录树">
          {folderGroups.map((group) => (
            <section className="library-folder-group" key={group.folder}>
              <div className="library-folder-header">
                <span>目录：{group.folder}</span>
                <span>{group.papers.length} 篇文献</span>
              </div>
              <ul className="library-list">
                {group.papers.map((paper) => (
                  <li className="library-item" key={paper.id}>
                    <div className="paper-row">
                      <label>
                        <input
                          checked={selectedPaperIds.includes(paper.id)}
                          disabled={selectionLocked}
                          onChange={() => onToggleSelection(paper.id)}
                          type="checkbox"
                        />
                        <span>{paper.title}</span>
                      </label>
                      {importJobs[paper.id] ? (
                        <span className={`job-badge ${importJobs[paper.id].status}`}>
                          {importJobs[paper.id].status}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

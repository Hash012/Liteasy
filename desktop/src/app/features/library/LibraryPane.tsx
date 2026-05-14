import type { CollectionItem } from "../collection/collection.types";
import "./library.css";
import { ImportButton } from "../import/ImportButton";
import type { ImportJob } from "../import/import.types";
import type { RecommendationItem, RecommendationStatus } from "../recommendations/recommendation.types";
import type { Paper } from "../workspace/workspace.types";

type LibraryPaneProps = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  collectionItems: CollectionItem[];
  importJobs: Record<string, ImportJob>;
  recommendationItems: RecommendationItem[];
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  canReturnToLocalWorkspace: boolean;
  onAddExternalPaper: (item: CollectionItem | RecommendationItem) => void;
  onCollectRecommendation: (recommendation: RecommendationItem) => void;
  onImportSelectedSet: () => void;
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
  papers,
  selectedPaperIds,
  selectionLocked,
  collectionItems,
  importJobs,
  recommendationItems,
  recommendationMessage,
  recommendationPending,
  recommendationStatus,
  canReturnToLocalWorkspace,
  onAddExternalPaper,
  onCollectRecommendation,
  onImportSelectedSet,
  onReturnToLocalWorkspace,
  onToggleLock,
  onToggleSelection,
  workspaceLabel
}: LibraryPaneProps) {
  const selectedCount = selectedPaperIds.length;

  return (
    <div className="library-pane">
      <div className="library-toolbar">
        <ImportButton label="交给AI流程" onImport={onImportSelectedSet} />
        <button className="library-button ghost" type="button" onClick={onToggleLock}>
          {selectionLocked ? "解除锁定" : "锁定选择"}
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
          const rawPayload = event.dataTransfer.getData("application/liteasy-library-item");
          if (!rawPayload) {
            return;
          }

          try {
            const payload = JSON.parse(rawPayload) as CollectionItem | RecommendationItem;
            onAddExternalPaper(payload);
          } catch {
            // Ignore malformed drag payloads from non-Liteasy sources.
          }
        }}
      >
        <div className="library-section-title">我的文献库</div>
        <div className="library-workspace-label">当前工作区：{workspaceLabel}</div>
        <div className="library-selection-summary">
          当前选中文献集：{selectedCount} 篇{selectionLocked ? " · 已锁定" : " · 未锁定"}
        </div>
        <ul className="library-list">
          {papers.map((paper) => (
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
      </div>

      <div
        aria-label="收藏投放区"
        className={`library-section muted ${collectionItems.length > 0 ? "has-collection" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const rawPayload = event.dataTransfer.getData("application/liteasy-recommendation");
          if (!rawPayload) {
            return;
          }

          try {
            const payload = JSON.parse(rawPayload) as RecommendationItem;
            onCollectRecommendation(payload);
          } catch {
            // Ignore malformed drag payloads from non-Liteasy sources.
          }
        }}
      >
        <div className="library-section-title">收藏</div>
        {collectionItems.length === 0 ? (
          <p>把关联推荐拖到这里，收藏不会随着推荐刷新而消失。</p>
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

      <div className="library-section muted">
        <div className="library-section-title">关联推荐</div>
        <p className={`library-recommendation-message ${recommendationStatus}`}>
          {recommendationPending ? "正在获取推荐..." : recommendationMessage}
        </p>
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

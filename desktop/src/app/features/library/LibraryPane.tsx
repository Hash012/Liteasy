import "./library.css";
import { ImportButton } from "../import/ImportButton";
import type { createWorkspaceStore } from "../workspace/workspace.store";
import type { createImportStore } from "../import/import.store";

type LibraryPaneProps = {
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
  importStore: ReturnType<typeof createImportStore>;
  onImport: () => void;
  onToggleSelection: (id: string) => void;
  onLockSelection: () => void;
  onDeletePaper: (id: string) => void;
};

export function LibraryPane({
  workspaceStore,
  importStore,
  onImport,
  onToggleSelection,
  onLockSelection,
  onDeletePaper,
}: LibraryPaneProps) {
  const { papers, selectedPaperIds, selectionLocked } = workspaceStore.getState();

  return (
    <div className="library-pane">
      <div className="library-toolbar">
        <ImportButton onImport={onImport} />
        <button
          className="library-button ghost"
          onClick={onLockSelection}
          type="button"
        >
          {selectionLocked ? "取消锁定" : "锁定选择"}
        </button>
      </div>

      <div className="library-section">
        <div className="library-section-title">我的文献库</div>
        {papers.length === 0 ? (
          <p className="library-empty">点击"导入文献"添加你的第一篇论文。</p>
        ) : (
          <ul className="library-list">
            {papers.map((paper) => (
              <li className="library-item" key={paper.id}>
                <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <input
                    checked={selectedPaperIds.includes(paper.id)}
                    disabled={selectionLocked}
                    onChange={() => onToggleSelection(paper.id)}
                    type="checkbox"
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paper.title}</span>
                </label>
                <button
                  className="library-delete-btn"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`确定删除「${paper.title}」吗？此操作不可撤销。`)) onDeletePaper(paper.id); }}
                  title="删除文献"
                >✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="library-section muted">
        <div className="library-section-title">导入状态</div>
        {importJobsSummary(importStore)}
      </div>

      <div className="library-section muted">
        <div className="library-section-title">联网收藏</div>
        <p>当前还没有收藏内容。</p>
      </div>

      <div className="library-section muted">
        <div className="library-section-title">关联推荐</div>
        <p>后续会在这里展示相关文献推荐。</p>
      </div>
    </div>
  );
}

function importJobsSummary(importStore: ReturnType<typeof createImportStore>) {
  const all = importStore.getAllJobs().filter(j => j.status !== "parsed");
  if (all.length === 0) return <p>暂无进行中的导入任务。</p>;
  return (
    <ul className="library-list">
      {all.map((job) => (
        <li className="library-item" key={job.id}>
          <span className={`import-status import-status--${job.status}`}>
            [{job.status}] {job.sourcePath}
          </span>
        </li>
      ))}
    </ul>
  );
}

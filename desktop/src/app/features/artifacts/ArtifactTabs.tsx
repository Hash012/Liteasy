import type { ArtifactTab, ArtifactTask, ArtifactType } from "./artifact.types";

type ArtifactTabsProps = {
  analysisHint: string;
  canStartAnalysis: boolean;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  selectedCount: number;
  selectionLocked: boolean;
  tasks: ArtifactTask[];
  tabs: ArtifactTab[];
};

const artifactModes: Array<{ type: ArtifactType; label: string }> = [
  { type: "tree", label: "树形展开" },
  { type: "mindmap", label: "思维导图" },
  { type: "ppt", label: "PPT" }
];

function getFallbackPreview(type: ArtifactType) {
  if (type === "mindmap") {
    return {
      nodes: ["核心概念", "模型结构", "应用场景"],
      rootLabel: "Transformer Paper"
    };
  }

  if (type === "tree") {
    return {
      nodes: ["方法动机", "模型组成", "实验结论"],
      rootLabel: "总体结构"
    };
  }

  return {
    nodes: ["研究背景", "核心方法", "结果与局限"],
    rootLabel: "PPT 大纲"
  };
}

export function ArtifactTabs({
  analysisHint,
  canStartAnalysis,
  onStartAnalysis,
  selectedCount,
  selectionLocked,
  tasks,
  tabs
}: ArtifactTabsProps) {
  const activePreview = tabs[0] ? (tabs[0].preview ?? getFallbackPreview(tabs[0].type)) : null;

  return (
    <div className="artifact-layout">
      <div className="artifact-toolbar">
        <span className="artifact-title">多模态产物</span>
        {tasks.length > 0 && (
          <span className="artifact-status-badge">{tasks[0].status}</span>
        )}
      </div>

      <div className="artifact-mode-panel">
        <div className="artifact-mode-summary">
          选中文献集：{selectedCount} 篇{selectionLocked ? " · 已锁定" : " · 未锁定"}
        </div>
        <div className="artifact-mode-grid">
          {artifactModes.map((mode) => (
            <button
              className="artifact-mode-button"
              disabled={!canStartAnalysis}
              key={mode.type}
              onClick={() => onStartAnalysis(mode.type)}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="artifact-analysis-hint">{analysisHint}</div>
      </div>

      {tabs.length === 0 ? (
        <div className="artifact-empty">
          先在左栏勾选并锁定文献形成选中文献集，再在这里选择模态按钮启动主分析流程。
        </div>
      ) : (
        <div className="artifact-card">
          <div className="artifact-card-title">{tabs[0].title}</div>
          <div className="artifact-card-body">
            {activePreview ? (
              <>
                <div className="mindmap-node root">{activePreview.rootLabel}</div>
                <div className="mindmap-children">
                  {activePreview.nodes.map((node) => (
                    <div className="mindmap-node" key={node}>
                      {node}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

import type { ArtifactTab, ArtifactTask, ArtifactType } from "./artifact.types";
import { DynamicCanvas } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";

type ArtifactTabsProps = {
  analysisHint: string;
  canStartAnalysis: boolean;
  onDynamicAction?: (action: UIDslActionRef) => void;
  onSaveMarkdownTab?: (artifactId: string) => void;
  onUpdateMarkdownTab?: (artifactId: string, markdown: string) => void;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  selectedCount: number;
  selectionLocked: boolean;
  tasks: ArtifactTask[];
  tabs: ArtifactTab[];
};

function getFallbackPreview(type: ArtifactType) {
  if (type === "mindmap") {
    return {
      nodes: ["核心概念", "系统结构", "应用场景"],
      rootLabel: "Literature Paper"
    };
  }

  if (type === "tree") {
    return {
      nodes: ["方法动机", "模型组成", "实验结论"],
      rootLabel: "总体结构"
    };
  }

  if (type === "comparison_table") {
    return {
      nodes: ["研究对象", "方法差异", "实验指标"],
      rootLabel: "论文对比表"
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
  onDynamicAction,
  onSaveMarkdownTab,
  onUpdateMarkdownTab,
  onStartAnalysis,
  selectedCount,
  selectionLocked,
  tasks,
  tabs
}: ArtifactTabsProps) {
  const activePreview = tabs[0] ? (tabs[0].preview ?? getFallbackPreview(tabs[0].type)) : null;
  const activeTab = tabs[0] ?? null;

  return (
    <div className="artifact-layout">
      <div className="artifact-toolbar">
        <span className="artifact-title">多模态产物</span>
        {tasks.length > 0 && (
          <span className="artifact-status-badge">{tasks[0].status}</span>
        )}
      </div>

      {tabs.length === 0 ? (
        <div
          className="artifact-empty"
          title={
            canStartAnalysis
              ? "使用中间栏悬浮模态按钮生成新的多模态产物。"
              : analysisHint
          }
        >
          选中文献集：{selectedCount} 篇{selectionLocked ? " · 已锁定" : " · 未锁定"}
        </div>
      ) : activeTab?.type === "skill_doc" ? (
        <div className="artifact-card skill-doc-card">
          <div className="skill-doc-header">
            <div>
              <div className="artifact-card-title">{activeTab.title}</div>
              {activeTab.sourcePath ? (
                <div className="skill-doc-path">{activeTab.sourcePath}</div>
              ) : null}
            </div>
            <button
              className="skill-doc-save-button"
              onClick={() => onSaveMarkdownTab?.(activeTab.artifactId)}
              type="button"
            >
              保存文档
            </button>
          </div>
          <textarea
            aria-label={`编辑 Skill 文档：${activeTab.title}`}
            className="skill-doc-editor"
            onChange={(event) => onUpdateMarkdownTab?.(activeTab.artifactId, event.target.value)}
            value={activeTab.markdown ?? ""}
          />
        </div>
      ) : (
        <div className="artifact-card">
          <div className="artifact-card-title">{tabs[0].title}</div>
          <div className="artifact-card-body">
            {tabs[0].uiDsl ? (
              <DynamicCanvas document={tabs[0].uiDsl} onAction={(action) => onDynamicAction?.(action)} />
            ) : activePreview ? (
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

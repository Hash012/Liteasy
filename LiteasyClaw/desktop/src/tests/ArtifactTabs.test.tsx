import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ArtifactTabs } from "../app/features/artifacts/ArtifactTabs";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";

describe("ArtifactTabs", () => {
  test("shows real Agent phase progress separately from PDF readiness", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[]}
        tasks={[
          {
            id: "artifact-task-1",
            message: "正在调用模型生成分析结构",
            partialAnswer: "ColBERT 使用 late interaction。",
            progress: 55,
            stage: "generating_answer",
            status: "running",
            type: "tree"
          }
        ]}
      />
    );

    expect(screen.getByRole("progressbar", { name: "Agent 分析进度" })).toHaveAttribute(
      "aria-valuenow",
      "55"
    );
    expect(screen.getByText("正在调用模型生成分析结构")).toBeInTheDocument();
    expect(screen.getByText("ColBERT 使用 late interaction。")).toBeInTheDocument();
    expect(screen.getByText(/PDF 解析完成只表示证据可检索/)).toBeInTheDocument();
  });

  test("renders center artifact ui dsl when a tab provides one", () => {
    const tab: ArtifactTab = {
      artifactId: "artifact-comparison",
      title: "论文对比表",
      type: "comparison_table",
      uiDsl: {
        actions: [],
        audit: {
          createdAt: "2026-07-05T00:00:00.000Z",
          generatedBy: "rule",
          traceId: "trace-artifact"
        },
        dataSources: [],
        id: "ui-artifact",
        intentPlanId: "plan-artifact",
        root: {
          component: "ComparisonTable",
          id: "comparison",
          props: {
            rows: [
              {
                evidence: "demo-1 p.2",
                focus: "Late interaction",
                paper: "ColBERT"
              }
            ],
            title: "方法对比"
          }
        },
        surface: "center_artifact",
        version: "liteasy-ui-dsl/v1"
      }
    };

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={2}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(screen.getByText("方法对比")).toBeInTheDocument();
    expect(screen.getByText("ColBERT")).toBeInTheDocument();
    expect(screen.getByText("Late interaction")).toBeInTheDocument();
    expect(screen.getByText("demo-1 p.2")).toBeInTheDocument();
  });

  test("renders typed center artifact components from ui dsl", () => {
    const tab: ArtifactTab = {
      artifactId: "artifact-mixed",
      title: "中心产物",
      type: "comparison_table",
      uiDsl: {
        actions: [],
        audit: {
          createdAt: "2026-07-05T00:00:00.000Z",
          generatedBy: "rule",
          traceId: "trace-artifact"
        },
        dataSources: [],
        id: "ui-artifact",
        intentPlanId: "plan-artifact",
        root: {
          children: [
            {
              component: "EvidenceMatrix",
              id: "evidence-matrix",
              props: {
                rows: [
                  {
                    evidence: "demo-1 p.2",
                    paper: "ColBERT",
                    snippet: "Late interaction preserves token-level evidence"
                  }
                ],
                title: "证据矩阵"
              }
            },
            {
              component: "MindMap",
              id: "mindmap",
              props: {
                nodes: [{ id: "late-interaction", label: "Late interaction", parentId: "root" }],
                title: "思维导图"
              }
            },
            {
              component: "TreeOutline",
              id: "tree",
              props: {
                nodes: [{ id: "colbert", label: "ColBERT", level: 1 }],
                title: "树形展开"
              }
            },
            {
              component: "SlideDeck",
              id: "slides",
              props: {
                slides: [{ bullets: ["Late interaction", "MaxSim"], title: "ColBERT" }],
                title: "PPT"
              }
            }
          ],
          component: "Stack",
          id: "root",
          props: {
            direction: "vertical",
            gap: "md"
          }
        },
        surface: "center_artifact",
        version: "liteasy-ui-dsl/v1"
      }
    };

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={2}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(screen.getByText("证据矩阵")).toBeInTheDocument();
    expect(screen.getByText("Late interaction preserves token-level evidence")).toBeInTheDocument();
    expect(screen.getByText("思维导图")).toBeInTheDocument();
    expect(screen.getByText("树形展开")).toBeInTheDocument();
    expect(screen.getByText("PPT")).toBeInTheDocument();
    expect(screen.getAllByText("ColBERT").length).toBeGreaterThan(1);
  });

  test("routes center artifact action refs through the provided handler", async () => {
    const onDynamicAction = vi.fn();
    const tab: ArtifactTab = {
      artifactId: "artifact-comparison",
      title: "论文对比表",
      type: "comparison_table",
      uiDsl: {
        actions: [
          {
            actionId: "artifact.open_tab",
            id: "open-artifact",
            input: {
              artifactId: "artifact-comparison",
              artifactType: "comparison_table"
            },
            label: "打开产物",
            riskLevel: "low"
          }
        ],
        audit: {
          createdAt: "2026-07-05T00:00:00.000Z",
          generatedBy: "rule",
          traceId: "trace-artifact"
        },
        dataSources: [],
        id: "ui-artifact",
        intentPlanId: "plan-artifact",
        root: {
          children: [
            {
              component: "ComparisonTable",
              id: "comparison",
              props: {
                rows: [],
                title: "方法对比"
              }
            },
            {
              component: "ActionBar",
              id: "actions",
              props: {
                actionIds: ["open-artifact"]
              }
            }
          ],
          component: "Stack",
          id: "root",
          props: {
            direction: "vertical",
            gap: "md"
          }
        },
        surface: "center_artifact",
        version: "liteasy-ui-dsl/v1"
      }
    };

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onDynamicAction={onDynamicAction}
        onStartAnalysis={vi.fn()}
        selectedCount={2}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    await screen.getByRole("button", { name: "打开产物" }).click();

    expect(onDynamicAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "artifact.open_tab",
        id: "open-artifact"
      })
    );
  });

  test("renders and activates the requested persisted artifact instead of always using the newest tab", () => {
    const onActivateArtifact = vi.fn();
    const tabs: ArtifactTab[] = [
      {
        artifactId: "artifact-new",
        createdAt: "2026-07-20T04:00:00.000Z",
        papers: [{ id: "demo-1", title: "ColBERT" }],
        preview: { nodes: ["MaxSim"], rootLabel: "New artifact" },
        title: "最新产物",
        type: "tree"
      },
      {
        artifactId: "artifact-acorn",
        createdAt: "2026-07-19T04:00:00.000Z",
        papers: [{ id: "demo-2", title: "ACORN" }],
        preview: { nodes: ["Predicate subgraph"], rootLabel: "ACORN artifact" },
        title: "ACORN 历史产物",
        type: "mindmap"
      }
    ];

    render(
      <ArtifactTabs
        activeArtifactId="artifact-acorn"
        analysisHint=""
        canStartAnalysis
        onActivateArtifact={onActivateArtifact}
        onStartAnalysis={vi.fn()}
        selectedCount={2}
        selectionLocked
        tabs={tabs}
        tasks={[]}
      />
    );

    expect(screen.getByText("ACORN artifact")).toBeInTheDocument();
    expect(screen.getByText("Predicate subgraph")).toBeInTheDocument();
    expect(screen.getByText("ACORN")).toBeInTheDocument();
    expect(screen.queryByText("New artifact")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ACORN 历史产物/ })).toHaveAttribute(
      "aria-current",
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: /最新产物/ }));
    expect(onActivateArtifact).toHaveBeenCalledWith("artifact-new");
  });

  test("collects supplemental references and requests regeneration for the original papers", async () => {
    const onRegenerateArtifact = vi.fn(async () => undefined);
    const tab: ArtifactTab = {
      artifactId: "artifact-colbert-acorn",
      papers: [
        { id: "demo-1", title: "ColBERT" },
        { id: "demo-2", title: "ACORN" }
      ],
      preview: { nodes: ["Methods"], rootLabel: "Comparison" },
      title: "两篇论文对比",
      type: "tree"
    };

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onRegenerateArtifact={onRegenerateArtifact}
        onStartAnalysis={vi.fn()}
        selectedCount={2}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(screen.getByText("基于 2 篇论文")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补充资料并重新生成" }));
    expect(screen.getByRole("dialog", { name: "补充资料并重新生成产物" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("补充文本、引用或分析要求"), {
      target: { value: "ACORN §4 的过滤实验，以及 ColBERT Table 2。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "另存并重新生成" }));

    await waitFor(() => {
      expect(onRegenerateArtifact).toHaveBeenCalledWith({
        artifactId: "artifact-colbert-acorn",
        artifactType: "tree",
        papers: tab.papers,
        supplementalContext: "ACORN §4 的过滤实验，以及 ColBERT Table 2。"
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

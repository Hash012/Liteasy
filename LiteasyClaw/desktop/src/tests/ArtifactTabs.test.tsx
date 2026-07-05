import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ArtifactTabs } from "../app/features/artifacts/ArtifactTabs";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";

describe("ArtifactTabs", () => {
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
    expect(screen.getAllByText("思维导图").length).toBeGreaterThan(1);
    expect(screen.getAllByText("树形展开").length).toBeGreaterThan(1);
    expect(screen.getAllByText("PPT").length).toBeGreaterThan(1);
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
});

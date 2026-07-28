import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ArtifactTabs } from "../app/features/artifacts/ArtifactTabs";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";

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
    expect(screen.queryByText(/PDF 解析完成只表示证据可检索/)).not.toBeInTheDocument();
  });

  test("shows provider, model, endpoint and recovery guidance after generation fails", () => {
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
            failure: {
              endpoint: "http://127.0.0.1:8787",
              failedStage: "generating_answer",
              message: "OpenAI Responses API 流式请求失败（404）",
              model: "gpt-5.5",
              occurredAt: "2026-07-21T03:00:00.000Z",
              provider: "openai",
              recovery: ["确认上游地址支持 /responses 路由。"]
            },
            id: "artifact-task-2",
            message: "Agent 分析失败：OpenAI Responses API 流式请求失败（404）",
            progress: 55,
            stage: "failed",
            status: "failed",
            type: "tree"
          }
        ]}
      />
    );

    expect(screen.getByText("查看失败详情与恢复建议")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8787")).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
    expect(screen.getByText("确认上游地址支持 /responses 路由。")).toBeInTheDocument();
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

  test("renders thin-reading tabs as a full-page surface without generic artifact card chrome", () => {
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          paperEvidence: ["evidence-1"],
          paperEvidenceSpans: [
            {
              confidence: 0.9,
              id: "evidence-1",
              page: 2,
              paperId: "paper-1",
              quote: "ColBERT uses MaxSim."
            }
          ]
        },
        omittedSections: [
          { id: "section-experiment", label: "实验", sectionKey: "experiment" }
        ],
        recommendations: [],
        summary: "ColBERT 的核心是用 MaxSim 保留 token-level matching signals。",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const onOpenEvidence = vi.fn();
    const onUpdateThinReadingDocument = vi.fn();
    const { container } = render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onOpenEvidence={onOpenEvidence}
        onStartAnalysis={vi.fn()}
        onUpdateThinReadingDocument={onUpdateThinReadingDocument}
        selectedCount={1}
        selectionLocked
        tabs={[{
          artifactId: "artifact-thin",
          papers: [{ id: "paper-1", title: "ColBERT" }],
          thinReadingDocument,
          title: "薄读",
          type: "thin_reading"
        }]}
        tasks={[]}
      />
    );

    expect(screen.getByLabelText("薄读页面")).toBeInTheDocument();
    expect(screen.getByText("Intuecho")).toBeInTheDocument();
    expect(container.querySelector(".artifact-card")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开论文内证据 evidence-1 第 2 页" }));
    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId: "evidence-1",
      page: 2,
      paperId: "paper-1",
      quote: "ColBERT uses MaxSim."
    });
  });

  test("renders mindmap verification and source layer metadata", () => {
    const tab: ArtifactTab = {
      artifactId: "artifact-mindmap",
      mindmapArtifact: {
        artifactId: "artifact-mindmap",
        createdAt: "2026-07-26T00:00:00.000Z",
        root: {
          children: [],
          confidence: "high",
          id: "root",
          label: "ColBERT 思维导图",
          nodeType: "topic",
          sourceRefs: []
        },
        runId: "run-1",
        sources: {
          externalReferences: [
            {
              authorityLevel: "high",
              reason: "concept_definition",
              refId: "external:late-interaction",
              sourceTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
              summary: "Late interaction preserves token-level matching signals before aggregation."
            }
          ],
          inferences: [],
          selectedPapers: [
            {
              evidenceId: "evidence-1",
              paperId: "paper-1",
              paperTitle: "ColBERT",
              refId: "paper:evidence-1",
              snippet: "ColBERT uses MaxSim to aggregate token-level similarities."
            }
          ]
        },
        title: "ColBERT 思维导图",
        verification: {
          checkedAt: "2026-07-26T00:00:00.000Z",
          errors: [],
          repairable: false,
          status: "pass",
          warnings: []
        },
        version: "liteasy.mindmap-artifact/v1"
      },
      title: "ColBERT 思维导图",
      type: "mindmap",
      verification: {
        checkedAt: "2026-07-26T00:00:00.000Z",
        errors: [],
        repairable: false,
        status: "pass",
        warnings: []
      }
    };

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(screen.getByText("审计通过")).toBeInTheDocument();
    expect(screen.getByText("论文证据：1")).toBeInTheDocument();
    expect(screen.getByText("外部补充：1")).toBeInTheDocument();
    expect(screen.getByText("模型推断：0")).toBeInTheDocument();
    expect(screen.getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
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

  test("switches an evidence-backed mind map to the layered graph projection", () => {
    const tab: ArtifactTab = {
      artifactId: "artifact-graph",
      title: "论文图",
      type: "mindmap",
      intuitionGraph: {
        version: "liteasy-intuition-graph/v1",
        id: "graph-artifact",
        workId: "local:paper-1",
        rootNodeId: "Thesis",
        revision: 1,
        nodes: [
          {
            id: "Thesis", status: "complete", kind: "thesis", baseLevel: 0, label: "核心结论", summary: "有证据支撑的结论。",
            evidenceIds: ["evidence-1"], source: { type: "paper", analysisRunId: "analysis-1" }, expandable: true, tags: []
          },
          {
            id: "Mechanism", status: "complete", kind: "mechanism", baseLevel: 1, label: "关键机制", summary: "解释结论的机制。",
            evidenceIds: ["evidence-2"], source: { type: "paper", analysisRunId: "analysis-1" }, expandable: false, tags: []
          }
        ],
        edges: [{ id: "thesis-mechanism", sourceNodeId: "Thesis", targetNodeId: "Mechanism", kind: "expands", evidenceIds: ["evidence-2"] }],
        provenance: { createdAt: "2026-07-25T00:00:00.000Z", generatedBy: "rule", analysisRunId: "analysis-1" }
      }
    };
    render(<ArtifactTabs analysisHint="" canStartAnalysis onStartAnalysis={vi.fn()} selectedCount={1} selectionLocked tabs={[tab]} tasks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "星图阅读" }));
    expect(screen.getByLabelText("论文认知图")).toBeInTheDocument();
    expect(screen.getAllByText("核心结论").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "L0" })).toBeInTheDocument();
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

  test("shows friendly PDF evidence entries and keeps internal evidence ids out of visible output", () => {
    const onOpenEvidence = vi.fn();
    const evidenceId = "evidence-2-5ae8057b-952e-4ed6-a863-695e935e8c33";
    const tab: ArtifactTab = {
      analysis: {
        evidence: [
          {
            analysisRunId: "analysis-1",
            chunkId: "chunk-colbert-p4",
            id: evidenceId,
            page: 4,
            paperId: "demo-1",
            paperTitle: "ColBERT",
            quote: "MaxSim matches every query token against document tokens.",
            relevance: 0.96,
            retrievalReason: "Matches the requested method detail.",
            summary: "MaxSim 保留 token 级细粒度匹配。",
            terms: ["MaxSim"]
          }
        ]
      } as ArtifactTab["analysis"],
      answer: `MaxSim 的结论来自 [${evidenceId}]。`,
      artifactId: "artifact-evidence",
      outlineMarkdown: `- MaxSim <!-- evidence: ${evidenceId} -->`,
      title: "ColBERT 树形分析",
      type: "tree",
      uiDsl: {
        actions: [],
        audit: {
          createdAt: "2026-07-20T00:00:00.000Z",
          generatedBy: "agent",
          traceId: "trace-evidence"
        },
        dataSources: [],
        id: "ui-evidence",
        intentPlanId: "plan-evidence",
        root: {
          component: "TreeOutline",
          id: "tree-evidence",
          props: {
            nodes: [
              {
                evidenceIds: [evidenceId],
                id: "maxsim",
                kind: "term",
                label: `MaxSim [${evidenceId}]`
              }
            ],
            title: "树形展开"
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
        onOpenEvidence={onOpenEvidence}
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(screen.getByText("论文原文证据（1 条） · 点击跳转 PDF")).toBeInTheDocument();
    expect(screen.getByText("MaxSim matches every query token against document tokens.")).toBeInTheDocument();
    expect(screen.getByText("摘要：MaxSim 保留 token 级细粒度匹配。")).toBeInTheDocument();
    expect(screen.getByText("MaxSim")).toBeInTheDocument();
    expect(screen.getByText("1 条证据")).toBeInTheDocument();
    expect(screen.queryByText(/evidence-2-5ae8057b/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "打开原文证据 1：ColBERT 第 4 页" })
    );
    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId,
      page: 4,
      paperId: "demo-1",
      quote: "MaxSim matches every query token against document tokens."
    });
  });

  test("requires confirmation before deleting a persisted artifact", async () => {
    const onDeleteArtifact = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const tab: ArtifactTab = {
      artifactId: "artifact-delete",
      title: "待删除树形产物",
      type: "tree"
    };
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onDeleteArtifact={onDeleteArtifact}
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "删除产物：待删除树形产物" });
    fireEvent.click(deleteButton);
    expect(onDeleteArtifact).not.toHaveBeenCalled();
    fireEvent.click(deleteButton);
    await waitFor(() => expect(onDeleteArtifact).toHaveBeenCalledWith("artifact-delete"));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});

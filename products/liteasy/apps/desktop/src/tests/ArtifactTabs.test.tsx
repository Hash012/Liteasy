import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ArtifactTabs } from "../app/features/artifacts/ArtifactTabs";
import type { ArtifactTab } from "../app/features/artifacts/artifact.types";
import type { ArtifactExportOutcome } from "../app/features/artifacts/artifactExport.types";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { propsWithVisualAndFigure, unauthorizedProps } from "./fixtures/thinReadingVisualProps";

describe("ArtifactTabs", () => {
  test("keeps the authorized multimodal switch on and forwards toggles", () => {
    const onToggle = vi.fn();
    const tab: ArtifactTab = {
      artifactId: propsWithVisualAndFigure.artifactId,
      papers: propsWithVisualAndFigure.papers,
      thinReadingDocument: propsWithVisualAndFigure.document,
      title: "薄读视觉 fixture",
      type: "thin_reading"
    };
    render(
      <ArtifactTabs
        activeArtifactId={tab.artifactId}
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        onToggleThinReadingVisualization={onToggle}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
        thinReadingVisualizationCapability={propsWithVisualAndFigure.visualizationCapability}
        thinReadingVisualizationReadyArtifacts={propsWithVisualAndFigure.visualizationStatus?.status === "ready"
          ? propsWithVisualAndFigure.visualizationStatus.artifacts
          : []}
        thinReadingVisualizationStatuses={{ [tab.thinReadingDocument!.activeNodeId]: propsWithVisualAndFigure.visualizationStatus! }}
      />
    );

    const toggle = screen.getByRole("switch", { name: "多模态" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  test("keeps the unauthorized multimodal switch disabled", () => {
    const tab: ArtifactTab = {
      artifactId: unauthorizedProps.artifactId,
      papers: unauthorizedProps.papers,
      thinReadingDocument: unauthorizedProps.document,
      title: "薄读视觉 fixture",
      type: "thin_reading"
    };
    render(
      <ArtifactTabs
        activeArtifactId={tab.artifactId}
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
        thinReadingVisualizationCapability={unauthorizedProps.visualizationCapability}
        thinReadingVisualizationStatuses={{ [tab.thinReadingDocument!.activeNodeId]: unauthorizedProps.visualizationStatus! }}
      />
    );
    expect(screen.getByRole("switch", { name: "多模态" })).toBeDisabled();
  });

  function renderExportMenu(onExportArtifact: () => Promise<ArtifactExportOutcome>) {
    const tab: ArtifactTab = {
      artifactId: "artifact-export",
      title: "导出测试",
      type: "mindmap"
    };
    const view = render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onExportArtifact={onExportArtifact}
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "导出为文档" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Markdown (.md)" }));
    return view;
  }

  test("leaves the export message empty when native Save As is cancelled", async () => {
    const onExportArtifact = vi.fn(async () => ({ status: "cancelled" as const }));

    const { container } = renderExportMenu(onExportArtifact);

    await waitFor(() => expect(onExportArtifact).toHaveBeenCalled());
    expect(container.querySelector(".artifact-export-message")).toHaveTextContent("");
  });

  test("reports the native path after a desktop export", async () => {
    const onExportArtifact = vi.fn(async () => ({
      record: {
        artifactId: "artifact-export",
        exportedAt: "2026-08-09T03:00:00.000Z",
        fileName: "导出测试.md",
        format: "markdown" as const,
        id: "export-1",
        location: "desktop" as const,
        path: "/home/user/Documents/导出测试.md",
        status: "available" as const,
        title: "导出测试"
      },
      status: "saved" as const
    }));

    renderExportMenu(onExportArtifact);

    expect(await screen.findByText("已导出到 /home/user/Documents/导出测试.md"))
      .toBeInTheDocument();
  });

  test("reports browser-managed downloads without inventing a path", async () => {
    const onExportArtifact = vi.fn(async () => ({
      record: {
        artifactId: "artifact-export",
        exportedAt: "2026-08-09T03:00:00.000Z",
        fileName: "导出测试.md",
        format: "markdown" as const,
        id: "export-browser",
        location: "browser" as const,
        status: "browser_managed" as const,
        title: "导出测试"
      },
      status: "saved" as const
    }));

    renderExportMenu(onExportArtifact);

    expect(await screen.findByText("文档已导出，由浏览器下载设置管理。"))
      .toBeInTheDocument();
  });

  test("shows the provided export error", async () => {
    const onExportArtifact = vi.fn(async (): Promise<ArtifactExportOutcome> => {
      throw new Error("文件已保存，但未写入导出历史：/tmp/导出测试.md");
    });

    renderExportMenu(onExportArtifact);

    expect(await screen.findByText("文件已保存，但未写入导出历史：/tmp/导出测试.md"))
      .toBeInTheDocument();
  });

  test("renders the persisted ACORN thin-reading preview without taking down the workspace", async () => {
    const result = JSON.parse(readFileSync(
      resolve(process.cwd(), "../../../../development/test-data/agent-results/preview-acorn-thin-reading-20260730.json"),
      "utf8"
    ));
    const tab: ArtifactTab = {
      artifactId: result.artifactId,
      answer: result.answer,
      createdAt: result.createdAt,
      papers: result.papers,
      thinReadingDocument: result.thinReadingDocument,
      title: result.title,
      type: "thin_reading"
    };

    render(
      <ArtifactTabs
        activeArtifactId={tab.artifactId}
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[tab]}
        tasks={[]}
      />
    );

    expect(await screen.findByRole("main", { name: "薄读页面" })).toBeInTheDocument();
    expect(screen.getAllByText("ACORN：谓词无关的混合向量检索薄读")).toHaveLength(2);
  });

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

  test("lets users collapse and reopen the live artifact generation content", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[]}
        tasks={[{
          id: "artifact-task-live-output",
          message: "正在接收 Agent 输出",
          partialAnswer: "第一段实时内容",
          progress: 68,
          stage: "generating_answer",
          status: "running",
          type: "tree"
        }]}
      />
    );

    expect(screen.getByText("当前阶段：流式生成")).toBeInTheDocument();
    expect(screen.getByLabelText("实时生成内容")).toHaveTextContent("第一段实时内容");

    fireEvent.click(screen.getByRole("button", { name: "收起实时生成内容" }));
    expect(screen.queryByLabelText("实时生成内容")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看实时生成内容" }));
    expect(screen.getByLabelText("实时生成内容")).toHaveTextContent("第一段实时内容");
  });

  test("shows safe recovery guidance without internal model diagnostics", () => {
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
              recovery: ["请联系管理员并提供失败时间。"]
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

    expect(screen.getByText("查看错误信息与恢复建议")).toBeInTheDocument();
    expect(screen.getByText("model_route_unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("模型服务暂不支持该请求，请稍后重试。")).toHaveLength(2);
    expect(screen.queryByText("OpenAI Responses API 流式请求失败（404）")).not.toBeInTheDocument();
    expect(screen.queryByText("http://127.0.0.1:8787")).not.toBeInTheDocument();
    expect(screen.queryByText("openai")).not.toBeInTheDocument();
    expect(screen.queryByText("gpt-5.5")).not.toBeInTheDocument();
    expect(screen.getByText("请联系管理员并提供失败时间。")).toBeInTheDocument();
  });

  test("shows internal artifact diagnostics only when server-authorized", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        developerDiagnostics
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[]}
        tasks={[{
          failure: {
            endpoint: "http://127.0.0.1:8787",
            failedStage: "generating_answer",
            message: "OpenAI Responses API 流式请求失败（404）",
            model: "gpt-5.5",
            occurredAt: "2026-07-21T03:00:00.000Z",
            provider: "openai",
            recovery: ["请联系管理员并提供失败时间。"]
          },
          id: "artifact-task-diagnostics",
          message: "Agent 分析失败",
          progress: 55,
          stage: "failed",
          status: "failed",
          type: "tree"
        }]}
      />
    );

    expect(screen.getByText("OpenAI Responses API 流式请求失败（404）")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8787")).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "导出为文档" }));
    expect(screen.getByRole("menuitem", { name: "Markdown (.md)" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "HTML (.html)" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "PDF (.pdf)" })).toBeInTheDocument();
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
              pageTextEnd: 37,
              pageTextStart: 18,
              paperId: "paper-1",
              quote: "ColBERT uses MaxSim."
            }
          ],
          summarySentences: [{
            evidenceIds: ["evidence-1"],
            externalKnowledge: [],
            id: "sentence-evidence-1",
            status: "grounded",
            text: "ColBERT 的核心是用 MaxSim 保留 token-level matching signals。"
          }]
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
    expect(screen.getByRole("heading", { name: "论坛" })).toBeInTheDocument();
    expect(screen.getByText("连接 Intuecho 社区后显示共享批注推荐")).toBeInTheDocument();
    expect(container.querySelector(".artifact-card")).toBeNull();
    expect(screen.getByRole("button", { name: "导出为文档" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开证据句/ }));
    expect(onOpenEvidence).toHaveBeenCalledWith({
      evidenceId: "evidence-1",
      page: 2,
      pageTextEnd: 37,
      pageTextStart: 18,
      paperId: "paper-1",
      quote: "ColBERT uses MaxSim."
    });
  });

  test("offers document export for read-only built-in Skill documents", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[{
          artifactId: "skill-document",
          markdown: "# Skill 文档",
          title: "论文解读 Skill",
          type: "skill_doc"
        }]}
        tasks={[]}
      />
    );

    expect(screen.getByRole("button", { name: "导出为文档" })).toBeInTheDocument();
    expect(screen.getByLabelText("Skill 文档内容：论文解读 Skill")).toHaveTextContent("# Skill 文档");
    expect(screen.queryByRole("button", { name: "保存文档" })).not.toBeInTheDocument();
  });

  test("hides thin-reading phase details and live prose from regular accounts", () => {
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-progress",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "ColBERT uses late interaction for retrieval.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[{
          artifactId: "artifact-thin-progress",
          papers: [{ id: "paper-1", title: "ColBERT" }],
          thinReadingDocument,
          title: "薄读",
          type: "thin_reading"
        }]}
        tasks={[{
          artifactId: "artifact-thin-progress",
          id: "thin-reading-task",
          message: "正在核对薄读证据边界",
          partialAnswer: "尚未审计的薄读正文",
          progress: 78,
          stage: "thin_reading_validating",
          status: "running",
          type: "thin_reading"
        }]}
      />
    );

    expect(screen.getByText("正在生成薄读正文，完成后将在当前页面显示。")).toBeInTheDocument();
    expect(screen.queryByText("正在核对薄读证据边界")).not.toBeInTheDocument();
    expect(screen.queryByText("核验薄读证据")).not.toBeInTheDocument();
    expect(screen.queryByText("尚未审计的薄读正文")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "薄读 Agent 进度" })).not.toBeInTheDocument();
  });

  test("keeps initial thin-reading generation details private before the result tab exists", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[]}
        tasks={[{
          id: "thin-reading-root-task",
          message: "正在规划薄读证据目录",
          partialAnswer: "未审计的总述正文",
          progress: 36,
          stage: "thin_reading_planning",
          status: "running",
          type: "thin_reading"
        }]}
      />
    );

    expect(screen.getByText("正在生成薄读正文，完成后将在当前页面显示。")).toBeInTheDocument();
    expect(screen.queryByText("正在规划薄读证据目录")).not.toBeInTheDocument();
    expect(screen.queryByText("未审计的总述正文")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Agent 分析进度" })).not.toBeInTheDocument();
  });

  test("shows only the safe public reason after initial thin-reading generation fails", () => {
    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[]}
        tasks={[{
          failure: {
            endpoint: "http://127.0.0.1:8787",
            failedStage: "thin_reading_planning",
            message: "请先登录 Liteasy 账号，再使用云端模型服务。",
            model: "deepseek-v4-flash",
            occurredAt: "2026-08-08T13:36:36.828Z",
            provider: "deepseek",
            recovery: ["登录后重试。"]
          },
          id: "thin-reading-login-failure",
          message: "Agent 分析失败",
          partialAnswer: "不应展示的模型报文",
          progress: 43,
          stage: "failed",
          status: "failed",
          type: "thin_reading"
        }]}
      />
    );

    expect(screen.getByText("请登录或重新登录 Liteasy 账号，再使用模型服务。")).toBeInTheDocument();
    expect(screen.queryByText("正在生成薄读正文，完成后将在当前页面显示。")).not.toBeInTheDocument();
    expect(screen.queryByText("请先登录 Liteasy 账号，再使用云端模型服务。")).not.toBeInTheDocument();
    expect(screen.queryByText("不应展示的模型报文")).not.toBeInTheDocument();
    expect(screen.queryByText("deepseek-v4-flash")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Agent 分析进度" })).not.toBeInTheDocument();
  });

  test("shows thin-reading generation diagnostics to server-authorized developers", () => {
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-progress",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "ColBERT uses late interaction for retrieval.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });

    render(
      <ArtifactTabs
        analysisHint=""
        canStartAnalysis
        developerDiagnostics
        onStartAnalysis={vi.fn()}
        selectedCount={1}
        selectionLocked
        tabs={[{
          artifactId: "artifact-thin-progress",
          papers: [{ id: "paper-1", title: "ColBERT" }],
          thinReadingDocument,
          title: "薄读",
          type: "thin_reading"
        }]}
        tasks={[{
          artifactId: "artifact-thin-progress",
          id: "thin-reading-task",
          message: "正在核对薄读证据边界",
          partialAnswer: "开发测试实时正文",
          progress: 78,
          stage: "thin_reading_validating",
          status: "running",
          type: "thin_reading"
        }]}
      />
    );

    expect(screen.getByText("正在核对薄读证据边界")).toBeInTheDocument();
    expect(screen.getByText("核验薄读证据")).toBeInTheDocument();
    expect(screen.getByText("开发测试实时正文")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "薄读 Agent 进度" })).toHaveAttribute("aria-valuenow", "78");
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
            pageTextEnd: 98,
            pageTextStart: 45,
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
      pageTextEnd: 98,
      pageTextStart: 45,
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

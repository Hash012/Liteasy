import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import type { ArtifactTab, ArtifactTask } from "../app/features/artifacts/artifact.types";
import type { Paper } from "../app/features/workspace/workspace.types";
import { useArtifactActions } from "../app/features/artifacts/useArtifactActions";
import type { AgentRun } from "../app/features/agent-api/agentApi.types";

function createMindmapArtifact(verificationStatus: "fail" | "pass" = "pass") {
  const verification = {
    checkedAt: "2026-07-20T02:00:00.000Z",
    errors: verificationStatus === "fail"
      ? [{
          code: "missing_selected_paper_coverage",
          message: "选中文献 demo-1 没有被思维导图节点覆盖。"
        }]
      : [],
    repairable: verificationStatus === "fail",
    status: verificationStatus,
    warnings: []
  };

  return {
    artifactId: "artifact-mindmap-1",
    createdAt: "2026-07-20T02:00:00.000Z",
    root: {
      children: [
        {
          children: [],
          confidence: "high",
          id: "node-claim-1",
          label: "ColBERT evidence",
          nodeType: "paper_claim",
          sourceRefs: ["paper:evidence-1"]
        }
      ],
      confidence: "high",
      id: "root",
      label: "ColBERT 思维导图",
      nodeType: "topic",
      sourceRefs: []
    },
    runId: "analysis-1",
    sources: {
      externalReferences: [],
      inferences: [],
      selectedPapers: [{
        evidenceId: "evidence-1",
        paperId: "demo-1",
        paperTitle: "ColBERT",
        refId: "paper:evidence-1",
        snippet: "evidence"
      }]
    },
    title: "ColBERT 思维导图",
    verification,
    version: "liteasy.mindmap-artifact/v1"
  };
}

function createArtifactWorkflow(status: "blocked" | "verified" = "verified") {
  const mindmap = createMindmapArtifact(status === "verified" ? "pass" : "fail");
  return {
    mindmap,
    status,
    verification: mindmap.verification
  };
}

function createCompletedAgentRun(options: {
  artifactWorkflow?: ReturnType<typeof createArtifactWorkflow>;
} = {}): AgentRun {
  return {
    apiVersion: "liteasy.agent/v1",
    completedAt: "2026-07-20T02:00:00.000Z",
    createdAt: "2026-07-20T01:59:00.000Z",
    events: [
      {
        apiVersion: "liteasy.agent/v1",
        citations: [{ page: 2, paperId: "demo-1", snippet: "evidence" }],
        emittedAt: "2026-07-20T02:00:00.000Z",
        eventId: "event-answer",
        message: "Agent generated analysis",
        metadata: {
          analysis: {
            citations: [],
            claims: [],
            evidence: [],
            evidencePrompt: "evidence",
            paperClaims: [],
            retrievalConfidence: 0.9,
            run: {
              completedAt: "2026-07-20T02:00:00.000Z",
              coverage: {
                coveredPaperIds: ["demo-1"],
                missingPaperIds: [],
                ratio: 1,
                selectedPaperIds: ["demo-1"]
              },
              createdAt: "2026-07-20T01:59:00.000Z",
              id: "analysis-1",
              plan: {
                dimensions: ["方法"],
                maxEvidencePerPaper: 2,
                maxTotalEvidence: 12,
                paperIds: ["demo-1"],
                query: "analyze"
              },
              query: "analyze",
              status: "completed"
            }
          },
          artifactWorkflow: options.artifactWorkflow ?? createArtifactWorkflow()
        },
        runId: "run-artifact-1",
        sequence: 1,
        sessionId: "session-artifact-1",
        type: "assistant.message"
      }
    ],
    idempotencyKey: "artifact-1",
    input: { artifactType: "mindmap", message: "analyze", mode: "qa" },
    runId: "run-artifact-1",
    sessionId: "session-artifact-1",
    status: "completed"
  };
}

function createCompletedThinReadingRun(): AgentRun {
  const run = createCompletedAgentRun();
  const answerEvent = run.events.find((event) => event.type === "assistant.message");
  if (!answerEvent || answerEvent.type !== "assistant.message") {
    throw new Error("expected assistant answer event");
  }
  answerEvent.message = "ColBERT 的核心是用 MaxSim 保留 token-level matching signals。";
  answerEvent.metadata = {
    ...answerEvent.metadata,
    thinReading: {
      context: {
        artifactId: "artifact-1",
        depth: 0,
        paperIds: ["demo-1"],
        primaryPaperId: "demo-1",
        primaryPaperTitle: "ColBERT",
        source: { kind: "root_overview" },
        targetLanguage: "zh-CN"
      },
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          paperEvidence: ["evidence-1"]
        },
        omittedSections: [
          { id: "section-experiment", label: "实验", sectionKey: "experiment" }
        ],
        recommendations: [
          {
            compatibility: 0.78,
            id: "intuecho-local",
            note: "本地待同步的理解线索。",
            relationship: "方法与问题设定"
          }
        ],
        summary: "ColBERT 的核心是用 MaxSim 保留 token-level matching signals。",
        withinPaperClosure: true
      }
    }
  };
  return {
    ...run,
    input: { artifactType: "thin_reading", message: "thin reading", mode: "qa" }
  };
}

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

function renderArtifactActions(options: {
  activeReaderPaper?: Paper | null;
  assistantLanguage?: string;
  confirmDuplicateGeneration?: ReturnType<typeof vi.fn>;
  diagnosticContext?: { endpoint: string; model: string; provider: string };
  imported?: boolean;
  locked?: boolean;
  selectedPapers?: Paper[];
} = {}) {
  const artifactStore = createArtifactStore();
  const onAnalysisHint = vi.fn();
  const onArtifactCatalogChanged = vi.fn<(catalog: ArtifactTab[]) => void>();
  const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
  const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
  const selectedPapers = options.selectedPapers ?? [paper];
  const selectedDocumentSet = {
    documentIds: selectedPapers.map((item) => item.id),
    locked: options.locked ?? true
  };
  const importedChunks = options.imported
    ? Object.fromEntries(selectedPapers.map((item) => [item.id, buildImportedChunksForPaper(item)]))
    : {};
  const queueImportForPapers = vi.fn((queuedPapers: Paper[], onComplete?: () => void) => {
    if (options.imported) {
      return "already_imported";
    }
    window.setTimeout(() => onComplete?.(), 1200);
    return queuedPapers.length > 0 ? "started" : "idle";
  });
  const runAgentAnalysis = vi.fn(async () => createCompletedAgentRun());
  const saveArtifactResult = vi.fn(async (document: { artifactId: string }) =>
    `project-docs/agent-results/${document.artifactId}.json`
  );
  const deleteArtifactResult = vi.fn(async () => undefined);

  const hook = renderHook(() =>
    useArtifactActions({
      artifactStore,
      artifactResultClient: {
        delete: deleteArtifactResult,
        list: vi.fn(async () => []),
        save: saveArtifactResult
      },
      confirmDuplicateGeneration: options.confirmDuplicateGeneration,
      getAssistantLanguage: options.assistantLanguage
        ? () => options.assistantLanguage!
        : undefined,
      getActiveReaderPaper: () => options.activeReaderPaper ?? null,
      getImportedChunksByPaperId: () => importedChunks,
      getModelDiagnosticContext: options.diagnosticContext
        ? () => options.diagnosticContext!
        : undefined,
      getSelectedDocumentSet: () => selectedDocumentSet,
      getSelectedPapers: () => selectedPapers,
      onAnalysisHint,
      onArtifactCatalogChanged,
      onArtifactTabsChanged,
      onArtifactTasksChanged,
      queueImportForPapers,
      runAgentAnalysis
    })
  );

  return {
    artifactStore,
    onAnalysisHint,
    onArtifactCatalogChanged,
    onArtifactTabsChanged,
    onArtifactTasksChanged,
    queueImportForPapers,
    runAgentAnalysis,
    deleteArtifactResult,
    saveArtifactResult,
    result: hook.result
  };
}

describe("useArtifactActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("syncs all concurrent generation tasks without dropping older sessions", () => {
    const artifactStore = createArtifactStore();
    const firstTaskId = artifactStore.createTask("mindmap");
    const secondTaskId = artifactStore.createTask("tree");
    artifactStore.startTask(firstTaskId);
    artifactStore.startTask(secondTaskId);
    const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
    const hook = renderHook(() =>
      useArtifactActions({
        artifactStore,
        artifactResultClient: {
          delete: vi.fn(async () => undefined),
          list: vi.fn(async () => []),
          save: vi.fn(async () => "project-docs/agent-results/test.json")
        },
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        onArtifactCatalogChanged: vi.fn(),
        onArtifactTabsChanged: vi.fn(),
        onArtifactTasksChanged,
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => createCompletedAgentRun())
      })
    );

    act(() => {
      hook.result.current.syncArtifacts(secondTaskId);
    });

    expect(onArtifactTasksChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: secondTaskId, type: "tree" }),
      expect.objectContaining({ id: firstTaskId, type: "mindmap" })
    ]);
  });

  test("requires a selected and locked document set before analysis", () => {
    const empty = renderArtifactActions({ selectedPapers: [] });

    let message = "";
    act(() => {
      message = empty.result.current.startAnalysis("mindmap");
    });
    expect(message).toBe("请先在工作区勾选文件，形成选中文献集。");
    expect(empty.onAnalysisHint).toHaveBeenLastCalledWith("请先在工作区勾选文件，形成选中文献集。");

    const unlocked = renderArtifactActions({ locked: false });
    act(() => {
      message = unlocked.result.current.startAnalysis("tree");
    });
    expect(message).toBe("请先锁定选中文献集，再启动 AI 分析。");
    expect(unlocked.queueImportForPapers).not.toHaveBeenCalled();
  });

  test("queues imports before starting analysis when selected papers are not imported", async () => {
    const { onAnalysisHint, onArtifactTabsChanged, onArtifactTasksChanged, queueImportForPapers, result } = renderArtifactActions();

    let message = "";
    act(() => {
      message = result.current.startAnalysis("mindmap");
    });

    expect(message).toBe("当前选中文献集尚未全部导入，系统会先导入，再自动启动该 AI 分析。");
    expect(queueImportForPapers).toHaveBeenCalledWith([paper], expect.any(Function));
    expect(onArtifactTasksChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        message: "等待 PDF 解析与索引",
        progress: 5,
        stage: "waiting_for_import",
        status: "queued",
        type: "mindmap"
      })
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
      await Promise.resolve();
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: "Literature Mind Map", type: "mindmap" })
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      expect.stringContaining("Agent 分析完成并已保存")
    );
  });

  test("starts analysis immediately when selected papers are already imported", async () => {
    const {
      onAnalysisHint,
      onArtifactTabsChanged,
      onArtifactTasksChanged,
      runAgentAnalysis,
      saveArtifactResult,
      result
    } = renderArtifactActions({
      imported: true
    });

    let message = "";
    act(() => {
      message = result.current.startAnalysis("ppt");
    });

    expect(message).toBe("当前选中文献集已导入，正在按指定 AI 分析启动。");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定 AI 分析启动。");
    expect(onArtifactTasksChanged).toHaveBeenCalledWith([
      expect.objectContaining({ status: "running", type: "ppt" })
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: "Literature PPT Outline", type: "ppt" })
    ]);
    expect(runAgentAnalysis).toHaveBeenCalledWith("ppt", expect.any(Function));
    expect(saveArtifactResult).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ runId: "run-artifact-1" }),
        artifactType: "ppt",
        version: "liteasy.agent-artifact/v1"
      })
    );
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      expect.stringContaining("project-docs/agent-results/")
    );
  });

  test("generates a completed thin-reading artifact through Agent for imported papers", async () => {
    const {
      artifactStore,
      onArtifactTabsChanged,
      result,
      runAgentAnalysis,
      saveArtifactResult
    } = renderArtifactActions({
      assistantLanguage: "zh-CN",
      imported: true
    });
    runAgentAnalysis.mockResolvedValueOnce(createCompletedThinReadingRun());

    act(() => {
      result.current.startAnalysis("thin_reading");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runAgentAnalysis).toHaveBeenCalledWith(
      "thin_reading",
      expect.any(Function),
      expect.objectContaining({
        sourcePaperIds: [paper.id],
        thinReadingContext: expect.objectContaining({
          artifactId: "artifact-1",
          primaryPaperId: paper.id,
          source: { kind: "root_overview" },
          targetLanguage: "zh-CN"
        })
      })
    );
    expect(saveArtifactResult).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: "thin_reading",
      thinReadingDocument: expect.objectContaining({
        targetLanguage: "zh-CN"
      })
    }));
    expect(artifactStore.getTasks()[0]).toEqual(expect.objectContaining({
      artifactId: expect.any(String),
      status: "completed",
      type: "thin_reading"
    }));
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        createdAt: expect.any(String),
        papers: [{ id: paper.id, title: paper.title }],
        thinReadingDocument: expect.objectContaining({
          targetLanguage: "zh-CN",
          nodes: expect.any(Object)
        }),
        title: "薄读",
        type: "thin_reading"
      })
    ]);
  });

  test("prefers the active reader paper over earlier selected papers for a root thin reading", async () => {
    const secondPaper: Paper = {
      id: "demo-2",
      sourcePath: "fixtures/demo-2.pdf",
      title: "A second selected paper"
    };
    const {
      onArtifactTabsChanged,
      queueImportForPapers,
      result,
      runAgentAnalysis
    } = renderArtifactActions({
      activeReaderPaper: secondPaper,
      imported: true,
      selectedPapers: [paper, secondPaper]
    });
    runAgentAnalysis.mockResolvedValueOnce(createCompletedThinReadingRun());

    act(() => {
      result.current.startAnalysis("thin_reading");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queueImportForPapers).toHaveBeenCalledWith([secondPaper], expect.any(Function));
    expect(runAgentAnalysis).toHaveBeenCalledWith(
      "thin_reading",
      expect.any(Function),
      expect.objectContaining({
        sourcePaperIds: [secondPaper.id],
        thinReadingContext: expect.objectContaining({
          paperIds: [secondPaper.id],
          primaryPaperId: secondPaper.id
        })
      })
    );
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ papers: [{ id: secondPaper.id, title: secondPaper.title }] })
    ]);
  });

  test("passes parent claims and evidence spans when generating a thin-reading branch", async () => {
    const fixture = createThinReadingFixture();
    const document = createThinReadingDocument(fixture);
    const papers = fixture.papers.map((item) => ({ id: item.id, title: item.title }));
    const {
      artifactStore,
      result,
      runAgentAnalysis
    } = renderArtifactActions({
      imported: true,
      selectedPapers: papers
    });
    runAgentAnalysis.mockResolvedValueOnce(createCompletedThinReadingRun());
    artifactStore.upsertTab({
      artifactId: document.artifactId,
      createdAt: "2026-07-28T00:00:00.000Z",
      papers,
      thinReadingDocument: document,
      title: "薄读",
      type: "thin_reading"
    });

    await act(async () => {
      await result.current.generateThinReadingBranch({
        artifactId: document.artifactId,
        document,
        source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" }
      });
    });

    expect(runAgentAnalysis).toHaveBeenCalledWith(
      "thin_reading",
      expect.any(Function),
      expect.objectContaining({
        sourcePaperIds: ["paper-attention"],
        thinReadingContext: expect.objectContaining({
          depth: 1,
          paperIds: ["paper-attention"],
          primaryPaperId: "paper-attention",
          parentClaims: [
            expect.objectContaining({
              id: "thin-reading-claim-attention-core",
              text: expect.stringContaining("self-attention")
            })
          ],
          parentEvidenceSpans: [
            expect.objectContaining({
              id: "evidence-attention-self-attention",
              page: 2,
              quote: expect.stringContaining("Self-attention replaces recurrence")
            })
          ],
          parentNodeId: document.rootNodeId,
          parentSummary: expect.stringContaining("Transformer"),
          source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" }
        })
      })
    );
    expect(artifactStore.getOpenTabs().find((tab) => tab.artifactId === document.artifactId)).toEqual(
      expect.objectContaining({ papers: [{ id: "paper-attention", title: "Attention Is All You Need" }] })
    );
  });

  test("reuses an existing branch without retaining legacy multi-paper refs", async () => {
    const fixture = createThinReadingFixture();
    const root = createThinReadingDocument(fixture);
    const generated = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: fixture.rootSeed,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const document = { ...generated, activeNodeId: generated.rootNodeId };
    const papers = fixture.papers.map((item) => ({ id: item.id, title: item.title }));
    const { artifactStore, result, runAgentAnalysis } = renderArtifactActions({
      imported: true,
      selectedPapers: papers
    });
    artifactStore.upsertTab({
      artifactId: document.artifactId,
      createdAt: "2026-07-28T00:00:00.000Z",
      papers,
      thinReadingDocument: document,
      title: "薄读",
      type: "thin_reading"
    });

    await act(async () => {
      await result.current.generateThinReadingBranch({
        artifactId: document.artifactId,
        document,
        source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" }
      });
    });

    expect(runAgentAnalysis).not.toHaveBeenCalled();
    expect(artifactStore.getOpenTabs().find((tab) => tab.artifactId === document.artifactId)).toEqual(
      expect.objectContaining({
        papers: [{ id: "paper-attention", title: "Attention Is All You Need" }],
        thinReadingDocument: expect.objectContaining({ paperIds: ["paper-attention"] })
      })
    );
  });

  test("applies assistant language to generated thin-reading content", async () => {
    const {
      onArtifactTabsChanged,
      runAgentAnalysis,
      result
    } = renderArtifactActions({
      assistantLanguage: "en-US",
      imported: true
    });
    const run = createCompletedThinReadingRun();
    const answerEvent = run.events.find((event) => event.type === "assistant.message");
    if (!answerEvent || answerEvent.type !== "assistant.message") {
      throw new Error("expected assistant answer event");
    }
    if (
      !answerEvent.metadata ||
      typeof answerEvent.metadata !== "object" ||
      Array.isArray(answerEvent.metadata)
    ) {
      throw new Error("expected metadata");
    }
    (answerEvent.metadata as Record<string, unknown>).thinReading = {
      context: {
        artifactId: "artifact-1",
        depth: 0,
        paperIds: ["demo-1"],
        primaryPaperId: "demo-1",
        primaryPaperTitle: "ColBERT",
        source: { kind: "root_overview" },
        targetLanguage: "en-US"
      },
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          paperEvidence: ["evidence-1"]
        },
        omittedSections: [
          { id: "section-experiment", label: "Experiments", sectionKey: "experiment" }
        ],
        recommendations: [],
        summary: "ColBERT keeps token-level matching signals through MaxSim.",
        withinPaperClosure: true
      }
    };
    runAgentAnalysis.mockResolvedValueOnce(run);

    act(() => {
      result.current.startAnalysis("thin_reading");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const thinReadingDocument = onArtifactTabsChanged.mock.lastCall?.[0][0].thinReadingDocument;
    const root = thinReadingDocument?.nodes[thinReadingDocument.rootNodeId];

    expect(thinReadingDocument).toEqual(expect.objectContaining({
      targetLanguage: "en-US",
      title: expect.not.stringMatching(/^薄读[:：]/)
    }));
    expect(root?.omittedSections.map((token) => token.label)).toContain("Experiments");
    expect(root?.summary).not.toMatch(/围绕|薄读总述|可用上下文/);
  });

  test("blocks saving a mindmap when artifact workflow verification fails", async () => {
    const {
      artifactStore,
      onAnalysisHint,
      result,
      runAgentAnalysis,
      saveArtifactResult
    } = renderArtifactActions({
      imported: true
    });
    runAgentAnalysis.mockResolvedValueOnce(createCompletedAgentRun({
      artifactWorkflow: createArtifactWorkflow("blocked")
    }));

    act(() => {
      result.current.startAnalysis("mindmap");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveArtifactResult).not.toHaveBeenCalled();
    expect(artifactStore.getTasks()[0]).toEqual(expect.objectContaining({
      stage: "failed",
      status: "failed"
    }));
    expect(onAnalysisHint).toHaveBeenLastCalledWith(expect.stringContaining("审计未通过"));
  });

  test("persists verified mindmap artifact metadata with the saved result", async () => {
    const {
      onArtifactTabsChanged,
      result,
      saveArtifactResult
    } = renderArtifactActions({
      imported: true
    });

    act(() => {
      result.current.startAnalysis("mindmap");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveArtifactResult).toHaveBeenCalledWith(expect.objectContaining({
      mindmapArtifact: expect.objectContaining({
        verification: expect.objectContaining({ status: "pass" })
      }),
      verification: expect.objectContaining({ status: "pass" })
    }));
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        mindmapArtifact: expect.objectContaining({
          verification: expect.objectContaining({ status: "pass" })
        }),
        verification: expect.objectContaining({ status: "pass" })
      })
    ]);
  });

  test("keeps provider diagnostics when Agent generation rejects", async () => {
    const { artifactStore, onAnalysisHint, result, runAgentAnalysis } = renderArtifactActions({
      diagnosticContext: {
        endpoint: "http://127.0.0.1:8791",
        model: "gpt-5.5",
        provider: "openai"
      },
      imported: true
    });
    runAgentAnalysis.mockRejectedValueOnce(
      new Error("OpenAI Responses API 流式请求失败（404）：route missing")
    );

    act(() => {
      result.current.startAnalysis("tree");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(artifactStore.getTasks()[0]).toMatchObject({
      failure: {
        endpoint: "http://127.0.0.1:8791",
        failedStage: "preparing_context",
        message: expect.stringContaining("route missing"),
        model: "gpt-5.5",
        provider: "openai",
        recovery: expect.arrayContaining([
          expect.stringContaining("/responses")
        ])
      },
      status: "failed"
    });
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      expect.stringContaining("route missing")
    );
  });

  test("cancels a running Agent artifact and never saves its partial result", async () => {
    const artifactStore = createArtifactStore();
    const cancelAgentRun = vi.fn(async () => undefined);
    const save = vi.fn(async () => "should-not-be-written.json");
    let resolveRun: ((run: AgentRun) => void) | undefined;
    const runAgentAnalysis = vi.fn((
      _artifactType: string,
      onProgress: (input: {
        agentRunId?: string;
        message: string;
        progress: number;
        stage: "generating_answer";
      }) => void
    ) => {
      onProgress({
        agentRunId: "run-cancel-me",
        message: "正在生成",
        progress: 55,
        stage: "generating_answer"
      });
      return new Promise<AgentRun>((resolve) => {
        resolveRun = resolve;
      });
    });
    const hook = renderHook(() => useArtifactActions({
      artifactStore,
      artifactResultClient: {
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => []),
        save
      },
      cancelAgentRun,
      getImportedChunksByPaperId: () => ({
        [paper.id]: buildImportedChunksForPaper(paper)
      }),
      getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
      getSelectedPapers: () => [paper],
      onAnalysisHint: vi.fn(),
      onArtifactCatalogChanged: vi.fn(),
      onArtifactTabsChanged: vi.fn(),
      onArtifactTasksChanged: vi.fn(),
      queueImportForPapers: vi.fn(() => "already_imported"),
      runAgentAnalysis: runAgentAnalysis as never
    }));

    act(() => {
      hook.result.current.startAnalysis("tree");
    });
    const task = artifactStore.getTasks()[0];
    expect(task.agentRunId).toBe("run-cancel-me");

    await act(async () => {
      await hook.result.current.cancelArtifactTask(task.id);
    });
    expect(cancelAgentRun).toHaveBeenCalledWith(
      "run-cancel-me",
      "用户终止了多模态产物生成"
    );
    expect(artifactStore.getTask(task.id)).toMatchObject({
      stage: "cancelled",
      status: "cancelled"
    });

    await act(async () => {
      resolveRun?.({
        ...createCompletedAgentRun(),
        events: [],
        runId: "run-cancel-me",
        status: "cancelled"
      });
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
    expect(artifactStore.getCatalog()).toEqual([]);
  });

  test("starts comparison-table analysis as a first-class artifact type", async () => {
    const { onArtifactTabsChanged, onArtifactTasksChanged, result } = renderArtifactActions({
      imported: true
    });

    act(() => {
      result.current.startAnalysis("comparison_table");
    });

    expect(onArtifactTasksChanged).toHaveBeenCalledWith([
      expect.objectContaining({ status: "running", type: "comparison_table" })
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        title: "Literature Comparison Table",
        type: "comparison_table",
        uiDsl: expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ComparisonTable",
                props: expect.objectContaining({
                  title: "Literature Comparison Table"
                })
              }),
              expect.objectContaining({
                component: "EvidenceMatrix"
              }),
              expect.objectContaining({
                component: "ActionBar",
                props: expect.objectContaining({
                  actionIds: ["open-artifact-1-run-artifact-1"]
                })
              })
            ]),
            component: "Stack"
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              actionId: "artifact.open_tab",
              id: "open-artifact-1-run-artifact-1",
              input: expect.objectContaining({
                artifactId: "artifact-1-run-artifact-1",
                artifactType: "comparison_table"
              })
            })
          ]),
          surface: "center_artifact"
        })
      })
    ]);
  });

  test.each([
    ["mindmap", "MindMap"],
    ["tree", "TreeOutline"],
    ["ppt", "SlideDeck"]
  ] as const)("creates a typed center artifact DSL for %s analysis", async (artifactType, component) => {
    const { onArtifactTabsChanged, result } = renderArtifactActions({
      imported: true
    });

    act(() => {
      result.current.startAnalysis(artifactType);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: artifactType,
        uiDsl: expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ActionBar"
              })
            ]),
            component
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              actionId: "artifact.open_tab",
              id: "open-artifact-1-run-artifact-1",
              input: expect.objectContaining({
                artifactId: "artifact-1-run-artifact-1",
                artifactType
              })
            })
          ]),
          surface: "center_artifact"
        })
      })
    ]);
  });

  test("keeps the model-generated Markdown hierarchy as the final tree", async () => {
    const {
      onArtifactTabsChanged,
      runAgentAnalysis,
      saveArtifactResult,
      result
    } = renderArtifactActions({ imported: true });
    const run = createCompletedAgentRun();
    const answerEvent = run.events.find((event) => event.type === "assistant.message");
    if (!answerEvent || answerEvent.type !== "assistant.message") {
      throw new Error("expected assistant answer event");
    }
    answerEvent.message = [
      "- ColBERT",
      "  - 方法",
      "    - Late interaction [evidence-2-example]",
      "      - MaxSim 保留 token 级匹配",
      "  - 实验",
      "    - 指标与基线"
    ].join("\n");
    runAgentAnalysis.mockResolvedValueOnce(run);

    act(() => {
      result.current.startAnalysis("tree");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        outlineNodes: expect.arrayContaining([
          expect.objectContaining({ label: "ColBERT", parentId: undefined }),
          expect.objectContaining({
            evidenceIds: ["evidence-2-example"],
            label: "Late interaction [evidence-2-example]"
          }),
          expect.objectContaining({ label: "MaxSim 保留 token 级匹配" })
        ])
      })
    ]);
    expect(saveArtifactResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outlineNodes: expect.arrayContaining([
          expect.objectContaining({ label: "指标与基线" })
        ])
      })
    );
  });

  test("does not start duplicate analysis while selected papers are still importing", () => {
    const artifactStore = createArtifactStore();
    const onAnalysisHint = vi.fn();
    const onArtifactCatalogChanged = vi.fn<(catalog: ArtifactTab[]) => void>();
    const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
    const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
    const queueImportForPapers = vi.fn(() => "importing" as const);
    const hook = renderHook(() =>
      useArtifactActions({
        artifactStore,
        artifactResultClient: {
          delete: vi.fn(async () => undefined),
          list: vi.fn(async () => []),
          save: vi.fn(async () => "project-docs/agent-results/test.json")
        },
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
        onArtifactCatalogChanged,
        onArtifactTabsChanged,
        onArtifactTasksChanged,
        queueImportForPapers,
        runAgentAnalysis: vi.fn(async () => createCompletedAgentRun())
      })
    );

    let message = "";
    act(() => {
      message = hook.result.current.startAnalysis("tree");
    });

    expect(message).toBe("当前选中文献集正在导入，请稍后再开始分析。");
    expect(onArtifactTasksChanged).not.toHaveBeenCalled();
    expect(onArtifactTabsChanged).not.toHaveBeenCalled();
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集正在导入，请稍后再开始分析。");
  });

  test("assistant artifact command delegates to the selected-set analysis flow", () => {
    const { result } = renderArtifactActions();

    let message = "";
    act(() => {
      message = result.current.handleAssistantArtifact("tree");
    });

    expect(message).toBe("当前选中文献集尚未全部导入，系统会先导入，再自动启动该 AI 分析。");
  });

  test("asks before generating the same modality for the exact persisted paper set", () => {
    const secondPaper: Paper = {
      id: "demo-2",
      sourcePath: "fixtures/demo-2.pdf",
      title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings"
    };
    const confirmDuplicateGeneration = vi.fn(() => false);
    const {
      artifactStore,
      onAnalysisHint,
      onArtifactTasksChanged,
      queueImportForPapers,
      result,
      runAgentAnalysis
    } = renderArtifactActions({
      confirmDuplicateGeneration,
      imported: true,
      selectedPapers: [paper, secondPaper]
    });
    artifactStore.upsertCatalogEntry({
      artifactId: "artifact-saved-tree",
      papers: [
        { id: secondPaper.id, title: secondPaper.title },
        { id: paper.id, title: paper.title }
      ],
      title: "Saved Tree",
      type: "tree"
    });

    let message = "";
    act(() => {
      message = result.current.startAnalysis("tree");
    });

    expect(confirmDuplicateGeneration).toHaveBeenCalledWith({
      artifactType: "tree",
      existingArtifacts: [expect.objectContaining({ artifactId: "artifact-saved-tree" })],
      papers: [paper, secondPaper]
    });
    expect(message).toBe("已取消重复生成“树形展开”产物。");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("已取消重复生成“树形展开”产物。");
    expect(queueImportForPapers).not.toHaveBeenCalled();
    expect(runAgentAnalysis).not.toHaveBeenCalled();
    expect(onArtifactTasksChanged).not.toHaveBeenCalled();
    expect(artifactStore.getTasks()).toEqual([]);
  });

  test("continues duplicate generation only after confirmation", () => {
    const confirmDuplicateGeneration = vi.fn(() => true);
    const { artifactStore, queueImportForPapers, result } = renderArtifactActions({
      confirmDuplicateGeneration,
      imported: true
    });
    artifactStore.upsertCatalogEntry({
      artifactId: "artifact-saved-mindmap",
      papers: [{ id: paper.id, title: paper.title }],
      title: "Saved Mind Map",
      type: "mindmap"
    });

    act(() => {
      result.current.startAnalysis("mindmap");
    });

    expect(confirmDuplicateGeneration).toHaveBeenCalledTimes(1);
    expect(queueImportForPapers).toHaveBeenCalledTimes(1);
    expect(artifactStore.getTasks()).toEqual([
      expect.objectContaining({ status: "running", type: "mindmap" })
    ]);
  });

  test("does not confirm when modality or the source-paper set differs", () => {
    const confirmDuplicateGeneration = vi.fn(() => false);
    const { artifactStore, queueImportForPapers, result } = renderArtifactActions({
      confirmDuplicateGeneration,
      imported: true
    });
    artifactStore.upsertCatalogEntry({
      artifactId: "artifact-saved-tree-with-other-paper",
      papers: [{ id: "demo-2", title: "ACORN" }],
      title: "Saved Tree",
      type: "tree"
    });
    artifactStore.upsertCatalogEntry({
      artifactId: "artifact-saved-ppt",
      papers: [{ id: paper.id, title: paper.title }],
      title: "Saved PPT",
      type: "ppt"
    });

    act(() => {
      result.current.startAnalysis("tree");
    });

    expect(confirmDuplicateGeneration).not.toHaveBeenCalled();
    expect(queueImportForPapers).toHaveBeenCalledTimes(1);
  });

  test("assistant artifact command returns cancellation and does not create a task", () => {
    const confirmDuplicateGeneration = vi.fn(() => false);
    const { artifactStore, result, runAgentAnalysis } = renderArtifactActions({
      confirmDuplicateGeneration,
      imported: true
    });
    artifactStore.upsertCatalogEntry({
      artifactId: "artifact-saved-tree",
      papers: [{ id: paper.id, title: paper.title }],
      title: "Saved Tree",
      type: "tree"
    });

    let message = "";
    act(() => {
      message = result.current.handleAssistantArtifact("tree");
    });

    expect(message).toBe("已取消重复生成“树形展开”产物。");
    expect(runAgentAnalysis).not.toHaveBeenCalled();
    expect(artifactStore.getTasks()).toEqual([]);
  });

  test("deletes persistence before removing an artifact from catalog and open tabs", async () => {
    const { deleteArtifactResult, onArtifactCatalogChanged, onArtifactTabsChanged, result } =
      renderArtifactActions();
    act(() => {
      result.current.restoreArtifactResult({
        agent: {
          apiVersion: "liteasy.agent/v1",
          runId: "run-saved",
          sessionId: "session-saved",
          status: "completed"
        },
        answer: "analysis",
        artifactId: "artifact-saved",
        artifactType: "tree",
        citations: [],
        createdAt: "2026-07-20T03:00:00.000Z",
        papers: [{ id: paper.id, title: paper.title }],
        title: "Saved Tree",
        uiDsl: { version: "liteasy-ui-dsl/v1" } as never,
        version: "liteasy.agent-artifact/v1"
      });
      result.current.openArtifact("artifact-saved");
    });

    await act(async () => {
      await result.current.deleteArtifact("artifact-saved");
    });

    expect(deleteArtifactResult).toHaveBeenCalledWith("artifact-saved");
    expect(onArtifactCatalogChanged).toHaveBeenLastCalledWith([]);
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([]);
  });

  test("keeps catalog and tabs when persistent artifact deletion fails", async () => {
    const actions = renderArtifactActions();
    actions.deleteArtifactResult.mockRejectedValueOnce(new Error("disk busy"));
    act(() => {
      actions.result.current.restoreArtifactResult({
        agent: {
          apiVersion: "liteasy.agent/v1",
          runId: "run-saved",
          sessionId: "session-saved",
          status: "completed"
        },
        answer: "analysis",
        artifactId: "artifact-saved",
        artifactType: "tree",
        citations: [],
        createdAt: "2026-07-20T03:00:00.000Z",
        papers: [{ id: paper.id, title: paper.title }],
        title: "Saved Tree",
        uiDsl: { version: "liteasy-ui-dsl/v1" } as never,
        version: "liteasy.agent-artifact/v1"
      });
    });

    await act(async () => {
      await actions.result.current.deleteArtifact("artifact-saved");
    });

    expect(actions.onArtifactCatalogChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ artifactId: "artifact-saved" })
    ]);
    expect(actions.onAnalysisHint).toHaveBeenLastCalledWith(
      "删除多模态产物失败：disk busy"
    );
  });

  test("regenerates from the persisted source-paper set and saves provenance", async () => {
    const artifactStore = createArtifactStore();
    artifactStore.upsertTab({
      artifactId: "artifact-original",
      papers: [{ id: paper.id, title: paper.title }],
      title: "Literature Tree Analysis",
      type: "tree"
    });
    const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
    const runAgentAnalysis = vi.fn(async () => createCompletedAgentRun());
    const save = vi.fn(async (document: { artifactId: string }) =>
      `project-docs/agent-results/${document.artifactId}.json`
    );
    const hook = renderHook(() =>
      useArtifactActions({
        artifactStore,
        artifactResultClient: {
          delete: vi.fn(async () => undefined),
          list: vi.fn(async () => []),
          save
        },
        getImportedChunksByPaperId: () => ({
          [paper.id]: buildImportedChunksForPaper(paper)
        }),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        onArtifactCatalogChanged: vi.fn(),
        onArtifactTabsChanged,
        onArtifactTasksChanged: vi.fn(),
        queueImportForPapers: vi.fn(() => "already_imported" as const),
        runAgentAnalysis
      })
    );

    act(() => {
      hook.result.current.regenerateArtifact({
        artifactId: "artifact-original",
        artifactType: "tree",
        papers: [{ id: paper.id, title: paper.title }],
        supplementalContext: "请结合 Table 2 的 MRR@10 结果。"
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runAgentAnalysis).toHaveBeenCalledWith(
      "tree",
      expect.any(Function),
      {
        regeneratedFromArtifactId: "artifact-original",
        sourcePaperIds: [paper.id],
        supplementalContext: "请结合 Table 2 的 MRR@10 结果。"
      }
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        papers: [{ id: paper.id, title: paper.title }],
        regeneratedFromArtifactId: "artifact-original",
        supplementalContext: "请结合 Table 2 的 MRR@10 结果。"
      })
    );
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        regeneratedFromArtifactId: "artifact-original",
        supplementalContext: "请结合 Table 2 的 MRR@10 结果。"
      }),
      expect.objectContaining({ artifactId: "artifact-original" })
    ]);
  });
});

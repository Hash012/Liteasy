import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import type { ArtifactTab, ArtifactTask } from "../app/features/artifacts/artifact.types";
import type { Paper } from "../app/features/workspace/workspace.types";
import { useArtifactActions } from "../app/features/artifacts/useArtifactActions";
import type { AgentRun } from "../app/features/agent-api/agentApi.types";

function createCompletedAgentRun(): AgentRun {
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
          }
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

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

function renderArtifactActions(options: {
  imported?: boolean;
  locked?: boolean;
  selectedPapers?: Paper[];
} = {}) {
  const artifactStore = createArtifactStore();
  const onAnalysisHint = vi.fn();
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

  const hook = renderHook(() =>
    useArtifactActions({
      artifactStore,
      artifactResultClient: {
        list: vi.fn(async () => []),
        save: saveArtifactResult
      },
      getImportedChunksByPaperId: () => importedChunks,
      getSelectedDocumentSet: () => selectedDocumentSet,
      getSelectedPapers: () => selectedPapers,
      onAnalysisHint,
      onArtifactTabsChanged,
      onArtifactTasksChanged,
      queueImportForPapers,
      runAgentAnalysis
    })
  );

  return {
    onAnalysisHint,
    onArtifactTabsChanged,
    onArtifactTasksChanged,
    queueImportForPapers,
    runAgentAnalysis,
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
    expect(message).toBe("请先锁定选中文献集，再启动模态分析。");
    expect(unlocked.queueImportForPapers).not.toHaveBeenCalled();
  });

  test("queues imports before starting analysis when selected papers are not imported", async () => {
    const { onAnalysisHint, onArtifactTabsChanged, onArtifactTasksChanged, queueImportForPapers, result } = renderArtifactActions();

    let message = "";
    act(() => {
      message = result.current.startAnalysis("mindmap");
    });

    expect(message).toBe("当前选中文献集尚未全部导入，系统会先导入，再自动启动该模态分析。");
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

    expect(message).toBe("当前选中文献集已导入，正在按指定模态启动分析。");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定模态启动分析。");
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
    const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
    const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
    const queueImportForPapers = vi.fn(() => "importing" as const);
    const hook = renderHook(() =>
      useArtifactActions({
        artifactStore,
        artifactResultClient: {
          list: vi.fn(async () => []),
          save: vi.fn(async () => "project-docs/agent-results/test.json")
        },
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
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

    expect(message).toBe("已根据当前选中文献集触发分支 skill；如尚未导入，系统会先导入再开始生成产物。");
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
        artifactResultClient: { list: vi.fn(async () => []), save },
        getImportedChunksByPaperId: () => ({
          [paper.id]: buildImportedChunksForPaper(paper)
        }),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
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

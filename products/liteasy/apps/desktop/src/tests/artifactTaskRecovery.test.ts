import { beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import {
  createThinReadingBranchRecoverySnapshot,
  persistInterruptedArtifactTasks,
  takeInterruptedArtifactTasks,
  validateThinReadingBranchRecoverySnapshot
} from "../app/features/artifacts/artifactTaskRecovery";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";

function createDocument() {
  return createThinReadingDocument({
    artifactId: "artifact-thin-7",
    papers: [{ id: "paper-1", title: "A paper" }],
    rootSeed: {
      evidence: {
        externalKnowledge: [],
        paperEvidence: ["evidence-1"],
        paperEvidenceSpans: [{
          confidence: 0.9,
          id: "evidence-1",
          paperId: "paper-1",
          quote: "The paper introduces a bounded evidence chain."
        }],
        summarySentences: [{
          evidenceIds: ["evidence-1"],
          externalKnowledge: [],
          id: "sentence-1",
          status: "grounded",
          text: "The paper introduces a bounded evidence chain."
        }]
      },
      omittedSections: [{ id: "section-1", label: "实验", sectionKey: "experiments" }],
      recommendations: [],
      summary: "The paper introduces a bounded evidence chain.",
      withinPaperClosure: true
    },
    targetLanguage: "zh-CN"
  });
}

describe("artifactTaskRecovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("persists only unfinished tasks and consumes the recovery snapshot once", () => {
    persistInterruptedArtifactTasks([
      {
        id: "artifact-task-7",
        message: "正在生成薄读下一层",
        progress: 54,
        stage: "thin_reading_generating_branch",
        status: "running",
        type: "thin_reading"
      },
      {
        id: "artifact-task-8",
        message: "分析结果已保存",
        progress: 100,
        stage: "completed",
        status: "completed",
        type: "thin_reading"
      }
    ]);

    expect(takeInterruptedArtifactTasks()).toEqual([
      expect.objectContaining({
        id: "artifact-task-7",
        status: "running",
        type: "thin_reading"
      })
    ]);
    expect(takeInterruptedArtifactTasks()).toEqual([]);
  });

  test("isolates interrupted tasks by account and leaves legacy tasks device-local", () => {
    const task = {
      id: "artifact-task-account-a",
      message: "正在准备账号 A 的产物",
      progress: 15,
      stage: "preparing_context" as const,
      status: "running" as const,
      type: "mindmap" as const
    };
    persistInterruptedArtifactTasks([task], "https://cloud.example:user-a");

    expect(takeInterruptedArtifactTasks("https://cloud.example:user-b")).toEqual([]);
    expect(takeInterruptedArtifactTasks("https://cloud.example:user-a")).toEqual([
      expect.objectContaining({ id: "artifact-task-account-a" })
    ]);

    window.localStorage.setItem(
      "liteasy.artifact-task-recovery/v1",
      JSON.stringify([{ ...task, id: "artifact-task-legacy" }])
    );
    expect(takeInterruptedArtifactTasks("https://cloud.example:user-a")).toEqual([]);
    expect(takeInterruptedArtifactTasks()).toEqual([
      expect.objectContaining({ id: "artifact-task-legacy" })
    ]);
  });

  test("does not block generation when task recovery exceeds browser storage quota", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(() => persistInterruptedArtifactTasks([{
      id: "artifact-task-9",
      message: "正在准备 Agent 上下文",
      progress: 15,
      stage: "preparing_context",
      status: "running",
      type: "mindmap"
    }])).not.toThrow();

    expect(window.localStorage.getItem("liteasy.artifact-task-recovery/v1:device")).toBeNull();
    setItem.mockRestore();
  });

  test("restores an interrupted task as an explicit retryable failure", () => {
    const store = createArtifactStore();
    store.restoreInterruptedTask({
      artifactId: "artifact-thin-7",
      id: "artifact-task-7",
      message: "正在生成薄读下一层",
      progress: 54,
      type: "thin_reading"
    });

    expect(store.getTask("artifact-task-7")).toMatchObject({
      artifactId: "artifact-thin-7",
      failure: expect.objectContaining({
        message: expect.stringContaining("应用在生成期间重启"),
        recovery: ["重新发起生成"]
      }),
      stage: "failed",
      status: "failed"
    });
    expect(store.createTask("thin_reading")).toBe("artifact-task-8");
  });

  test("persists a bounded branch snapshot and validates it against the restored document", () => {
    const document = createDocument();
    const snapshot = createThinReadingBranchRecoverySnapshot({
      artifactId: document.artifactId,
      document,
      parentNodeId: document.rootNodeId,
      primaryPaperId: "paper-1",
      source: {
        evidenceIds: ["evidence-1"],
        excerpt: "bounded evidence chain",
        kind: "selected_text",
        prompt: "用 mermaid 图呈现这段话的因果关系",
        quickCommand: "mermaid_causal",
        requestedOutput: "mermaid"
      }
    });
    persistInterruptedArtifactTasks([{
      artifactId: document.artifactId,
      id: "artifact-task-7",
      message: "正在生成薄读下一层",
      progress: 54,
      stage: "thin_reading_generating_branch",
      status: "running",
      thinReadingBranchRecovery: snapshot,
      type: "thin_reading"
    }]);

    expect(takeInterruptedArtifactTasks()[0]?.thinReadingBranchRecovery).toEqual(snapshot);
    expect(validateThinReadingBranchRecoverySnapshot(snapshot, document)).toEqual({ valid: true });
  });

  test("persists and validates v2 branch recovery snapshots", () => {
    const document = createDocument();
    const snapshot = createThinReadingBranchRecoverySnapshot({
      artifactId: document.artifactId,
      document,
      parentNodeId: document.rootNodeId,
      primaryPaperId: "paper-1",
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiments" }
    });

    expect(snapshot.documentVersion).toBe("liteasy.thin-reading/v2");
    expect(validateThinReadingBranchRecoverySnapshot(snapshot, document)).toEqual({ valid: true });
  });

  test("rejects a recovery snapshot whose quick command and output type disagree", () => {
    const document = createDocument();

    expect(() => createThinReadingBranchRecoverySnapshot({
      artifactId: document.artifactId,
      document,
      parentNodeId: document.rootNodeId,
      primaryPaperId: "paper-1",
      source: {
        excerpt: "bounded evidence chain",
        kind: "selected_text",
        quickCommand: "mermaid_causal",
        requestedOutput: "html_demo"
      }
    })).toThrow("薄读分支输入超出可恢复范围");
  });

  test("rejects a recovery snapshot when its evidence no longer belongs to the parent node", () => {
    const document = createDocument();
    const snapshot = createThinReadingBranchRecoverySnapshot({
      artifactId: document.artifactId,
      document,
      parentNodeId: document.rootNodeId,
      primaryPaperId: "paper-1",
      source: {
        evidenceIds: ["evidence-1"],
        excerpt: "bounded evidence chain",
        kind: "selected_text"
      }
    });
    const changedDocument = createThinReadingDocument({
      artifactId: document.artifactId,
      papers: [{ id: "paper-1", title: "A paper" }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-2"] },
        omittedSections: [],
        recommendations: [],
        summary: "A changed document.",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });

    expect(validateThinReadingBranchRecoverySnapshot(snapshot, changedDocument)).toEqual({
      valid: false,
      reason: "原分支引用的论文证据已变化。"
    });
  });

  test("persists an omitted-section branch only while it remains on the parent page", () => {
    const document = createDocument();

    const snapshot = createThinReadingBranchRecoverySnapshot({
      artifactId: document.artifactId,
      document,
      parentNodeId: document.rootNodeId,
      primaryPaperId: "paper-1",
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiments" }
    });

    expect(validateThinReadingBranchRecoverySnapshot(snapshot, document)).toEqual({ valid: true });
    expect(validateThinReadingBranchRecoverySnapshot({
      ...snapshot,
      source: { kind: "omitted_section", label: "伪造板块", sectionKey: "forged" }
    }, document)).toEqual({
      valid: false,
      reason: "原未覆盖模块已不在父页面的可深入列表中。"
    });
  });
});

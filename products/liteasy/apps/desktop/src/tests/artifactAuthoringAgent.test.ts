import { describe, expect, test, vi } from "vitest";
import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { createOpenAIAgentsSdkManager } from "../app/controllers/agent/createOpenAIAgentsSdkManager";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ContextSnapshot } from "../app/features/context/objectContext";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";

const sourceRef = { objectId: "source-note", revision: "revision-1" };
const snapshot: ContextSnapshot = {
  snapshotId: "context-snapshot-ppt",
  scopeId: "test-user",
  purpose: "生成 PPT",
  createdAt: "2026-09-15T00:00:00.000Z",
  tokens: 18,
  entries: [{
    ref: sourceRef,
    title: "用户的汇报笔记",
    text: "测试来源：MaxSim 对每个查询词计算最佳文档词匹配。",
    sha256: "test-source-digest",
    tokens: 18,
    origin: "explicit",
    trustLabel: "derived",
    extractor: "liteasy.text/v1"
  }]
};
const slides = {
  version: "liteasy.authored-artifact/v1",
  kind: "slides",
  title: "MaxSim 汇报",
  slides: [{ id: "slide-method", title: "匹配机制", markdown: "每个查询词保留最佳匹配。", notes: "说明笔记属于派生资料。", evidenceIds: ["source-note@revision-1"] }]
};

function fixture(answer: unknown) {
  const resolveObjectContext = vi.fn(async () => snapshot);
  const modelTransport = vi.fn(async (_request: ModelTransportRequest) => ({
    json: async () => ({ answer: typeof answer === "string" ? answer : JSON.stringify(answer), execution: { backend: "http_service", mode: "live", provider: "openai" } }),
    ok: true,
    status: 200
  }));
  const api = createDesktopAgentService({
    getEnvironment: () => ({
      knowledge: {
        importedChunksByPaperId: {},
        modelTransport,
        selectedPapers: [],
        settings: createSettingsStore().getState()
      },
      runtime: { contextView: {
        cloud: { connected: false },
        profile: { enabled: false, requiresConfirmation: false },
        selection: { importedCount: 0, issues: ["selection_empty"], locked: false, ready: false, selectedCount: 0 },
        workspace: { type: "local" }
      } }
    }),
    resolveObjectContext,
    managerAgent: createOpenAIAgentsSdkManager(),
    listCapabilities: () => [],
    now: () => new Date("2026-09-15T00:00:00.000Z")
  });
  const run = async (kind: "ppt" | "qa" = "ppt") => {
    const session = await api.createSession({ consumer: "frontend" });
    if (!session.ok) throw new Error(session.error.message);
    return api.submitTurn({
      idempotencyKey: "object-ppt",
      contextRefs: [sourceRef],
      contextPurpose: "根据所选笔记制作汇报",
      input: { ...(kind === "ppt" ? { artifactType: "ppt" as const } : {}), message: kind === "ppt" ? "依据这份笔记创建 PPT" : "解释这份笔记", mode: "qa" },
      sessionId: session.data.sessionId
    });
  };
  return { run, modelTransport, resolveObjectContext };
}

describe("object-context PPT through the public Agent service", () => {
  test("preserves ordinary object questions as source-grounded QA without an authoring schema", async () => {
    const f = fixture("MaxSim 对查询词进行最佳匹配。");
    const run = await f.run("qa");
    expect(run).toMatchObject({ ok: true, data: { status: "completed" } });
    if (!run.ok) throw new Error(run.error.message);
    const request = JSON.parse(f.modelTransport.mock.calls[0][0].body);
    expect(request.outputFormat).toBeUndefined();
    expect(request.prompt).toContain("用户问题：解释这份笔记");
    expect(run.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "execution.route", runtime: "liteasy_knowledge_workflow" })
    ]));
  });

  test("uses a nested SDK specialist and carries validated slides instead of taking the ordinary QA shortcut", async () => {
    const f = fixture(slides);
    const run = await f.run();
    expect(run).toMatchObject({ ok: true, data: { status: "completed", contextSnapshotId: snapshot.snapshotId } });
    if (!run.ok) throw new Error(run.error.message);
    expect(f.resolveObjectContext).toHaveBeenCalledWith(expect.objectContaining({ contextRefs: [sourceRef] }));
    expect(f.modelTransport).toHaveBeenCalledTimes(1);
    const request = JSON.parse(f.modelTransport.mock.calls[0][0].body);
    expect(request).toMatchObject({ outputFormat: { name: "liteasy_authored_artifact", strict: true } });
    expect(request.prompt).toContain("[source-note@revision-1] 用户的汇报笔记 (derived)");
    expect(request.prompt).toContain(snapshot.entries[0].text);
    expect(request.prompt).toContain("Liteasy 主 Agent 委派的结构化内容创作子任务");
    const message = run.data.events.find((event) => event.type === "assistant.message");
    expect(message).toMatchObject({
      metadata: {
        authoredArtifact: slides,
        resourceSnapshot: { snapshotId: snapshot.snapshotId, scopeId: snapshot.scopeId, entries: [expect.objectContaining({ ref: sourceRef, trustLabel: "derived" })] },
        specialist: { artifactType: "ppt", specialistId: "multimodal" },
        workflow: { skillId: "liteasy.multimodal-artifact" },
        agentSdk: {
          mainAgent: "Liteasy Manager Agent",
          mainTool: "liteasy_multimodal_agent",
          mainItems: expect.arrayContaining(["function_call", "function_call_result"]),
          specialistAgent: "Liteasy Multimodal Agent",
          specialistItems: expect.arrayContaining(["function_call", "function_call_result"]),
          resultDestination: "artifact_surface"
        }
      }
    });
    expect(JSON.stringify(message)).not.toContain("liteasy_knowledge_workflow");
    expect(run.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "execution.route", runtime: "openai_agents_sdk" }),
      expect.objectContaining({ type: "manager.activity", kind: "handoff", label: "演示文稿子任务已返回", status: "completed" }),
      expect.objectContaining({ type: "manager.activity", label: "内容校验通过", status: "completed" })
    ]));
  });

  test("keeps invalid authoring failed after one repair without returning fake slides or completed handoffs", async () => {
    const f = fixture("下面介绍如何自己制作 PPT，但没有实际产物。");
    const run = await f.run();
    expect(run).toMatchObject({ ok: true, data: { status: "failed" } });
    if (!run.ok) throw new Error(run.error.message);
    expect(f.modelTransport).toHaveBeenCalledTimes(2);
    expect(run.data.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "assistant.message" }),
    ]));
    expect(run.data.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "manager.activity", label: "演示文稿子任务已返回", status: "completed" })
    ]));
    expect(run.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "run.failed" }),
      expect.objectContaining({ type: "manager.activity", label: "内容生成未完成", status: "failed" })
    ]));
  });
});

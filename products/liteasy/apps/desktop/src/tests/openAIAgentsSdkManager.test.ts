import { createOpenAIAgentsSdkManager } from "../app/controllers/agent/createOpenAIAgentsSdkManager";
import { createSpecialistAgentToolCatalog } from "../app/features/agent-runtime/specialistAgentAdapter";

test("runs Thin Reading as an Agents SDK nested agent and returns its result", async () => {
  const activities: Array<Record<string, unknown>> = [];
  const specialistInvocations: Array<Record<string, unknown>> = [];
  const manager = createOpenAIAgentsSdkManager();

  expect(manager.runtime).toBe("openai_agents_sdk");
  const result = await manager.run({
    answerNormally: () => Promise.reject(new Error("unexpected_knowledge_route")),
    reportManagerActivity(activity: Record<string, unknown>) {
      activities.push(activity);
    },
    invokeSpecialist(invocation: Record<string, unknown>) {
      specialistInvocations.push(invocation);
      return Promise.resolve({
        message: "# 薄读结果\n\n## 核心论点\n证据链完整。",
        metadata: {
          thinReading: {
            version: "liteasy.thin-reading/v2"
          },
          workflow: {
            skillId: "liteasy.thin-reading",
            skillVersion: "1.0.0"
          }
        }
      });
    },
    request: {
      input: {
        artifactType: "thin_reading",
        message: "为当前论文生成薄读",
        mode: "qa"
      }
    },
    runId: "run-thin-reading-sdk",
    signal: new AbortController().signal,
    specialistTools: createSpecialistAgentToolCatalog()
  } as never);

  expect(specialistInvocations).toEqual([{
    arguments: { instruction: "为当前论文生成薄读" },
    specialistId: "thin_reading",
    toolCallId: "run-thin-reading-sdk:tool-thin_reading"
  }]);
  expect(result).toMatchObject({
    kind: "knowledge",
    result: {
      message: expect.stringContaining("核心论点"),
      metadata: {
        agentSdk: {
          mainAgent: "Liteasy Manager Agent",
          mainItems: expect.arrayContaining(["function_call", "function_call_result"]),
          mainTool: "liteasy_thin_reading_agent",
          resultDestination: "artifact_surface",
          specialistAgent: "Liteasy Thin Reading Agent",
          specialistItems: expect.arrayContaining(["function_call", "function_call_result"])
        },
        thinReading: {
          version: "liteasy.thin-reading/v2"
        }
      }
    }
  });
  expect(activities).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "handoff",
      label: "薄读子任务已返回",
      status: "completed"
    }),
    expect.objectContaining({
      detail: expect.stringContaining("中心产物页"),
      kind: "tool_result",
      label: "薄读结果已传回",
      status: "completed"
    })
  ]));
});

test("preserves the specialist failure instead of replacing it with result_missing", async () => {
  const manager = createOpenAIAgentsSdkManager();
  await expect(manager.run({
    answerNormally: vi.fn(), reportManagerActivity: vi.fn(),
    invokeSpecialist: async () => { throw new Error("网络连接中断，请继续薄读"); },
    request: { input: { artifactType: "thin_reading", message: "生成薄读", mode: "qa" } },
    runId: "failed-run", signal: new AbortController().signal, specialistTools: createSpecialistAgentToolCatalog()
  } as never)).rejects.toThrow("网络连接中断，请继续薄读");
});

test.each(["ppt", "tree", "comparison_table", "mindmap", "layered_graph"] as const)("the main Agent retries a failed %s specialist once and returns the recovered result", async (artifactType) => {
  const invokeSpecialist = vi.fn()
    .mockRejectedValueOnce(new Error("503 Service unavailable"))
    .mockResolvedValueOnce({ message: "已生成并校验学习资料" });
  const reportManagerActivity = vi.fn();
  const result = await createOpenAIAgentsSdkManager().run({
    request: { input: { artifactType, message: "制作学习资料，保留用户指定的范围", mode: "qa" } },
    invokeSpecialist, reportManagerActivity,
    runId: "materials-run", signal: new AbortController().signal,
    specialistTools: createSpecialistAgentToolCatalog(),
    toErrorEnvelope: () => ({ ok: false, error: { userImpact: "服务暂时不可用" } })
  } as never);
  expect(invokeSpecialist).toHaveBeenCalledTimes(2);
  expect(invokeSpecialist.mock.calls[1][0]).toMatchObject({
    arguments: { artifactType, instruction: "制作学习资料，保留用户指定的范围" },
    specialistId: "multimodal", toolCallId: "materials-run:tool-multimodal:retry-1"
  });
  expect(result).toMatchObject({ kind: "knowledge", result: {
    message: "已生成并校验学习资料", metadata: { agentSdk: {
      mainAgent: "Liteasy Manager Agent", specialistAgent: "Liteasy Multimodal Agent",
      resultDestination: "artifact_surface", retryCount: 1
    } }
  } });
  expect(reportManagerActivity).toHaveBeenCalledWith(expect.objectContaining({ label: "重新生成成功", status: "completed" }));
});

test.each([
  ["503 service unavailable", 2], ["结构校验失败", 2],
  ["401 unauthorized", 1], ["选中文献不足", 1]
])("bounds recovery and preserves the final error: %s", async (message, attempts) => {
  const invokeSpecialist = vi.fn().mockRejectedValue(new Error(message));
  await expect(createOpenAIAgentsSdkManager().run({
    request: { input: { artifactType: "ppt", message: "制作PPT", mode: "qa" } },
    invokeSpecialist, reportManagerActivity: vi.fn(), runId: "failed-materials",
    signal: new AbortController().signal, specialistTools: createSpecialistAgentToolCatalog(),
    toErrorEnvelope: () => ({ ok: false, error: { userImpact: message } })
  } as never)).rejects.toThrow(message);
  expect(invokeSpecialist).toHaveBeenCalledTimes(attempts);
});

test("does not redo a material generation after cancellation", async () => {
  const abort = new AbortController();
  const invokeSpecialist = vi.fn(async () => { abort.abort(); throw new Error("503 interrupted"); });
  await expect(createOpenAIAgentsSdkManager().run({
    request: { input: { artifactType: "ppt", message: "制作PPT", mode: "qa" } },
    invokeSpecialist, reportManagerActivity: vi.fn(), runId: "cancelled-materials",
    signal: abort.signal, specialistTools: createSpecialistAgentToolCatalog(),
    toErrorEnvelope: () => ({ ok: false, error: { userImpact: "已取消" } })
  } as never)).rejects.toThrow();
  expect(invokeSpecialist).toHaveBeenCalledTimes(1);
});

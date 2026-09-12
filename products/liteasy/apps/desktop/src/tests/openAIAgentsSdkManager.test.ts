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

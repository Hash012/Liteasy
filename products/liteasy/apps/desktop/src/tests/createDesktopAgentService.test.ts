import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { buildImportedChunksForPaper } from "./fixtures/retrievalFixtures";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createWorkflowDesignerRuntime } from "../app/features/skills/workflowDesigner";
import type { PluginBuilderRuntime } from "../app/features/extensions/pluginBuilder";
import type { Paper } from "../app/features/workspace/workspace.types";

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

test("preserves mindmap artifact workflow metadata on assistant messages", async () => {
  let sequence = 0;
  const api = createDesktopAgentService({
    createId(prefix) {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
    getEnvironment: () => ({
      knowledge: {
        auditTransport: async () => ({
          json: async () => ({ audit: { rationale: "grounded", score: 0.9, verdict: "pass" } }),
          ok: true,
          status: 200
        }),
        importedChunksByPaperId: {
          [paper.id]: buildImportedChunksForPaper(paper)
        },
        modelTransport: async () => {
          const answer = "- ColBERT\n  - Late interaction [evidence-1]";
          const encoder = new TextEncoder();
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ delta: answer, type: "delta" })}\n`));
                controller.enqueue(encoder.encode(`${JSON.stringify({
                  answer,
                  execution: { backend: "test_cloud", mode: "live", provider: "openai" },
                  type: "completed"
                })}\n`));
                controller.close();
              }
            }),
            json: async () => ({}),
            ok: true,
            status: 200
          };
        },
        selectedPapers: [paper],
        settings: createSettingsStore().getState()
      },
      runtime: {
        contextView: {
          cloud: { connected: false },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 1,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 1
          },
          workspace: { type: "local" }
        }
      } as never
    }),
    listCapabilities: () => [],
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  const run = await api.submitTurn({
    idempotencyKey: "mindmap-run-1",
    input: {
      artifactType: "mindmap",
      message: "生成 ColBERT 思维导图",
      mode: "qa"
    },
    sessionId: session.data.sessionId
  });

  if (!run.ok) {
    throw new Error(run.error.message);
  }
  expect(run).toMatchObject({ data: { status: "completed" }, ok: true });
  const assistantMessage = run.data.events.find((event) => event.type === "assistant.message");
  expect(assistantMessage).toMatchObject({
    metadata: {
      artifactWorkflow: {
        mindmap: {
          verification: { status: "pass" }
        },
        status: "verified",
        workflowTrace: {
          internalOnly: true,
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: "verification",
              status: "completed",
              summary: "确定性校验通过"
            })
          ])
        }
      }
    }
  });
});

test("carries completed turns into the next model request within one Agent session", async () => {
  let sequence = 0;
  const prompts: string[] = [];
  const api = createDesktopAgentService({
    createId(prefix) {
      sequence += 1;
      return `${prefix}-context-${sequence}`;
    },
    getEnvironment: () => ({
      knowledge: {
        auditTransport: async () => ({
          json: async () => ({
            audit: { model: "audit", rationale: "ok", score: 0.9, verdict: "pass" }
          }),
          ok: true,
          status: 200
        }),
        importedChunksByPaperId: {},
        modelTransport: async (request) => {
          const prompt = String(JSON.parse(request.body).prompt);
          prompts.push(prompt);
          const answer = prompts.length === 1
            ? "好的，我会记住数字 17。"
            : "你刚才让我记住的是 17。";
          return {
            json: async () => ({
              answer,
              execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
            }),
            ok: true,
            status: 200
          };
        },
        selectedPapers: [],
        settings: createSettingsStore().getState()
      },
      runtime: {} as never
    }),
    listCapabilities: () => []
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);

  await api.submitTurn({
    idempotencyKey: "context-turn-1",
    input: { message: "请记住数字 17。", mode: "qa" },
    sessionId: session.data.sessionId
  });
  await api.submitTurn({
    idempotencyKey: "context-turn-2",
    input: { message: "我刚才让你记住什么？", mode: "qa" },
    sessionId: session.data.sessionId
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[0]).not.toContain("近期对话上下文");
  expect(prompts[1]).toContain("用户：请记住数字 17。");
  expect(prompts[1]).toContain("助手：好的，我会记住数字 17。");
  expect(prompts[1]).toContain("问题：我刚才让你记住什么？");
});

test("passes submitted request attachments into the resolved desktop environment", async () => {
  const observedAttachments: unknown[] = [];
  const api = createDesktopAgentService({
    getEnvironment: (input) => {
      observedAttachments.push(input?.request?.attachments);
      return {
        knowledge: {
          importedChunksByPaperId: {
            [paper.id]: buildImportedChunksForPaper(paper)
          },
          selectedPapers: [paper],
          settings: createSettingsStore().getState()
        },
        runtime: {
          contextView: {
            cloud: { connected: false },
            profile: { enabled: false, requiresConfirmation: false },
            selection: {
              importedCount: 1,
              issues: [],
              locked: true,
              ready: true,
              selectedCount: 1
            },
            workspace: { type: "local" }
          }
        } as never
      };
    },
    listCapabilities: () => [],
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  await api.submitTurn({
    attachments: [
      {
        metadata: {
          paperIds: ["demo-1", "demo-2"]
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ],
    idempotencyKey: "request-context-1",
    input: {
      artifactType: "mindmap",
      message: "生成指定论文思维导图",
      mode: "command"
    },
    sessionId: session.data.sessionId
  });

  expect(observedAttachments).toContainEqual([
    {
      metadata: {
        paperIds: ["demo-1", "demo-2"]
      },
      source: "selection",
      uri: "liteasy://selection/current"
    }
  ]);
});

test("routes a normal conversation through the manager and its capability broker", async () => {
  const appliedPresets: unknown[] = [];
  let observedActivityResult: unknown;
  let observedActivityToolName = "";
  let observedToolName = "";
  const api = createDesktopAgentService({
    getEnvironment: () => ({
      activity: {
        artifactTasks: [{
          id: "artifact-task-running",
          message: "正在检索证据",
          progress: 40,
          stage: "retrieving_evidence",
          status: "running",
          type: "mindmap"
        }]
      },
      knowledge: {
        importedChunksByPaperId: {
          [paper.id]: buildImportedChunksForPaper(paper)
        },
        selectedPapers: [paper],
        settings: createSettingsStore().getState()
      },
      runtime: {
        applyLayoutPreset(input) {
          appliedPresets.push(input);
          return "已切换双栏布局";
        },
        contextView: {
          cloud: { connected: false },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 1,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 1
          },
          workspace: { type: "local" }
        }
      }
    }),
    managerAgent: {
      async run(input) {
        input.reportManagerActivity({
          activityId: "manager-layout-tool",
          detail: "准备读取当前布局并应用用户请求。",
          kind: "reasoning_summary",
          label: "判断布局操作",
          status: "completed"
        });
        observedActivityToolName = input.activityTools.find(
          (tool) => tool.name === "liteasy_runtime_get_task_status"
        )?.name ?? "";
        observedActivityResult = await input.invokeActivityTool({
          arguments: { taskId: "artifact-task-running" },
          toolCallId: "activity-call-1",
          toolName: "liteasy_runtime_get_task_status"
        });
        observedToolName = input.capabilityTools.find(
          (tool) => tool.actionId === "layout.split_two"
        )?.name ?? "";
        const result = await input.invokeCapability({
          actionId: "layout.split_two",
          arguments: { preset: "two_column" },
          toolCallId: "manager-call-1"
        });
        input.reportManagerActivity({
          activityId: "manager-layout-call",
          detail: "布局工具已成功返回。",
          kind: "tool_result",
          label: "布局操作完成",
          status: "completed"
        });
        return { kind: "runtime", result };
      },
      runtime: "openai_agents_sdk"
    },
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  const run = await api.submitTurn({
    idempotencyKey: "manager-layout-1",
    input: {
      message: "把阅读区并排放一下",
      mode: "qa"
    },
    sessionId: session.data.sessionId
  });

  expect(run).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(observedActivityToolName).toBe("liteasy_runtime_get_task_status");
  expect(observedActivityResult).toEqual({
    ok: true,
    task: expect.objectContaining({
      currentStageLabel: "检索文献证据",
      progress: 40,
      taskId: "artifact-task-running"
    }),
    toolCallId: "activity-call-1"
  });
  expect(observedToolName).toBe("liteasy__layout__split_two");
  expect(appliedPresets).toEqual([{ preset: "two_column" }]);
  if (!run.ok) {
    throw new Error(run.error.message);
  }
  expect(run.data.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "reasoning_summary",
      label: "判断布局操作",
      type: "manager.activity"
    }),
    expect.objectContaining({ message: "已切换双栏布局", type: "assistant.message" })
  ]));
});

test("lets the manager invoke the existing multimodal workflow as a specialist tool", async () => {
  let observedDesignerToolName = "";
  let observedSpecialistName = "";
  let observedSuccessfulRuns: unknown;
  const answer = "先按作者假设、对应实验和支持程度生成对比结构。";
  const workflowDesigner = createWorkflowDesignerRuntime({
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const api = createDesktopAgentService({
    getEnvironment: () => ({
      knowledge: {
        auditTransport: async () => ({
          json: async () => ({ audit: { rationale: "grounded", score: 0.9, verdict: "pass" } }),
          ok: true,
          status: 200
        }),
        importedChunksByPaperId: {},
        modelTransport: async () => {
          const encoder = new TextEncoder();
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ delta: answer, type: "delta" })}\n`));
                controller.enqueue(encoder.encode(`${JSON.stringify({
                  answer,
                  execution: { backend: "test_cloud", mode: "live", provider: "openai" },
                  type: "completed"
                })}\n`));
                controller.close();
              }
            }),
            json: async () => ({}),
            ok: true,
            status: 200
          };
        },
        selectedPapers: [],
        settings: createSettingsStore().getState()
      },
      runtime: {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 0,
            issues: ["selection_empty"],
            locked: false,
            ready: false,
            selectedCount: 0
          },
          workspace: { type: "local" }
        }
      } as never,
      workflowDesigner
    }),
    listCapabilities: () => [],
    managerAgent: {
      async run(input) {
        observedSpecialistName = input.specialistTools.find(
          (tool) => tool.agent.id === "multimodal"
        )?.asTool.toolName ?? "";
        const result = await input.invokeSpecialist({
          arguments: {
            artifactType: "comparison_table",
            instruction: "按作者假设、对应实验和支持程度整理"
          },
          specialistId: "multimodal",
          toolCallId: "specialist-call-1"
        });
        observedDesignerToolName = input.workflowDesignerTools.find(
          (tool) => tool.name === "liteasy_workflow_list_successful_runs"
        )?.name ?? "";
        observedSuccessfulRuns = await input.invokeWorkflowDesigner({
          arguments: {},
          toolCallId: "workflow-list-call-1",
          toolName: "liteasy_workflow_list_successful_runs"
        });
        return { kind: "knowledge", result };
      }
    },
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  const run = await api.submitTurn({
    idempotencyKey: "manager-specialist-1",
    input: {
      message: "把这篇文章的论证关系整理清楚",
      mode: "qa"
    },
    sessionId: session.data.sessionId
  });

  expect(run).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(observedDesignerToolName).toBe("liteasy_workflow_list_successful_runs");
  expect(observedSpecialistName).toBe("liteasy_multimodal_agent");
  expect(observedSuccessfulRuns).toMatchObject({
    ok: true,
    runs: [{
      skillId: "liteasy.multimodal-artifact",
      skillVersion: "1.0.0"
    }]
  });
  if (!run.ok) {
    throw new Error(run.error.message);
  }
  expect(run.data.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      message: expect.stringContaining(answer),
      metadata: expect.objectContaining({
        specialist: {
          artifactType: "comparison_table",
          instruction: "按作者假设、对应实验和支持程度整理",
          specialistId: "multimodal",
          toolCallId: "specialist-call-1"
        },
        workflow: {
          skillId: "liteasy.multimodal-artifact",
          skillVersion: "1.0.0",
          steps: [{
            completedAt: "2026-07-26T00:00:00.000Z",
            id: "analyze-multimodal-artifact",
            operatorId: "liteasy.agent.artifact-analysis",
            operatorVersion: "1.0.0"
          }],
          version: "liteasy.workflow-trace/v1"
        }
      }),
      type: "assistant.message"
    })
  ]));
});

test("installs a designed workflow only after public Agent confirmation", async () => {
  const ids = ["draft-desktop-confirmation", "replay-desktop-confirmation"];
  const workflowDesigner = createWorkflowDesignerRuntime({
    createId: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-07-27T00:00:00.000Z")
  });
  workflowDesigner.recordSuccessfulRun({
    completedAt: "2026-07-26T00:00:00.000Z",
    input: { instruction: "先看贡献，再看实验" },
    resultSummary: "薄读完成",
    runId: "source-run-desktop-confirmation",
    skillId: "liteasy.thin-reading",
    skillVersion: "1.0.0",
    trace: {
      skillId: "liteasy.thin-reading",
      skillVersion: "1.0.0",
      steps: [{
        completedAt: "2026-07-26T00:00:00.000Z",
        id: "analyze-thin-reading",
        operatorId: "liteasy.agent.artifact-analysis",
        operatorVersion: "1.0.0"
      }],
      version: "liteasy.workflow-trace/v1"
    }
  });
  const proposal = await workflowDesigner.invokeTool({
    arguments: {
      description: "桌面确认集成测试工作流。",
      idHint: "desktop-confirmation-test",
      instructions: "先看贡献，再检查实验边界。",
      name: "桌面确认工作流",
      sourceRunId: "source-run-desktop-confirmation"
    },
    toolCallId: "design-desktop-confirmation",
    toolName: "liteasy_workflow_design_from_run"
  });
  if (!("draft" in proposal)) throw new Error("Expected a workflow draft");

  const api = createDesktopAgentService({
    getEnvironment: () => ({
      knowledge: {
        importedChunksByPaperId: {},
        selectedPapers: [],
        settings: createSettingsStore().getState()
      },
      runtime: {
        contextView: {
          cloud: { connected: false },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 0,
            issues: ["selection_empty"],
            locked: false,
            ready: false,
            selectedCount: 0
          },
          workspace: { type: "local" }
        }
      },
      workflowDesigner
    }),
    managerAgent: {
      async run(input) {
        const result = await input.invokeCapability({
          actionId: "workflow.install_draft",
          arguments: { draftId: proposal.draft.draftId },
          toolCallId: "install-desktop-confirmation"
        });
        return { kind: "runtime", result };
      }
    },
    now: () => new Date("2026-07-27T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const submitted = await api.submitTurn({
    idempotencyKey: "install-designed-workflow",
    input: { message: "保存刚才的流程", mode: "qa" },
    sessionId: session.data.sessionId
  });
  expect(submitted).toMatchObject({
    data: { status: "waiting_confirmation" },
    ok: true
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  const confirmation = submitted.data.events.find(
    (event) => event.type === "confirmation.required"
  );
  expect(confirmation).toMatchObject({
    action: {
      actionId: "workflow.install_draft",
      arguments: { draftId: "draft-desktop-confirmation" }
    }
  });
  if (!confirmation || confirmation.type !== "confirmation.required") {
    throw new Error("Expected public confirmation");
  }

  const approved = await api.resolveConfirmation({
    confirmationId: confirmation.confirmationId,
    decision: "approve",
    sessionId: session.data.sessionId
  });
  expect(approved).toMatchObject({ data: { status: "completed" }, ok: true });
  await expect(workflowDesigner.listInstalled()).resolves.toEqual([
    expect.objectContaining({
      manifest: expect.objectContaining({
        id: "user.desktop-confirmation-test",
        name: "桌面确认工作流"
      })
    })
  ]);
});

test("routes PluginBuilder output through public Agent confirmation before install", async () => {
  const install = vi.fn(async () => "已安装插件“Selection Ask” 1.0.0。");
  const pluginBuilder = {
    build: vi.fn(),
    describeInstallApproval: () =>
      "安装插件“Selection Ask” 1.0.0；权限：reader.selection.read。",
    getBuild: vi.fn(),
    install,
    invokeTool: vi.fn(async () => ({
      build: {
        audit: {
          auditedAt: "2026-07-28T00:00:00.000Z",
          findings: [],
          passed: true,
          requestedPermissions: ["reader.selection.read"],
          requiredPermissions: ["reader.selection.read"]
        },
        buildId: "plugin-build-public-confirmation",
        createdAt: "2026-07-28T00:00:00.000Z",
        package: null,
        request: { description: "为 PDF 选区添加 AI 询问入口。" },
        status: "awaiting_approval"
      },
      kind: "build" as const,
      nextAction: {
        actionId: "plugin.install_build" as const,
        arguments: { buildId: "plugin-build-public-confirmation" }
      }
    })),
    listBuilds: vi.fn(),
    restore: vi.fn(),
    uninstall: vi.fn()
  } as unknown as PluginBuilderRuntime;
  let observedBuilderTool = "";
  const api = createDesktopAgentService({
    getEnvironment: () => ({
      knowledge: {
        importedChunksByPaperId: {},
        selectedPapers: [],
        settings: createSettingsStore().getState()
      },
      pluginBuilder,
      runtime: {
        contextView: {
          cloud: { connected: false },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 0,
            issues: ["selection_empty"],
            locked: false,
            ready: false,
            selectedCount: 0
          },
          workspace: { type: "local" }
        }
      }
    }),
    managerAgent: {
      async run(input) {
        observedBuilderTool = input.pluginBuilderTools[0]?.name ?? "";
        const built = await input.invokePluginBuilder({
          arguments: { description: "为 PDF 选区添加 AI 询问入口。" },
          name: "liteasy_plugin_build",
          toolCallId: "plugin-build-public-call"
        });
        if (built.kind !== "build" || !built.nextAction) {
          throw new Error("Expected installable plugin build");
        }
        const result = await input.invokeCapability({
          actionId: built.nextAction.actionId,
          arguments: built.nextAction.arguments,
          toolCallId: "plugin-install-public-call"
        });
        return { kind: "runtime", result };
      }
    },
    now: () => new Date("2026-07-28T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);

  const submitted = await api.submitTurn({
    idempotencyKey: "build-plugin-public-confirmation",
    input: { message: "给 PDF 选区加一个问 AI 的插件", mode: "qa" },
    sessionId: session.data.sessionId
  });
  expect(observedBuilderTool).toBe("liteasy_plugin_build");
  expect(submitted).toMatchObject({ data: { status: "waiting_confirmation" }, ok: true });
  expect(install).not.toHaveBeenCalled();
  if (!submitted.ok) throw new Error(submitted.error.message);
  const confirmation = submitted.data.events.find(
    (event) => event.type === "confirmation.required"
  );
  expect(confirmation).toMatchObject({
    action: {
      actionId: "plugin.install_build",
      arguments: { buildId: "plugin-build-public-confirmation" }
    },
    summary: expect.stringContaining("Selection Ask")
  });
  if (!confirmation || confirmation.type !== "confirmation.required") {
    throw new Error("Expected public plugin confirmation");
  }

  const approved = await api.resolveConfirmation({
    confirmationId: confirmation.confirmationId,
    decision: "approve",
    sessionId: session.data.sessionId
  });
  expect(approved).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(install).toHaveBeenCalledWith("plugin-build-public-confirmation");
});

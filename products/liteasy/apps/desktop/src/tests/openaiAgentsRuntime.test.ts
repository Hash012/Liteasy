import type { ModelProvider } from "@openai/agents";
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
  modelResponder
} from "@openai/agents-core/testing";
import { createAgentsRunner } from "../app/features/agent-runtime/openai-agents/agentsRunner";
import { createActionTools } from "../app/features/agent-runtime/openai-agents/createActionTools";
import { createLiteasyModelProvider } from "../app/features/agent-runtime/openai-agents/modelProvider";
import type { AgentRuntimeContextView } from "../app/features/agent-runtime/agentRuntime.types";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

function createContextView(): AgentRuntimeContextView {
  return {
    cloud: { connected: true, organizationName: "Liteasy" },
    profile: { enabled: true, requiresConfirmation: true },
    selection: {
      importedCount: 1,
      issues: [],
      locked: true,
      ready: true,
      selectedCount: 1
    },
    workspace: { rootPath: "/workspace", type: "local" }
  };
}

function createRunner(model: ScriptedModel) {
  const modelProvider: ModelProvider = {
    getModel: () => model
  };
  return createAgentsRunner({ model: "test-model", modelProvider });
}

test("executes a single low-risk action through invokeAction", async () => {
  const applyPanelAction = vi.fn(() => "已打开设置。");
  const model = new ScriptedModel([
    [functionCall("panel_open", { panel: "settings" }, { callId: "call-panel" })],
    [assistantMessage("已打开设置。")]
  ]);

  const result = await createRunner(model).run({
    actionContext: { applyPanelAction, contextView: createContextView() },
    message: "打开设置",
    runId: "run-single"
  });

  expect(applyPanelAction).toHaveBeenCalledTimes(1);
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: expect.objectContaining({
        actionId: "panel.open",
        payload: { panel: "settings" }
      }),
      type: "action_request"
    }),
    { message: "已打开设置。", type: "assistant_reply" }
  ]));
});

test("executes multiple Liteasy actions before the final response", async () => {
  const applyPanelAction = vi.fn(({ operation }) => `${operation} done`);
  const moveDockItem = vi.fn(() => "move done");
  const model = new ScriptedModel([
    [
      functionCall("panel_close", { panel: "right" }, { callId: "call-close" }),
      functionCall(
        "dock_move_item",
        { itemId: "assistant", targetRegion: "bottom" },
        { callId: "call-move" }
      )
    ],
    [assistantMessage("两个操作均已完成。")]
  ]);

  const result = await createRunner(model).run({
    actionContext: {
      applyPanelAction,
      contextView: createContextView(),
      moveDockItem
    },
    message: "关闭右侧面板并把助手移到底部",
    runId: "run-multi"
  });

  expect(applyPanelAction).toHaveBeenCalledTimes(1);
  expect(moveDockItem).toHaveBeenCalledTimes(1);
  expect(result.events.filter((event) => event.type === "action_request")).toHaveLength(2);
});

test("returns invalid tool arguments to the model without running a handler", async () => {
  const applyPanelAction = vi.fn(() => "should not run");
  const model = new ScriptedModel([
    [functionCall("panel_open", {}, { callId: "call-invalid" })],
    modelResponder(({ request }) => {
      expect(JSON.stringify(request.input)).toContain("invalid_input");
      return [assistantMessage("需要明确要打开的面板。")];
    })
  ]);

  const result = await createRunner(model).run({
    actionContext: { applyPanelAction, contextView: createContextView() },
    message: "打开",
    runId: "run-invalid"
  });

  expect(applyPanelAction).not.toHaveBeenCalled();
  expect(result.events).toContainEqual({
    message: "需要明确要打开的面板。",
    type: "assistant_reply"
  });
});

test("hides actions whose Liteasy handlers are unavailable", async () => {
  const model = new ScriptedModel([
    modelResponder(({ request }) => {
      expect(request.tools.some((candidate) => candidate.name === "panel_open")).toBe(false);
      expect(request.tools.some((candidate) => candidate.name === "dock_move_item")).toBe(true);
      return [assistantMessage("当前无法打开面板。")];
    })
  ]);

  await createRunner(model).run({
    actionContext: {
      contextView: createContextView(),
      moveDockItem: () => "moved"
    },
    message: "打开设置",
    runId: "run-hidden"
  });
});

test("pauses a high-risk action and executes it exactly once after approval", async () => {
  const syncWorkspace = vi.fn(() => "同步完成");
  const model = new ScriptedModel([
    [
      functionCall(
        "cloud_sync_workspace",
        { scope: "current_workspace" },
        { callId: "call-sync" }
      )
    ],
    [assistantMessage("工作区已同步。")]
  ]);
  const runner = createRunner(model);
  const actionContext = {
    actionHandlers: {
      "cloud.sync_workspace": syncWorkspace
    },
    contextView: createContextView()
  };

  const interrupted = await runner.run({
    actionContext,
    message: "同步工作区",
    runId: "run-approve"
  });
  const confirmation = interrupted.events.find(
    (event) => event.type === "confirmation_request" && "confirmationId" in event
  );
  expect(confirmation).toBeDefined();
  expect(syncWorkspace).not.toHaveBeenCalled();

  const resumed = await runner.resume({
    actionContext,
    confirmation: confirmation!,
    decision: "approve",
    runId: "run-approve"
  });

  expect(syncWorkspace).toHaveBeenCalledTimes(1);
  expect(resumed.events).toContainEqual({
    message: "工作区已同步。",
    type: "assistant_reply"
  });
});

test("rejects a high-risk action without executing it", async () => {
  const deleteDocuments = vi.fn(() => "deleted");
  const model = new ScriptedModel([
    [
      functionCall(
        "workspace_delete_documents",
        { scope: "selected_document_set" },
        { callId: "call-delete" }
      )
    ],
    [assistantMessage("已取消删除。")]
  ]);
  const runner = createRunner(model);
  const actionContext = {
    actionHandlers: {
      "workspace.delete_documents": deleteDocuments
    },
    contextView: createContextView()
  };
  const interrupted = await runner.run({
    actionContext,
    message: "删除选中文献",
    runId: "run-reject"
  });
  const confirmation = interrupted.events.find(
    (event) => event.type === "confirmation_request" && "confirmationId" in event
  );

  const resumed = await runner.resume({
    actionContext,
    confirmation: confirmation!,
    decision: "reject",
    runId: "run-reject"
  });

  expect(deleteDocuments).not.toHaveBeenCalled();
  expect(resumed.events).toContainEqual({ message: "已取消删除。", type: "assistant_reply" });
});

test("restores a serialized confirmation with a new runner", async () => {
  const upload = vi.fn(() => "uploaded");
  const initialModel = new ScriptedModel([
    [
      functionCall(
        "cloud_upload_documents",
        { scope: "selected_document_set" },
        { callId: "call-upload" }
      )
    ]
  ]);
  const actionContext = {
    actionHandlers: { "cloud.upload_documents": upload },
    contextView: createContextView()
  };
  const interrupted = await createRunner(initialModel).run({
    actionContext,
    message: "上传文献",
    runId: "run-restart"
  });
  const confirmation = interrupted.events.find(
    (event) => event.type === "confirmation_request" && "confirmationId" in event
  );

  const restartedRunner = createRunner(
    new ScriptedModel([[assistantMessage("上传完成。")]])
  );
  await restartedRunner.resume({
    actionContext,
    confirmation: confirmation!,
    decision: "approve",
    runId: "run-restart"
  });

  expect(upload).toHaveBeenCalledTimes(1);
});

test("returns tool execution failure to the model", async () => {
  const model = new ScriptedModel([
    [functionCall("panel_open", { panel: "settings" }, { callId: "call-fail" })],
    modelResponder(({ request }) => {
      expect(JSON.stringify(request.input)).toContain("execution_failed");
      return [assistantMessage("设置面板打开失败。")];
    })
  ]);

  const result = await createRunner(model).run({
    actionContext: {
      applyPanelAction: () => {
        throw new Error("UI unavailable");
      },
      contextView: createContextView()
    },
    message: "打开设置",
    runId: "run-failure"
  });

  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: "UI unavailable", type: "action_failed" }),
    { message: "设置面板打开失败。", type: "assistant_reply" }
  ]));
});

test("adapts ModelGateway responses without bypassing provider policy", async () => {
  const generateAnswer = vi.fn(async () => ({
    answer: JSON.stringify({
      message: "",
      toolCalls: [{ argumentsJson: "{\"panel\":\"settings\"}", name: "panel_open" }]
    }),
    trace: {
      backend: "http_service" as const,
      endpoint: "https://proxy.example.test",
      mode: "live" as const,
      provider: "openai",
      source: "cloud_proxy" as const
    }
  }));
  const provider = createLiteasyModelProvider({
    gateway: { generateAnswer },
    model: "gpt-test",
    provider: "openai"
  });
  const model = await provider.getModel("gpt-test");
  const tools = createActionTools(getRegisteredActionMetadata()).slice(0, 1);

  const response = await model.getResponse({
    handoffs: [],
    input: "打开设置",
    modelSettings: {},
    outputType: "text",
    systemInstructions: "command",
    tools: tools.map((item) => ({
      description: item.description,
      name: item.name,
      parameters: item.parameters,
      strict: item.strict,
      type: "function"
    })),
    tracing: false
  });

  expect(generateAnswer).toHaveBeenCalledWith(expect.objectContaining({
    model: "gpt-test",
    provider: "openai",
    requireLive: true
  }));
  expect(response.output[0]).toMatchObject({ name: "panel_open", type: "function_call" });
});

import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import {
  createManagerCapabilityToolCatalog,
  executeManagerCapabilityTool,
  getManagerCapabilityToolName
} from "../app/features/agent-runtime/capabilityToolAdapter";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("discovers unavailable capabilities with reasons while exposing only executable manager tools", async () => {
  const registered = getRegisteredActionMetadata();
  const tools = createManagerCapabilityToolCatalog(registered);

  const unavailable = ["cloud.upload_documents", "cloud.sync_workspace", "workspace.delete_documents", "workspace.overwrite_documents", "workspace.batch_update_documents"];
  expect(tools.map((tool) => tool.actionId).sort()).toEqual(registered.map((action) => action.actionId).filter((id) => !unavailable.includes(id)).sort());
  for (const actionId of unavailable) expect(tools.some((tool) => tool.actionId === actionId)).toBe(false);
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: () => ({ message: "" }) });
  const result = await api.listCapabilities();
  if (!result.ok) throw new Error(result.error.message);
  for (const actionId of unavailable) expect(result.data.find((capability) => capability.actionId === actionId)).toMatchObject({ available: false, unavailableReason: expect.stringContaining("尚未接入获准执行器") });
  expect(result.data.find((capability) => capability.actionId === "layout.split_two")).toMatchObject({ available: true });
  api.dispose();
  expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
  expect(getManagerCapabilityToolName("artifact.generate")).toBe(
    "liteasy__artifact__generate"
  );
  expect(tools.find((tool) => tool.actionId === "artifact.generate")).toMatchObject({
    actionId: "artifact.generate",
    deferLoading: true,
    parameters: {
      required: ["artifactType", "source"],
      type: "object"
    },
    policy: {
      requiredContext: ["selected_document_set"],
      riskLevel: "low"
    },
    strict: false
  });
});

test("lets a manager invoke a safe capability through the existing executor in qa mode", async () => {
  const appliedPresets: unknown[] = [];
  const result = await executeManagerCapabilityTool(
    {
      actionId: "layout.split_two",
      arguments: { preset: "two_column" },
      toolCallId: "call-layout-1"
    },
    {
      applyLayoutPreset(input) {
        appliedPresets.push(input);
        return "已切换双栏布局";
      },
      runtimeInput: {
        message: "把阅读区并排放一下",
        mode: "qa"
      }
    }
  );

  expect(appliedPresets).toEqual([{ preset: "two_column" }]);
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: "已切换双栏布局", type: "assistant_reply" })
  ]));
});

test("derives dynamic approval from the registry policy instead of duplicating it", async () => {
  const settingsStore = createSettingsStore();
  const result = await executeManagerCapabilityTool(
    {
      actionId: "settings.update",
      arguments: { target: "profile.enabled", value: true },
      toolCallId: "call-profile-1"
    },
    {
      profileUnlocked: true,
      runtimeInput: {
        message: "以后按我的习惯回答",
        mode: "qa"
      },
      settingsStore
    }
  );

  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "confirmation_request" })
  ]));
});

test("rejects invalid tool arguments before calling a capability handler", async () => {
  let executionCount = 0;
  const result = await executeManagerCapabilityTool(
    {
      actionId: "layout.split_two",
      arguments: { preset: "unsupported" },
      toolCallId: "call-layout-invalid"
    },
    {
      applyLayoutPreset() {
        executionCount += 1;
        return "unexpected";
      }
    }
  );

  expect(executionCount).toBe(0);
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      message: "语义计划未通过动作契约校验。",
      type: "runtime_error"
    })
  ]));
});

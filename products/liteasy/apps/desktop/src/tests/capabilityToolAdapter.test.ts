import {
  createManagerCapabilityToolCatalog,
  executeManagerCapabilityTool,
  getManagerCapabilityToolName
} from "../app/features/agent-runtime/capabilityToolAdapter";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("projects the Liteasy registry into deferred manager tools", () => {
  const registered = getRegisteredActionMetadata();
  const tools = createManagerCapabilityToolCatalog(registered);

  expect(tools).toHaveLength(registered.length);
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

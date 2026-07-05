import { describe, expect, test } from "vitest";
import { buildIntentRuntimeContexts } from "../app/features/agent-runtime/contextBuilder";
import type { AgentRuntimeContextView } from "../app/features/agent-runtime/agentRuntime.types";

const contextView: AgentRuntimeContextView = {
  cloud: {
    connected: true,
    organizationName: "AI Reading Lab"
  },
  profile: {
    enabled: true,
    requiresConfirmation: true
  },
  selection: {
    importedCount: 2,
    issues: [],
    locked: true,
    ready: true,
    selectedCount: 2
  },
  workspace: {
    rootPath: "/tmp/LiteasyLibrary",
    type: "local_library"
  }
};

describe("ContextBuilder", () => {
  test("builds planner and policy contexts from a runtime execution context", () => {
    const bundle = buildIntentRuntimeContexts({
      contextView
    });

    expect(bundle.contextView).toBe(contextView);
    expect(bundle.plannerContext).toMatchObject({
      contextView,
      registeredActions: expect.arrayContaining([
        expect.objectContaining({
          actionId: "panel.open"
        }),
        expect.objectContaining({
          actionId: "profile.open_academic_archive"
        })
      ])
    });
    expect(bundle.policyContext).toMatchObject({
      contextView,
      registeredActions: expect.arrayContaining([
        expect.objectContaining({
          actionId: "cloud.sync_workspace",
          requiresConfirmation: true,
          riskLevel: "high"
        })
      ])
    });
  });
});

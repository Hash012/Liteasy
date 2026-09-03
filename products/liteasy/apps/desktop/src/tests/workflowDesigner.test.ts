import {
  createManagerCapabilityToolCatalog,
  executeManagerCapabilityTool
} from "../app/features/agent-runtime/capabilityToolAdapter";
import { executeConfirmedSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import {
  createWorkflowDesignerRuntime,
  createWorkflowDesignerToolCatalog,
  type UserWorkflowSnapshot
} from "../app/features/skills/workflowDesigner";
import { loadWorkflowSkill } from "../app/features/skills/workflowSkillRegistry";

function successfulThinReadingRun() {
  return {
    completedAt: "2026-08-02T00:00:00.000Z",
    input: {
      instruction: "只针对 BERT 这篇论文先看贡献，再检查实验"
    },
    resultSummary: "完成 BERT 薄读",
    runId: "run-thin-reading-success",
    skillId: "liteasy.thin-reading",
    skillVersion: "1.0.0",
    trace: {
      skillId: "liteasy.thin-reading",
      skillVersion: "1.0.0",
      steps: [{
        completedAt: "2026-08-02T00:00:00.000Z",
        id: "analyze-thin-reading",
        operatorId: "liteasy.agent.artifact-analysis",
        operatorVersion: "1.0.0"
      }],
      version: "liteasy.workflow-trace/v1" as const
    }
  };
}

test("publishes list and design tools without an implicit install action", () => {
  expect(createWorkflowDesignerToolCatalog()).toEqual([
    expect.objectContaining({
      name: "liteasy_workflow_list_successful_runs",
      strict: true
    }),
    expect.objectContaining({
      name: "liteasy_workflow_design_from_run",
      parameters: expect.objectContaining({
        additionalProperties: false,
        required: ["description", "instructions", "name", "sourceRunId"]
      }),
      strict: true
    })
  ]);
});

test("distills a successful run into a parameterized pending draft", async () => {
  let persisted: UserWorkflowSnapshot | null = null;
  const ids = ["draft-designer-1", "replay-designer-1"];
  const designer = createWorkflowDesignerRuntime({
    createId: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-08-03T00:00:00.000Z"),
    store: {
      load: () => null,
      save: (snapshot) => {
        persisted = structuredClone(snapshot);
      }
    }
  });
  designer.recordSuccessfulRun(successfulThinReadingRun());

  await expect(designer.invokeTool({
    arguments: {},
    toolCallId: "list-call-1",
    toolName: "liteasy_workflow_list_successful_runs"
  })).resolves.toMatchObject({
    ok: true,
    runs: [{
      runId: "run-thin-reading-success",
      skillId: "liteasy.thin-reading",
      skillVersion: "1.0.0"
    }]
  });

  const proposal = await designer.invokeTool({
    arguments: {
      description: "先检查贡献与实验边界的通用薄读流程。",
      idHint: "systems-first-pass",
      instructions: "先提取主要贡献，再核对实验设计、边界和最关键的两张图。",
      name: "系统论文首轮检查",
      sourceRunId: "run-thin-reading-success"
    },
    toolCallId: "design-call-1",
    toolName: "liteasy_workflow_design_from_run"
  });
  if (!("draft" in proposal)) throw new Error("Expected a workflow draft");

  expect(proposal.draft).toMatchObject({
    draftId: "draft-designer-1",
    package: {
      manifest: {
        id: "user.systems-first-pass",
        permissions: ["artifact.write", "network.retrieve", "paper.figure.read", "paper.read"],
        version: "1.0.0"
      }
    },
    replayCase: {
      expectedOperatorIds: ["liteasy.agent.artifact-analysis@1.0.0"],
      input: {
        instruction: "请按这个可复用流程分析当前论文"
      }
    },
    replayEvaluation: {
      checks: [
        { id: "input_schema", status: "passed" },
        { id: "operator_chain", status: "passed" },
        { id: "output_schema", status: "passed" },
        { id: "permission_closure", status: "passed" }
      ],
      status: "passed",
      version: "liteasy.workflow-replay-evaluation/v1"
    },
    status: "pending_approval"
  });
  expect(JSON.stringify(proposal.draft.package)).not.toContain("BERT");
  expect(persisted).toMatchObject({
    drafts: [expect.objectContaining({ draftId: "draft-designer-1" })],
    packages: [],
    version: "liteasy.user-workflows/v1"
  });
});

test("installs a draft only after the existing human confirmation boundary", async () => {
  const ids = ["draft-designer-approval", "replay-designer-approval"];
  const designer = createWorkflowDesignerRuntime({
    createId: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-08-04T00:00:00.000Z")
  });
  designer.recordSuccessfulRun(successfulThinReadingRun());
  const proposal = await designer.invokeTool({
    arguments: {
      description: "通用贡献优先薄读。",
      idHint: "designer-approval-test",
      instructions: "先看贡献，再看实验边界。",
      name: "贡献优先薄读",
      sourceRunId: "run-thin-reading-success"
    },
    toolCallId: "design-call-approval",
    toolName: "liteasy_workflow_design_from_run"
  });
  if (!("draft" in proposal)) throw new Error("Expected a workflow draft");

  const installTool = createManagerCapabilityToolCatalog().find(
    (tool) => tool.actionId === "workflow.install_draft"
  );
  expect(installTool).toMatchObject({
    policy: {
      requiresConfirmation: true,
      riskLevel: "medium"
    }
  });
  const pending = await executeManagerCapabilityTool({
    actionId: "workflow.install_draft",
    arguments: { draftId: proposal.draft.draftId },
    toolCallId: "install-call-1"
  }, {
    installWorkflowDraft: ({ draftId }) => designer.installDraft(draftId)
  });
  const confirmation = pending.events.find(
    (event) => event.type === "confirmation_request" && "plan" in event
  );
  expect(confirmation).toMatchObject({
    action: {
      actionId: "workflow.install_draft",
      payload: { draftId: "draft-designer-approval" }
    }
  });
  await expect(designer.getDraft(proposal.draft.draftId)).resolves.toMatchObject({
    status: "pending_approval"
  });
  if (!confirmation || confirmation.type !== "confirmation_request" || !("plan" in confirmation)) {
    throw new Error("Expected a human confirmation");
  }

  const installed = await executeConfirmedSemanticPlan(confirmation, {
    installWorkflowDraft: ({ draftId }) => designer.installDraft(draftId)
  });
  expect(installed.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      message: expect.stringContaining("已安装工作流"),
      type: "assistant_reply"
    })
  ]));
  await expect(designer.getDraft(proposal.draft.draftId)).resolves.toMatchObject({
    status: "installed"
  });
  expect(loadWorkflowSkill("user.designer-approval-test", "1.0.0").manifest.name)
    .toBe("贡献优先薄读");
});

test("rejects invented source runs and malformed designer arguments", async () => {
  const designer = createWorkflowDesignerRuntime();
  await expect(designer.invokeTool({
    arguments: {
      description: "不存在的来源。",
      instructions: "生成一个流程。",
      name: "无来源流程",
      sourceRunId: "run-invented"
    },
    toolCallId: "design-call-missing",
    toolName: "liteasy_workflow_design_from_run"
  })).rejects.toThrow("workflow_designer_source_run_not_found");

  await expect(designer.invokeTool({
    arguments: { extra: true },
    toolCallId: "list-call-invalid",
    toolName: "liteasy_workflow_list_successful_runs"
  })).rejects.toThrow("workflow_designer_arguments_invalid");
});

test("restores installed user workflows from the persisted snapshot", async () => {
  let persisted: UserWorkflowSnapshot | null = null;
  const ids = ["draft-persisted-workflow", "replay-persisted-workflow"];
  const first = createWorkflowDesignerRuntime({
    createId: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-08-05T00:00:00.000Z"),
    store: {
      load: () => null,
      save: (snapshot) => {
        persisted = structuredClone(snapshot);
      }
    }
  });
  first.recordSuccessfulRun(successfulThinReadingRun());
  const proposal = await first.invokeTool({
    arguments: {
      description: "可持久化的薄读流程。",
      idHint: "designer-persistence-test",
      instructions: "先看问题定义，再检查核心实验。",
      name: "持久化薄读流程",
      sourceRunId: "run-thin-reading-success"
    },
    toolCallId: "design-persistence",
    toolName: "liteasy_workflow_design_from_run"
  });
  if (!("draft" in proposal)) throw new Error("Expected a workflow draft");
  await first.installDraft(proposal.draft.draftId);
  expect(persisted).not.toBeNull();

  const restored = createWorkflowDesignerRuntime({
    store: {
      load: () => structuredClone(persisted),
      save: () => undefined
    }
  });
  await restored.restore();
  await expect(restored.listInstalled()).resolves.toEqual([
    expect.objectContaining({
      manifest: expect.objectContaining({
        id: "user.designer-persistence-test",
        name: "持久化薄读流程"
      })
    })
  ]);
  await expect(restored.getDraft("draft-persisted-workflow")).resolves.toMatchObject({
    replayEvaluation: { status: "passed" },
    status: "installed"
  });
});

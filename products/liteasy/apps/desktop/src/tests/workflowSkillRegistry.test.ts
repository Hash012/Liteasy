import {
  executeWorkflowSkill,
  getWorkflowOperatorDefinitions,
  listWorkflowSkills,
  loadWorkflowSkill,
  registerWorkflowSkill,
  THIN_READING_WORKFLOW_SKILL_ID
} from "../app/features/skills/workflowSkillRegistry";

test("publishes versioned workflow skills over stable operators", () => {
  expect(listWorkflowSkills()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "settings.adjust",
      operatorIds: ["liteasy.settings.adjust@1.0.0"],
      version: "1.0.0"
    }),
    expect.objectContaining({
      id: THIN_READING_WORKFLOW_SKILL_ID,
      operatorIds: ["liteasy.agent.artifact-analysis@1.0.0"],
      permissions: expect.arrayContaining(["artifact.write", "paper.read"]),
      version: "1.0.0"
    })
  ]));
  expect(getWorkflowOperatorDefinitions()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "liteasy.agent.artifact-analysis",
      version: "1.0.0"
    })
  ]));
});

test("executes Thin Read through its declared operator and records a versioned trace", async () => {
  const observed: Array<{
    artifactType: string;
    instruction: string;
    workflowInstructions: string;
  }> = [];
  const result = await executeWorkflowSkill<{ message: string }>({
    input: { instruction: "先看贡献，再检查实验边界" },
    skillId: THIN_READING_WORKFLOW_SKILL_ID,
    version: "1.0.0"
  }, {
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    runArtifactAnalysis: async (input) => {
      observed.push(input);
      return { message: "薄读任务已完成" };
    }
  });

  expect(observed).toEqual([{
    artifactType: "thin_reading",
    instruction: "先看贡献，再检查实验边界",
    workflowInstructions: expect.stringContaining("证据约束的薄读")
  }]);
  expect(result).toEqual({
    output: { message: "薄读任务已完成" },
    trace: {
      skillId: "liteasy.thin-reading",
      skillVersion: "1.0.0",
      steps: [{
        completedAt: "2026-08-01T00:00:00.000Z",
        id: "analyze-thin-reading",
        operatorId: "liteasy.agent.artifact-analysis",
        operatorVersion: "1.0.0"
      }],
      version: "liteasy.workflow-trace/v1"
    }
  });
});

test("registers a Thin Read variant without changing the stable operator", async () => {
  const variant = loadWorkflowSkill(THIN_READING_WORKFLOW_SKILL_ID, "1.0.0");
  const variantInstruction = "先看贡献，再看实验，只保留最关键的两张图。";
  variant.instructions = variantInstruction;
  variant.manifest = {
    ...variant.manifest,
    description: "Contribution-first Thin Read variant.",
    id: "test.thin-reading.contribution-first",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object"
    },
    name: "Contribution-first Thin Read",
    steps: [{
      ...variant.manifest.steps[0],
      input: {
        artifactType: { source: "literal", value: "thin_reading" },
        instruction: {
          source: "literal",
          value: variantInstruction
        }
      }
    }]
  };
  registerWorkflowSkill(variant);

  const instructions: string[] = [];
  const result = await executeWorkflowSkill<{ message: string }>({
    input: {},
    skillId: variant.manifest.id
  }, {
    runArtifactAnalysis: ({ instruction, workflowInstructions }) => {
      instructions.push(instruction);
      expect(workflowInstructions).toBe(variantInstruction);
      return { message: "已执行自定义薄读" };
    }
  });

  expect(instructions).toEqual([variantInstruction]);
  expect(result.trace).toMatchObject({
    skillId: "test.thin-reading.contribution-first",
    skillVersion: "1.0.0"
  });
});

test("rejects undeclared permissions and invocation fields", async () => {
  const invalid = loadWorkflowSkill(THIN_READING_WORKFLOW_SKILL_ID, "1.0.0");
  invalid.manifest = {
    ...invalid.manifest,
    id: "test.thin-reading.unsafe",
    permissions: ["paper.read"]
  };
  expect(() => registerWorkflowSkill(invalid)).toThrow("workflow_skill_permission_missing");

  await expect(executeWorkflowSkill({
    input: { extra: true, instruction: "生成薄读" },
    skillId: THIN_READING_WORKFLOW_SKILL_ID
  }, {
    runArtifactAnalysis: () => ({ message: "不应执行" })
  })).rejects.toThrow("workflow_schema_invalid");
});

test("rejects malformed persisted workflow packages before registration", () => {
  expect(() => registerWorkflowSkill({
    instructions: "malformed",
    manifest: {
      abiVersion: "liteasy.workflow-skill/v1",
      id: "test.malformed"
    }
  })).toThrow("workflow_skill_manifest_invalid");

  const unknownField = loadWorkflowSkill(THIN_READING_WORKFLOW_SKILL_ID, "1.0.0") as unknown as {
    debug?: boolean;
  };
  unknownField.debug = true;
  expect(() => registerWorkflowSkill(unknownField)).toThrow("workflow_skill_manifest_invalid");
});

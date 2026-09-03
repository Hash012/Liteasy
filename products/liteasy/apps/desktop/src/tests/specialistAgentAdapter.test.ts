import {
  createSpecialistAgentExecutionRequest,
  createSpecialistAgentToolCatalog
} from "../app/features/agent-runtime/specialistAgentAdapter";

test("projects Thin Read and multimodal workflows as structured agent tools", () => {
  const catalog = createSpecialistAgentToolCatalog();

  expect(catalog).toHaveLength(2);
  expect(catalog).toEqual(expect.arrayContaining([
    expect.objectContaining({
      agent: expect.objectContaining({ id: "thin_reading" }),
      asTool: expect.objectContaining({
        strict: true,
        toolName: "liteasy_thin_reading_agent"
      }),
      supportedArtifactTypes: ["thin_reading"],
      workflow: {
        skillId: "liteasy.thin-reading",
        version: "1.0.0"
      }
    }),
    expect.objectContaining({
      agent: expect.objectContaining({ id: "multimodal" }),
      asTool: expect.objectContaining({
        parameters: expect.objectContaining({
          additionalProperties: false,
          required: ["artifactType", "instruction"]
        }),
        strict: true,
        toolName: "liteasy_multimodal_agent"
      }),
      supportedArtifactTypes: [
        "comparison_table",
        "layered_graph",
        "mindmap",
        "ppt",
        "tree"
      ],
      workflow: {
        skillId: "liteasy.multimodal-artifact",
        version: "1.0.0"
      }
    })
  ]));
});

test("maps Thin Read specialist calls to the existing thin_reading workflow", () => {
  expect(createSpecialistAgentExecutionRequest({
    arguments: { instruction: "  先讲贡献，再检查实验限制  " },
    specialistId: "thin_reading",
    toolCallId: "thin-call-1"
  })).toEqual({
    artifactType: "thin_reading",
    instruction: "先讲贡献，再检查实验限制",
    specialistId: "thin_reading",
    toolCallId: "thin-call-1",
    workflow: {
      input: { instruction: "先讲贡献，再检查实验限制" },
      skillId: "liteasy.thin-reading",
      version: "1.0.0"
    }
  });
});

test("maps multimodal specialist calls to the requested existing workflow", () => {
  expect(createSpecialistAgentExecutionRequest({
    arguments: {
      artifactType: "comparison_table",
      instruction: "按假设、实验和支持程度比较"
    },
    specialistId: "multimodal",
    toolCallId: "multimodal-call-1"
  })).toEqual({
    artifactType: "comparison_table",
    instruction: "按假设、实验和支持程度比较",
    specialistId: "multimodal",
    toolCallId: "multimodal-call-1",
    workflow: {
      input: {
        artifactType: "comparison_table",
        instruction: "按假设、实验和支持程度比较"
      },
      skillId: "liteasy.multimodal-artifact",
      version: "1.0.0"
    }
  });
});

test("rejects invalid specialist tool arguments before workflow execution", () => {
  expect(() => createSpecialistAgentExecutionRequest({
    arguments: { artifactType: "thin_reading", instruction: "生成产物" },
    specialistId: "multimodal",
    toolCallId: "multimodal-call-2"
  })).toThrow("Unsupported multimodal artifact type: thin_reading");

  expect(() => createSpecialistAgentExecutionRequest({
    arguments: { instruction: " " },
    specialistId: "thin_reading",
    toolCallId: "thin-call-2"
  })).toThrow("Specialist instruction must be a non-empty string");

  expect(() => createSpecialistAgentExecutionRequest({
    arguments: { extra: true, instruction: "生成薄读" },
    specialistId: "thin_reading",
    toolCallId: "thin-call-3"
  })).toThrow("Unexpected specialist arguments: extra");
});

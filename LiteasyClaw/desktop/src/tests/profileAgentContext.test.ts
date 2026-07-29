import { describe, expect, test } from "vitest";
import { defaultAgentCoreConfig } from "../app/features/agent-core/agentCoreConfig";
import { buildAgentCorePromptContext } from "../app/features/agent-core/contextAssembler";
import { buildAgentRuntimeContextView } from "../app/features/agent-runtime/contextView";
import {
  buildAcademicProfileAssistantSummary,
  defaultAcademicProfile
} from "../app/features/profile/profile.types";

describe("profile and Agent context boundary", () => {
  test("injects the selected disciplines and research stage", () => {
    const academicProfile = {
      ...defaultAcademicProfile,
      disciplines: [{
        categoryCode: "08",
        categoryName: "工学",
        code: "0812",
        description: "自然语言处理",
        name: "计算机科学与技术"
      }],
      stage: "博士研究生"
    };
    const profileSummary = buildAcademicProfileAssistantSummary(academicProfile);
    const runtimeContext = buildAgentRuntimeContextView({
      academicProfile,
      importedCount: 1,
      profileEnabled: true,
      profilePersonalizationSummary: profileSummary,
      profileUnlocked: true,
      selectedCount: 1,
      selectionLocked: true
    });
    const prompt = buildAgentCorePromptContext({
      config: defaultAgentCoreConfig,
      memories: [],
      runtimeContext
    });

    expect(prompt.runtimeSummary).toContain("学术档案与当前关注：研究阶段：博士研究生；研究学科：工学 · 计算机科学与技术（自然语言处理）。");
  });
});

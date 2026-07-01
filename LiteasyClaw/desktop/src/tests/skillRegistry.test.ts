import { executeSkill } from "../app/features/skills/skillRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("executes the settings skill through a registered action", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeSkill(
    {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    },
    {
      settingsStore
    }
  );

  expect(result.message).toContain("联网推荐");
  expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(false);
});

test("executes the artifact skill through a registered action", async () => {
  const generated: string[] = [];

  const result = await executeSkill(
    {
      skillId: "artifact.generate",
      input: {
        artifactType: "mindmap",
        source: "selected_document_set"
      }
    },
    {
      startArtifactAnalysis: (artifactType) => {
        generated.push(artifactType);
        return "已开始思维导图分析。";
      }
    }
  );

  expect(generated).toEqual(["mindmap"]);
  expect(result.message).toBe("已开始思维导图分析。");
});

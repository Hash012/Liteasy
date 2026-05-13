import { executeAction } from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("executes a settings update through the action registry", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeAction(
    {
      actionId: "settings.update",
      input: {
        target: "profile.enabled",
        value: true
      }
    },
    {
      settingsStore
    }
  );

  expect(result.message).toContain("用户画像");
  expect(settingsStore.getState()["profile.enabled"]).toBe(true);
});

test("executes a direct artifact analysis action without going through skill routing", async () => {
  const invoked: string[] = [];

  const result = await executeAction(
    {
      actionId: "artifact.start_analysis",
      input: {
        artifactType: "tree",
        source: "selected_document_set"
      }
    },
    {
      startArtifactAnalysis: (artifactType) => {
        invoked.push(artifactType);
        return "已按树形展开主干启动分析。";
      }
    }
  );

  expect(invoked).toEqual(["tree"]);
  expect(result.message).toBe("已按树形展开主干启动分析。");
});

test("executes a selected-document-set import action", async () => {
  let imported = 0;

  const result = await executeAction(
    {
      actionId: "selected_set.import",
      input: {
        source: "selected_document_set"
      }
    },
    {
      importSelectedSet: () => {
        imported += 1;
        return "已将当前选中文献集交给 AI 流程。";
      }
    }
  );

  expect(imported).toBe(1);
  expect(result.message).toBe("已将当前选中文献集交给 AI 流程。");
});

test("executes a cloud model policy sync action", async () => {
  let synced = 0;

  const result = await executeAction(
    {
      actionId: "settings.sync_model_policy",
      input: {
        source: "cloud_control_plane"
      }
    },
    {
      syncCloudPolicy: async () => {
        synced += 1;
        return "已从云端同步模型策略，当前以云端管理员下发配置为准。";
      }
    }
  );

  expect(synced).toBe(1);
  expect(result.message).toContain("已从云端同步模型策略");
});

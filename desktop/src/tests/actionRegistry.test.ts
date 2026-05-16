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
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(result.message).toContain("用户画像");
  expect(settingsStore.getState()["profile.enabled"]).toBe(true);
});

test("blocks profile actions when the cloud account is unavailable", async () => {
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
      profileUnlocked: false,
      settingsStore
    }
  );

  expect(result.message).toBe("请先登录云账号后再使用个人画像能力。");
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
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


test("executes an organization shared-library open action", async () => {
  let opened = 0;

  const result = await executeAction(
    {
      actionId: "organization.open_shared_library",
      input: {
        source: "organization_space"
      }
    },
    {
      openOrganizationSharedLibrary: () => {
        opened += 1;
        return "已打开组织共享文献库：组织共享文献库。";
      }
    }
  );

  expect(opened).toBe(1);
  expect(result.message).toBe("已打开组织共享文献库：组织共享文献库。");
});

test("keeps local-direct access disabled when policy has not allowed it", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeAction(
    {
      actionId: "settings.update",
      input: {
        target: "models.access_mode",
        value: "local_direct"
      }
    },
    {
      settingsStore
    }
  );

  expect(settingsStore.getState()["models.access_mode"]).toBe("cloud_proxy");
  expect(result.message).toContain("本地直连未开放");
  expect(result.message).toContain("模型：云代理");
});

test("returns a user-facing model status message when switching access mode", async () => {
  const settingsStore = createSettingsStore();
  settingsStore.apply({
    intent: "update_setting",
    target: "models.local_direct_enabled",
    value: true
  });

  const result = await executeAction(
    {
      actionId: "settings.update",
      input: {
        target: "models.access_mode",
        value: "local_direct"
      }
    },
    {
      settingsStore
    }
  );

  expect(settingsStore.getState()["models.access_mode"]).toBe("local_direct");
  expect(result.message).toContain("模型：本地直连");
});

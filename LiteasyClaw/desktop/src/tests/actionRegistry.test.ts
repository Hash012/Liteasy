import {
  executeAction,
  getRegisteredActionMetadata,
  getRuntimeActionPolicy
} from "../app/features/skills/actionRegistry";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("executes a settings update through the action registry", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeAction(
    {
      actionId: "settings.update",
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

test("requires a cloud account before enabling profile sampling", async () => {
  const settingsStore = createSettingsStore();
  const blocked = await executeAction(
    {
      actionId: "settings.update",
      input: { target: "profile.enabled", value: true }
    },
    { profileUnlocked: false, settingsStore }
  );

  expect(blocked.message).toBe("请先登录云账号后再使用个人画像能力。");
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);

  await executeAction(
    {
      actionId: "settings.update",
      input: { target: "profile.enabled", value: true }
    },
    { profileUnlocked: true, settingsStore }
  );
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

test("executes a semantic artifact generation action through the action registry", async () => {
  const invoked: string[] = [];

  const result = await executeAction(
    {
      actionId: "artifact.generate",
      input: {
        artifactType: "ppt",
        source: "selected_document_set"
      }
    },
    {
      startArtifactAnalysis: (artifactType) => {
        invoked.push(artifactType);
        return "已开始 PPT 分析。";
      }
    }
  );

  expect(invoked).toEqual(["ppt"]);
  expect(result.message).toBe("已开始 PPT 分析。");
});

test("registers thin reading across artifact generation capability metadata", () => {
  const metadata = getRegisteredActionMetadata();
  const generate = metadata.find((action) => action.actionId === "artifact.generate");
  const startAnalysis = metadata.find((action) => action.actionId === "artifact.start_analysis");
  const openTab = metadata.find((action) => action.actionId === "artifact.open_tab");

  expect(generate?.inputSchema.properties?.artifactType.enum).toContain("thin_reading");
  expect(startAnalysis?.inputSchema.properties?.artifactType.enum).toContain("thin_reading");
  expect(openTab?.inputSchema.properties?.artifactType.enum).toContain("thin_reading");
  expect(generate?.semantic?.frames).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        input: expect.objectContaining({ artifactType: "thin_reading" }),
        summary: "生成薄读"
      })
    ])
  );
});

test("exposes registered action metadata for runtime planning and safety checks", () => {
  const metadata = getRegisteredActionMetadata();

  expect(metadata.map((action) => action.actionId)).toEqual(
    expect.arrayContaining([
      "artifact.generate",
      "artifact.start_analysis",
      "artifact.open_tab",
      "layout.split_two",
      "layout.set_ratio",
      "layout.reset",
      "pane.focus",
      "dock.move_item",
      "theme.apply_preset",
      "theme.apply_generated",
      "theme.reset",
      "panel.open",
      "panel.close",
      "panel.toggle",
      "profile.open_academic_archive",
      "settings.update",
      "selected_set.import",
      "organization.open_shared_library",
      "recommendation.refresh",
      "collection.add",
      "workspace.delete_documents",
      "workspace.overwrite_documents",
      "workspace.batch_update_documents",
      "cloud.upload_documents",
      "cloud.sync_workspace"
    ])
  );
  expect(metadata.find((action) => action.actionId === "artifact.generate")).toMatchObject({
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low"
  });
  expect(metadata.find((action) => action.actionId === "dock.move_item")).toMatchObject({
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  });
  expect(metadata.find((action) => action.actionId === "theme.apply_generated")).toMatchObject({
    family: "theme",
    inverseActionId: "theme.reset",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  });
  expect(metadata.find((action) => action.actionId === "cloud.sync_workspace")).toMatchObject({
    requiredContext: ["workspace"],
    requiresConfirmation: true,
    riskLevel: "high"
  });
});

test("registers generated theme metadata for model-assisted theme planning", () => {
  const metadata = getRegisteredActionMetadata();
  const action = metadata.find((item) => item.actionId === "theme.apply_generated");

  expect(action).toMatchObject({
    family: "theme",
    inverseActionId: "theme.reset",
    requiresConfirmation: false,
    riskLevel: "low"
  });
  expect(action?.inputSchema.properties?.palette.type).toBe("object");
  expect(action?.inputSchema.properties?.buttons.type).toBe("object");
});

test("executes a dock move action through the dock layout owner", async () => {
  const moveDockItem = vi.fn(() => "已将 Liteasy Chat 移到下栏。");

  const result = await executeAction(
    {
      actionId: "dock.move_item",
      input: {
        itemId: "assistant",
        targetRegion: "bottom"
      }
    },
    {
      moveDockItem
    }
  );

  expect(moveDockItem).toHaveBeenCalledWith({
    itemId: "assistant",
    targetRegion: "bottom"
  });
  expect(result.message).toBe("已将 Liteasy Chat 移到下栏。");
});

test("executes a generated theme through the generated theme handler", async () => {
  const applyGeneratedTheme = vi.fn(() => "已根据命令生成冷静赛博实验室主题。");

  const result = await executeAction(
    {
      actionId: "theme.apply_generated",
      input: {
        buttons: {
          borderWidth: 1,
          fill: "solid",
          hoverLift: 2,
          radius: 5,
          shadow: "crisp",
          weight: "strong"
        },
        intent: "冷静的赛博实验室",
        name: "冷静赛博实验室",
        palette: {
          accent1: "#1B66B3",
          accent2: "#2F8F61",
          accent3: "#B06B19",
          ink1: "#101820",
          ink2: "#526071",
          line1: "#C7D3DF",
          line2: "#AEBCCD",
          paper0: "#F8FBFC",
          paper1: "#EEF5F8",
          paper2: "#E2EDF3"
        },
        scope: ["global", "buttons"]
      }
    },
    {
      applyGeneratedTheme
    }
  );

  expect(applyGeneratedTheme).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "冷静赛博实验室",
      scope: ["global", "buttons"]
    })
  );
  expect(result.message).toBe("已根据命令生成冷静赛博实验室主题。");
});

test("executes architecture action-catalog handlers through injected feature owners", async () => {
  await expect(
    executeAction(
      {
        actionId: "profile.open_academic_archive",
        input: {}
      },
      {
        openAcademicArchive: () => "已打开学术档案。"
      }
    )
  ).resolves.toEqual({
    message: "已打开学术档案。"
  });

  await expect(
    executeAction(
      {
        actionId: "pane.focus",
        input: {
          pane: "right"
        }
      },
      {
        focusPane: ({ pane }) => `已聚焦${pane}面板。`
      }
    )
  ).resolves.toEqual({
    message: "已聚焦right面板。"
  });
});

test("derives confirmation policy from registered action metadata", () => {
  expect(
    getRuntimeActionPolicy({
      actionId: "settings.update",
      input: { target: "profile.enabled", value: true }
    })
  ).toMatchObject({
    requiresConfirmation: true,
    riskLevel: "medium"
  });

  expect(
    getRuntimeActionPolicy({
      actionId: "settings.update",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    })
  ).toMatchObject({
    requiresConfirmation: false,
    riskLevel: "low"
  });

  expect(
    getRuntimeActionPolicy({
      actionId: "workspace.delete_documents",
      input: {
        scope: "selected_document_set"
      }
    })
  ).toMatchObject({
    requiresConfirmation: true,
    riskLevel: "high"
  });
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

test("executes a layout preset action through the action registry", async () => {
  const applyLayoutPreset = vi.fn(() => "已切换为双栏布局。");

  const result = await executeAction(
    {
      actionId: "layout.split_two",
      input: {
        preset: "two_column"
      }
    },
    {
      applyLayoutPreset
    }
  );

  expect(applyLayoutPreset).toHaveBeenCalledWith({
    preset: "two_column"
  });
  expect(result.message).toBe("已切换为双栏布局。");
});

test("executes a theme preset action through the action registry", async () => {
  const applyThemePreset = vi.fn(() => "已应用卡通风格。");

  const result = await executeAction(
    {
      actionId: "theme.apply_preset",
      input: {
        preset: "playful",
        tone: "cartoon"
      }
    },
    {
      applyThemePreset
    }
  );

  expect(applyThemePreset).toHaveBeenCalledWith({
    preset: "playful",
    tone: "cartoon"
  });
  expect(result.message).toBe("已应用卡通风格。");
});

test("executes a panel action through the action registry", async () => {
  const applyPanelAction = vi.fn(() => "已打开设置面板。");

  const result = await executeAction(
    {
      actionId: "panel.open",
      input: {
        panel: "settings"
      }
    },
    {
      applyPanelAction
    }
  );

  expect(applyPanelAction).toHaveBeenCalledWith({
    operation: "open",
    panel: "settings"
  });
  expect(result.message).toBe("已打开设置面板。");
});

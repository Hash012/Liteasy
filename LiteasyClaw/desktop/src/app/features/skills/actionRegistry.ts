import type { ArtifactType } from "../artifacts/artifact.types";
import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import { settingsRegistry } from "../settings/settingsRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";
import {
  parseGeneratedThemeInput,
  type GeneratedThemeInput
} from "../theme/generatedTheme";

export type SettingsStoreLike = {
  apply: (command: UpdateSettingCommand) => boolean | string;
  getState: () => Record<UpdateSettingCommand["target"], boolean | string>;
};

export type PanelActionTarget =
  | "bottom"
  | "left"
  | "library"
  | "organization"
  | "profile"
  | "right"
  | "settings";

export type DockMoveItemId = "assistant" | "library" | "organization" | "profile" | "settings";
export type DockMoveTargetRegion = "bottom" | "left" | "right";

export type ActionContext = {
  applyLayoutPreset?: (input: {
    preset?: "two_column" | "reading" | "focus";
  }) => string;
  applyLayoutRatio?: (input: {
    center?: number;
    left?: number;
    right?: number;
  }) => string;
  applyPanelAction?: (input: {
    operation: "close" | "open" | "toggle";
    panel: PanelActionTarget;
  }) => string;
  applyThemePreset?: (input: {
    preset?: "playful" | "default";
    tone?: "cartoon" | "quiet";
  }) => string;
  applyGeneratedTheme?: (input: GeneratedThemeInput) => string;
  moveDockItem?: (input: {
    itemId: DockMoveItemId;
    targetRegion: DockMoveTargetRegion;
  }) => string;
  addToCollection?: (input: {
    scope: "selected_document_set";
  }) => string | Promise<string>;
  focusPane?: (input: {
    pane: "bottom" | "center" | "left" | "right";
  }) => string;
  importSelectedSet?: () => string | Promise<string>;
  openAcademicArchive?: () => string;
  openArtifactTab?: (input: {
    artifactId?: string;
    artifactType?: ArtifactType;
  }) => string;
  openOrganizationSharedLibrary?: () => string | Promise<string>;
  profileUnlocked?: boolean;
  refreshRecommendations?: (input: {
    scope: "current_workspace" | "selected_document_set";
  }) => string | Promise<string>;
  settingsStore?: SettingsStoreLike;
  startArtifactAnalysis?: (artifactType: ArtifactType) => string;
};

export type ActionResult = {
  message: string;
};

function formatSettingValue(
  target: UpdateSettingCommand["target"],
  value: UpdateSettingCommand["value"]
) {
  if (target === "network.recommendation.sort_mode") {
    return value === "retrieved_at" ? "按检索时间" : "按关联度";
  }

  return String(value);
}

export type ActionInvocation =
  | {
      actionId: "artifact.generate";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "layout.split_two" | "layout.reset";
      input: {
        preset?: "two_column" | "reading" | "focus";
      };
    }
  | {
      actionId: "layout.set_ratio";
      input: {
        center?: number;
        left?: number;
        right?: number;
      };
    }
  | {
      actionId: "pane.focus";
      input: {
        pane: "bottom" | "center" | "left" | "right";
      };
    }
  | {
      actionId: "dock.move_item";
      input: {
        itemId: DockMoveItemId;
        targetRegion: DockMoveTargetRegion;
      };
    }
  | {
      actionId: "theme.apply_preset" | "theme.reset";
      input: {
        preset?: "playful" | "default";
        tone?: "cartoon" | "quiet";
      };
    }
  | {
      actionId: "theme.apply_generated";
      input: GeneratedThemeInput;
    }
  | {
      actionId: "panel.open" | "panel.close" | "panel.toggle";
      input: {
        panel: PanelActionTarget;
      };
    }
  | {
      actionId: "settings.update";
      input: {
        target: UpdateSettingCommand["target"];
        value: UpdateSettingCommand["value"];
      };
    }
  | {
      actionId: "selected_set.import";
      input: {
        source: "selected_document_set";
      };
    }
  | {
      actionId: "artifact.start_analysis";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "artifact.open_tab";
      input: {
        artifactId?: string;
        artifactType?: ArtifactType;
      };
    }
  | {
      actionId: "profile.open_academic_archive";
      input: Record<string, never>;
    }
  | {
      actionId: "recommendation.refresh";
      input: {
        scope: "current_workspace" | "selected_document_set";
      };
    }
  | {
      actionId: "collection.add";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    }
  | {
      actionId: "workspace.delete_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.overwrite_documents";
      input: {
        scope: "selected_document_set";
      };
    }
  | {
      actionId: "workspace.batch_update_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.upload_documents";
      input: {
        scope: "selected_document_set" | "current_workspace";
      };
    }
  | {
      actionId: "cloud.sync_workspace";
      input: {
        scope: "current_workspace";
      };
    };

export type JsonSchemaType = "array" | "boolean" | "number" | "object" | "string";

export type JsonSchema = {
  enum?: readonly unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  type: JsonSchemaType | readonly JsonSchemaType[];
};

export type CapabilityFamily =
  | "artifact"
  | "cloud"
  | "collection"
  | "dock"
  | "layout"
  | "organization"
  | "panel"
  | "plugin"
  | "profile"
  | "recommendation"
  | "selection"
  | "settings"
  | "theme"
  | "workspace";

export type CapabilityCost = "none" | "local_compute" | "cloud_tokens" | "paid_resource";

export type SemanticActionSignal = {
  aliases: string[];
  concept: string;
  required?: boolean;
  weight: number;
};

export type SemanticActionFrame = {
  clarificationLabel?: string;
  frameId: string;
  input: Record<string, unknown>;
  intentId: string;
  priority?: number;
  requiredContext?: string[];
  requiresConfirmation?: boolean;
  riskLevel?: ActionRiskLevel;
  signals: SemanticActionSignal[];
  summary: string;
};

export type SemanticRuntimeActionId = Exclude<ActionInvocation["actionId"], "artifact.start_analysis">;

export type SemanticAmbiguityGroup = {
  candidates: Array<{
    actionId: SemanticRuntimeActionId;
    input: Record<string, unknown>;
    label: string;
  }>;
  frameId: string;
  missing: string[];
  question: string;
  signals: SemanticActionSignal[];
};

export type CapabilityMetadata = {
  actionId: ActionInvocation["actionId"];
  estimatedCost: CapabilityCost;
  estimatedLatencyMs: number;
  failureRecovery: string;
  family: CapabilityFamily;
  inputSchema: JsonSchema;
  inverseActionId?: ActionInvocation["actionId"];
  label: string;
  outputSchema: JsonSchema;
  ownerFeature: CapabilityFamily;
  progressEvents?: string[];
  requiredContext: string[];
  requiresConfirmation: boolean;
  reversible: boolean;
  riskLevel: ActionRiskLevel;
  semantic?: {
    ambiguityGroups?: SemanticAmbiguityGroup[];
    frames: SemanticActionFrame[];
  };
};

export type RegisteredActionMetadata = CapabilityMetadata;

const emptyObjectSchema: JsonSchema = {
  properties: {},
  type: "object"
};

const actionResultSchema: JsonSchema = {
  properties: {
    message: {
      type: "string"
    }
  },
  required: ["message"],
  type: "object"
};

const selectedDocumentSetSchema: JsonSchema = {
  properties: {
    source: {
      enum: ["selected_document_set"],
      type: "string"
    }
  },
  required: ["source"],
  type: "object"
};

const selectedScopeSchema: JsonSchema = {
  properties: {
    scope: {
      enum: ["selected_document_set"],
      type: "string"
    }
  },
  required: ["scope"],
  type: "object"
};

const generatedThemePaletteSchema: JsonSchema = {
  properties: {
    accent1: { type: "string" },
    accent2: { type: "string" },
    accent3: { type: "string" },
    ink1: { type: "string" },
    ink2: { type: "string" },
    line1: { type: "string" },
    line2: { type: "string" },
    paper0: { type: "string" },
    paper1: { type: "string" },
    paper2: { type: "string" }
  },
  required: [
    "accent1",
    "accent2",
    "accent3",
    "ink1",
    "ink2",
    "line1",
    "line2",
    "paper0",
    "paper1",
    "paper2"
  ],
  type: "object"
};

const generatedThemeButtonsSchema: JsonSchema = {
  properties: {
    borderWidth: { type: "number" },
    fill: {
      enum: ["flat", "soft", "solid", "glass"],
      type: "string"
    },
    hoverLift: { type: "number" },
    radius: { type: "number" },
    shadow: {
      enum: ["none", "subtle", "raised", "crisp"],
      type: "string"
    },
    weight: {
      enum: ["quiet", "balanced", "strong"],
      type: "string"
    }
  },
  required: ["borderWidth", "fill", "hoverLift", "radius", "shadow", "weight"],
  type: "object"
};

const generatedThemeSurfacesSchema: JsonSchema = {
  properties: {
    blur: { type: "number" },
    surface1Alpha: { type: "number" },
    surface2Alpha: { type: "number" }
  },
  type: "object"
};

const generatedThemeInputSchema: JsonSchema = {
  properties: {
    buttons: generatedThemeButtonsSchema,
    density: {
      enum: ["compact", "comfortable", "spacious"],
      type: "string"
    },
    intent: { type: "string" },
    name: { type: "string" },
    palette: generatedThemePaletteSchema,
    rationale: { type: "string" },
    scope: {
      items: {
        enum: ["global", "reader", "panels", "tabs", "buttons", "floating_controls"],
        type: "string"
      },
      type: "array"
    },
    surfaces: generatedThemeSurfacesSchema
  },
  required: ["buttons", "intent", "name", "palette", "scope"],
  type: "object"
};

function capability(
  metadata: Omit<CapabilityMetadata, "failureRecovery" | "ownerFeature"> &
    Partial<Pick<CapabilityMetadata, "failureRecovery" | "ownerFeature">>
): CapabilityMetadata {
  return {
    ...metadata,
    failureRecovery:
      metadata.failureRecovery ?? `请检查 ${metadata.label} 的 ${metadata.actionId} action 是否已连接。`,
    ownerFeature: metadata.ownerFeature ?? metadata.family
  };
}

function semanticSignal(
  concept: string,
  aliases: string[],
  weight: number,
  required = false
): SemanticActionSignal {
  return {
    aliases,
    concept,
    required,
    weight
  };
}

const dockMoveVerbs = ["放到", "放在", "移到", "移动到", "挪到", "拖到", "停靠到", "放去"];
const dockMoveTargets: Array<{
  label: string;
  region: DockMoveTargetRegion;
  signal: SemanticActionSignal;
}> = [
  {
    label: "下栏",
    region: "bottom",
    signal: semanticSignal("target_bottom", ["下栏", "底栏", "下面", "下方", "底部"], 4, true)
  },
  {
    label: "左栏",
    region: "left",
    signal: semanticSignal("target_left", ["左栏", "左侧栏", "左边", "左侧"], 4, true)
  },
  {
    label: "右栏",
    region: "right",
    signal: semanticSignal("target_right", ["右栏", "右侧栏", "右边", "右侧"], 4, true)
  }
];
const dockMoveItems: Array<{
  itemId: DockMoveItemId;
  label: string;
  signal: SemanticActionSignal;
}> = [
  {
    itemId: "assistant",
    label: "Liteasy Chat",
    signal: semanticSignal("dock_item_assistant", ["AI 助手", "AI助手", "助手", "聊天助手", "Liteasy Chat"], 5, true)
  },
  {
    itemId: "library",
    label: "文献库",
    signal: semanticSignal("dock_item_library", ["文献库", "文献库面板", "library"], 5, true)
  },
  {
    itemId: "organization",
    label: "组织",
    signal: semanticSignal("dock_item_organization", ["组织", "组织面板", "团队空间"], 5, true)
  },
  {
    itemId: "profile",
    label: "个人中心",
    signal: semanticSignal("dock_item_profile", ["个人中心", "个人画像", "画像", "profile"], 5, true)
  },
  {
    itemId: "settings",
    label: "设置",
    signal: semanticSignal("dock_item_settings", ["设置", "设置面板", "settings"], 5, true)
  }
];

function createDockMoveSemanticFrames(): SemanticActionFrame[] {
  return dockMoveItems.flatMap((item) =>
    dockMoveTargets.map((target) => ({
      clarificationLabel: `移动${item.label}到${target.label}`,
      frameId: `dock.move_item.${item.itemId}.${target.region}`,
      input: {
        itemId: item.itemId,
        targetRegion: target.region
      },
      intentId: "dock.move_item",
      signals: [
        semanticSignal("dock_move", dockMoveVerbs, 3, true),
        item.signal,
        target.signal
      ],
      summary: `移动${item.label}到${target.label}`
    }))
  );
}

const registeredActionMetadata: RegisteredActionMetadata[] = [
  capability({
    actionId: "artifact.generate",
    estimatedCost: "local_compute",
    estimatedLatencyMs: 3000,
    family: "artifact",
    inputSchema: {
      properties: {
        artifactType: {
          enum: ["comparison_table", "layered_graph", "mindmap", "tree", "ppt"],
          type: "string"
        },
        source: {
          enum: ["selected_document_set"],
          type: "string"
        }
      },
      required: ["artifactType", "source"],
      type: "object"
    },
    label: "生成多模态产物",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started", "task_created"],
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    reversible: false,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "生成思维导图",
          frameId: "artifact.generate.mindmap",
          input: {
            artifactType: "mindmap",
            source: "selected_document_set"
          },
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("create", ["生成", "制作", "做", "解释", "梳理"], 1),
            semanticSignal("mindmap", ["思维导图", "脑图", "mindmap"], 4, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "当前论文", "选中文献", "这组论文"], 1)
          ],
          summary: "生成思维导图"
        },
        {
          clarificationLabel: "生成分层关系图",
          frameId: "artifact.generate.layered_graph",
          input: {
            artifactType: "layered_graph",
            source: "selected_document_set"
          },
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("create", ["生成", "制作", "做", "梳理"], 1),
            semanticSignal("layered_graph", ["分层关系图", "分层图", "Obsidian", "星图", "关系网络"], 4, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "当前论文", "选中文献", "这组论文"], 1)
          ],
          summary: "生成分层关系图"
        },
        {
          clarificationLabel: "生成对比表",
          frameId: "artifact.generate.comparison_table",
          input: {
            artifactType: "comparison_table",
            source: "selected_document_set"
          },
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("create", ["生成", "制作", "做", "整理"], 1),
            semanticSignal("comparison_table", ["对比表", "对比矩阵", "comparison table"], 4, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "当前论文", "选中文献", "这组论文"], 1)
          ],
          summary: "生成对比表"
        },
        {
          clarificationLabel: "生成树状图",
          frameId: "artifact.generate.tree",
          input: {
            artifactType: "tree",
            source: "selected_document_set"
          },
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("create", ["生成", "制作", "做", "展开"], 1),
            semanticSignal("tree", ["树状图", "树图", "tree"], 4, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "当前论文", "选中文献", "这组论文"], 1)
          ],
          summary: "生成树状图"
        },
        {
          clarificationLabel: "生成 PPT",
          frameId: "artifact.generate.ppt",
          input: {
            artifactType: "ppt",
            source: "selected_document_set"
          },
          intentId: "artifact.generate",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("create", ["生成", "制作", "做", "整理"], 1),
            semanticSignal("ppt", ["PPT", "ppt", "演示文稿", "幻灯片"], 4, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "当前论文", "选中文献", "这组论文"], 1)
          ],
          summary: "生成 PPT"
        }
      ]
    }
  }),
  capability({
    actionId: "artifact.start_analysis",
    estimatedCost: "local_compute",
    estimatedLatencyMs: 3000,
    family: "artifact",
    inputSchema: {
      properties: {
        artifactType: {
          enum: ["comparison_table", "layered_graph", "mindmap", "tree", "ppt"],
          type: "string"
        },
        source: {
          enum: ["selected_document_set"],
          type: "string"
        }
      },
      required: ["artifactType", "source"],
      type: "object"
    },
    label: "启动产物分析",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started", "task_created"],
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    reversible: false,
    riskLevel: "low"
  }),
  capability({
    actionId: "artifact.open_tab",
    estimatedCost: "none",
    estimatedLatencyMs: 120,
    family: "artifact",
    inputSchema: {
      properties: {
        artifactId: {
          type: "string"
        },
        artifactType: {
          enum: ["comparison_table", "layered_graph", "mindmap", "tree", "ppt"],
          type: "string"
        }
      },
      type: "object"
    },
    label: "打开多模态产物标签页",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "layout.split_two",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "layout",
    inputSchema: {
      properties: {
        preset: {
          enum: ["two_column", "reading", "focus"],
          type: "string"
        }
      },
      type: "object"
    },
    inverseActionId: "layout.reset",
    label: "切换双栏布局",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "切换双栏布局",
          frameId: "layout.split_two.two_column",
          input: {
            preset: "two_column"
          },
          intentId: "layout.change",
          signals: [
            semanticSignal("layout_change", ["切分", "切成", "分成", "切换", "布局"], 2),
            semanticSignal("two_column", ["两个", "双栏", "两栏", "two column"], 4, true),
            semanticSignal("workspace_window", ["窗口", "工作台", "界面"], 1)
          ],
          summary: "切换为双栏布局"
        }
      ]
    }
  }),
  capability({
    actionId: "layout.set_ratio",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "layout",
    inputSchema: {
      properties: {
        center: {
          type: "number"
        },
        left: {
          type: "number"
        },
        right: {
          type: "number"
        }
      },
      type: "object"
    },
    inverseActionId: "layout.reset",
    label: "调整工作台栏宽比例",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "layout.reset",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "layout",
    inputSchema: emptyObjectSchema,
    label: "恢复默认布局",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "pane.focus",
    estimatedCost: "none",
    estimatedLatencyMs: 100,
    family: "panel",
    inputSchema: {
      properties: {
        pane: {
          enum: ["bottom", "center", "left", "right"],
          type: "string"
        }
      },
      required: ["pane"],
      type: "object"
    },
    label: "聚焦工作台面板",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "dock.move_item",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "dock",
    inputSchema: {
      properties: {
        itemId: {
          enum: ["assistant", "library", "organization", "profile", "settings"],
          type: "string"
        },
        targetRegion: {
          enum: ["bottom", "left", "right"],
          type: "string"
        }
      },
      required: ["itemId", "targetRegion"],
      type: "object"
    },
    label: "移动 Dock 标签页",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: createDockMoveSemanticFrames()
    }
  }),
  capability({
    actionId: "theme.apply_preset",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "theme",
    inputSchema: {
      properties: {
        preset: {
          enum: ["playful", "default"],
          type: "string"
        },
        tone: {
          enum: ["cartoon", "quiet"],
          type: "string"
        }
      },
      type: "object"
    },
    inverseActionId: "theme.reset",
    label: "应用界面风格",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "应用卡通风格",
          frameId: "theme.apply_preset.playful",
          input: {
            preset: "playful",
            tone: "cartoon"
          },
          intentId: "theme.apply",
          signals: [
            semanticSignal("theme_change", ["变成", "切换", "应用", "换成"], 1),
            semanticSignal("cartoon_tone", ["卡通风格", "卡通 UI", "卡通", "cartoon"], 4, true),
            semanticSignal("ui", ["UI", "界面", "风格"], 1)
          ],
          summary: "应用卡通风格"
        }
      ]
    }
  }),
  capability({
    actionId: "theme.apply_generated",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "theme",
    inputSchema: generatedThemeInputSchema,
    inverseActionId: "theme.reset",
    label: "根据命令生成界面风格",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "theme.reset",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "theme",
    inputSchema: emptyObjectSchema,
    label: "恢复默认界面风格",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "panel.open",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "panel",
    inputSchema: {
      properties: {
        panel: {
          enum: ["bottom", "left", "library", "organization", "profile", "right", "settings"],
          type: "string"
        }
      },
      required: ["panel"],
      type: "object"
    },
    label: "打开面板",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      ambiguityGroups: [
        {
          candidates: [
            {
              actionId: "panel.open",
              input: {
                panel: "organization"
              },
              label: "打开组织面板"
            },
            {
              actionId: "organization.open_shared_library",
              input: {
                source: "organization_space"
              },
              label: "打开组织共享文献库"
            }
          ],
          frameId: "organization.open.broad",
          missing: ["ambiguous_action"],
          question: "“打开组织”可能指打开组织面板，也可能指打开组织共享文献库。请选择要执行的动作。",
          signals: [
            semanticSignal("open", ["打开", "进入", "展开"], 2, true),
            semanticSignal("organization", ["组织", "团队空间", "机构"], 4, true)
          ]
        }
      ],
      frames: [
        {
          clarificationLabel: "打开设置面板",
          frameId: "panel.open.settings",
          input: {
            panel: "settings"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "进入", "展开", "显示"], 2, true),
            semanticSignal("settings_panel", ["设置面板", "设置页", "设置"], 4, true)
          ],
          summary: "打开设置面板"
        },
        {
          clarificationLabel: "打开文献库面板",
          frameId: "panel.open.library",
          input: {
            panel: "library"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "进入", "展开", "显示", "回到"], 2, true),
            semanticSignal("library_panel", ["文献库面板", "文献库", "library"], 4, true)
          ],
          summary: "打开文献库面板"
        },
        {
          clarificationLabel: "打开个人中心",
          frameId: "panel.open.profile",
          input: {
            panel: "profile"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "进入", "展开", "显示"], 2, true),
            semanticSignal("profile_panel", ["个人中心面板", "个人中心", "个人画像面板", "个人画像", "画像"], 4, true)
          ],
          summary: "打开个人中心"
        },
        {
          clarificationLabel: "打开组织面板",
          frameId: "panel.open.organization",
          input: {
            panel: "organization"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "进入", "展开", "显示"], 2, true),
            semanticSignal("organization_panel", ["组织面板", "组织页"], 4, true)
          ],
          summary: "打开组织面板"
        },
        {
          clarificationLabel: "打开左栏",
          frameId: "panel.open.left",
          input: {
            panel: "left"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "展开", "显示"], 2, true),
            semanticSignal("left_panel", ["左栏", "左侧栏"], 4, true)
          ],
          summary: "打开左栏"
        },
        {
          clarificationLabel: "打开右栏",
          frameId: "panel.open.right",
          input: {
            panel: "right"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("open", ["打开", "展开", "显示"], 2, true),
            semanticSignal("right_panel", ["右栏", "右侧栏", "AI 助手", "AI助手"], 4, true)
          ],
          summary: "打开右栏"
        }
      ]
    }
  }),
  capability({
    actionId: "panel.close",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "panel",
    inputSchema: {
      properties: {
        panel: {
          enum: ["bottom", "left", "library", "organization", "profile", "right", "settings"],
          type: "string"
        }
      },
      required: ["panel"],
      type: "object"
    },
    label: "关闭面板",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "关闭左栏",
          frameId: "panel.close.left",
          input: {
            panel: "left"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("close", ["关闭", "收起", "隐藏"], 2, true),
            semanticSignal("left_panel", ["左栏", "左侧栏"], 4, true)
          ],
          summary: "关闭左栏"
        },
        {
          clarificationLabel: "关闭右栏",
          frameId: "panel.close.right",
          input: {
            panel: "right"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("close", ["关闭", "收起", "隐藏"], 2, true),
            semanticSignal("right_panel", ["右栏", "右侧栏", "AI 助手", "AI助手"], 4, true)
          ],
          summary: "关闭右栏"
        },
        {
          clarificationLabel: "关闭下栏",
          frameId: "panel.close.bottom",
          input: {
            panel: "bottom"
          },
          intentId: "panel.change",
          signals: [
            semanticSignal("close", ["关闭", "收起", "隐藏"], 2, true),
            semanticSignal("bottom_panel", ["下栏", "底栏", "产物区"], 4, true)
          ],
          summary: "关闭下栏"
        }
      ]
    }
  }),
  capability({
    actionId: "panel.toggle",
    estimatedCost: "none",
    estimatedLatencyMs: 150,
    family: "panel",
    inputSchema: {
      properties: {
        panel: {
          enum: ["bottom", "left", "library", "organization", "profile", "right", "settings"],
          type: "string"
        }
      },
      required: ["panel"],
      type: "object"
    },
    label: "切换面板",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "settings.update",
    estimatedCost: "none",
    estimatedLatencyMs: 250,
    family: "settings",
    inputSchema: {
      properties: {
        target: {
          enum: Object.keys(settingsRegistry),
          type: "string"
        },
        value: {
          type: ["boolean", "string"]
        }
      },
      required: ["target", "value"],
      type: "object"
    },
    label: "更新设置",
    outputSchema: actionResultSchema,
    requiredContext: [],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "关闭联网推荐",
          frameId: "settings.update.network_recommendation.disable",
          input: {
            target: "network.recommendation.enabled",
            value: false
          },
          intentId: "settings.update",
          signals: [
            semanticSignal("disable", ["关闭", "停用", "禁用", "不要", "别再"], 3, true),
            semanticSignal("network_recommendation", ["联网推荐", "联网文献推荐"], 4, true)
          ],
          summary: "关闭联网推荐"
        },
        {
          clarificationLabel: "开启联网推荐",
          frameId: "settings.update.network_recommendation.enable",
          input: {
            target: "network.recommendation.enabled",
            value: true
          },
          intentId: "settings.update",
          signals: [
            semanticSignal("enable", ["开启", "打开", "启用", "恢复", "重新开启"], 3, true),
            semanticSignal("network_recommendation", ["联网推荐", "联网文献推荐"], 4, true)
          ],
          summary: "开启联网推荐"
        },
        {
          clarificationLabel: "按关联度排序推荐",
          frameId: "settings.update.network_recommendation.sort_relevance",
          input: {
            target: "network.recommendation.sort_mode",
            value: "relevance"
          },
          intentId: "settings.update",
          signals: [
            semanticSignal("sort", ["排序", "排"], 2, true),
            semanticSignal("relevance", ["关联度", "相关度", "相关性"], 4, true),
            semanticSignal("recommendation", ["推荐", "文献推荐", "联网推荐"], 2, true)
          ],
          summary: "按关联度排序推荐"
        },
        {
          clarificationLabel: "按检索时间排序推荐",
          frameId: "settings.update.network_recommendation.sort_retrieved_at",
          input: {
            target: "network.recommendation.sort_mode",
            value: "retrieved_at"
          },
          intentId: "settings.update",
          signals: [
            semanticSignal("sort", ["排序", "排"], 2, true),
            semanticSignal("retrieved_at", ["检索时间", "获取时间", "拉取时间", "时间"], 4, true),
            semanticSignal("recommendation", ["推荐", "文献推荐", "联网推荐"], 2, true)
          ],
          summary: "按检索时间排序推荐"
        },
      ]
    }
  }),
  capability({
    actionId: "selected_set.import",
    estimatedCost: "local_compute",
    estimatedLatencyMs: 2500,
    family: "selection",
    inputSchema: selectedDocumentSetSchema,
    label: "导入当前选中文献集",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started"],
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    reversible: false,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "导入当前选中文献集",
          frameId: "selected_set.import.current",
          input: {
            source: "selected_document_set"
          },
          intentId: "selected_set.import",
          requiredContext: ["selected_document_set"],
          signals: [
            semanticSignal("import", ["导入", "解析", "索引", "交给 AI 流程", "交给AI流程"], 3, true),
            semanticSignal("selected_document_set", ["当前选中文献集", "选中文献集", "当前论文", "选中文献", "当前文献", "这组论文"], 4, true)
          ],
          summary: "导入当前选中文献集"
        }
      ]
    }
  }),
  capability({
    actionId: "organization.open_shared_library",
    estimatedCost: "cloud_tokens",
    estimatedLatencyMs: 700,
    family: "organization",
    inputSchema: {
      properties: {
        source: {
          enum: ["organization_space"],
          type: "string"
        }
      },
      required: ["source"],
      type: "object"
    },
    label: "打开组织共享文献库",
    outputSchema: actionResultSchema,
    requiredContext: ["organization"],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "打开组织共享文献库",
          frameId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          },
          intentId: "organization.open_shared_library",
          requiredContext: ["organization"],
          signals: [
            semanticSignal("open", ["打开", "进入", "展开"], 2, true),
            semanticSignal("organization", ["组织", "团队空间", "机构"], 2),
            semanticSignal("shared_library", ["共享文献库", "组织共享文献库", "共享库"], 5, true)
          ],
          summary: "打开组织共享文献库"
        }
      ]
    }
  }),
  capability({
    actionId: "profile.open_academic_archive",
    estimatedCost: "none",
    estimatedLatencyMs: 120,
    family: "profile",
    inputSchema: emptyObjectSchema,
    label: "打开学术档案",
    outputSchema: actionResultSchema,
    requiredContext: ["profile"],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low",
    semantic: {
      frames: [
        {
          clarificationLabel: "打开学术档案",
          frameId: "profile.open_academic_archive",
          input: {},
          intentId: "profile.open_academic_archive",
          requiredContext: ["profile"],
          signals: [
            semanticSignal("open", ["打开", "进入", "查看"], 2),
            semanticSignal("academic_profile", ["学术人格", "学术画像", "profile"], 1),
            semanticSignal("academic_archive", ["学术档案", "学术人格档案", "档案"], 5, true)
          ],
          summary: "打开学术档案"
        }
      ]
    }
  }),
  capability({
    actionId: "recommendation.refresh",
    estimatedCost: "cloud_tokens",
    estimatedLatencyMs: 1200,
    family: "recommendation",
    inputSchema: {
      properties: {
        scope: {
          enum: ["current_workspace", "selected_document_set"],
          type: "string"
        }
      },
      required: ["scope"],
      type: "object"
    },
    label: "刷新文献推荐",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started"],
    requiredContext: ["workspace"],
    requiresConfirmation: false,
    reversible: false,
    riskLevel: "low"
  }),
  capability({
    actionId: "collection.add",
    estimatedCost: "none",
    estimatedLatencyMs: 250,
    family: "collection",
    inputSchema: selectedScopeSchema,
    label: "加入收藏",
    outputSchema: actionResultSchema,
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    reversible: true,
    riskLevel: "low"
  }),
  capability({
    actionId: "workspace.delete_documents",
    estimatedCost: "none",
    estimatedLatencyMs: 500,
    family: "workspace",
    inputSchema: selectedScopeSchema,
    label: "删除文献",
    outputSchema: actionResultSchema,
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    reversible: false,
    riskLevel: "high"
  }),
  capability({
    actionId: "workspace.overwrite_documents",
    estimatedCost: "none",
    estimatedLatencyMs: 500,
    family: "workspace",
    inputSchema: selectedScopeSchema,
    label: "覆盖文献",
    outputSchema: actionResultSchema,
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    reversible: false,
    riskLevel: "high"
  }),
  capability({
    actionId: "workspace.batch_update_documents",
    estimatedCost: "none",
    estimatedLatencyMs: 500,
    family: "workspace",
    inputSchema: {
      properties: {
        scope: {
          enum: ["selected_document_set", "current_workspace"],
          type: "string"
        }
      },
      required: ["scope"],
      type: "object"
    },
    label: "批量修改文献",
    outputSchema: actionResultSchema,
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    reversible: false,
    riskLevel: "high"
  }),
  capability({
    actionId: "cloud.upload_documents",
    estimatedCost: "cloud_tokens",
    estimatedLatencyMs: 1200,
    family: "cloud",
    inputSchema: {
      properties: {
        scope: {
          enum: ["selected_document_set", "current_workspace"],
          type: "string"
        }
      },
      required: ["scope"],
      type: "object"
    },
    label: "上传文献到云端",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started"],
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    reversible: false,
    riskLevel: "high"
  }),
  capability({
    actionId: "cloud.sync_workspace",
    estimatedCost: "cloud_tokens",
    estimatedLatencyMs: 1500,
    family: "cloud",
    inputSchema: {
      properties: {
        scope: {
          enum: ["current_workspace"],
          type: "string"
        }
      },
      required: ["scope"],
      type: "object"
    },
    label: "同步工作区到云端",
    outputSchema: actionResultSchema,
    progressEvents: ["progress_started"],
    requiredContext: ["workspace"],
    requiresConfirmation: true,
    reversible: false,
    riskLevel: "high",
    semantic: {
      frames: [
        {
          clarificationLabel: "同步当前工作区到云端",
          frameId: "cloud.sync_workspace.current",
          input: {
            scope: "current_workspace"
          },
          intentId: "cloud.sync_workspace",
          requiredContext: ["workspace"],
          requiresConfirmation: true,
          riskLevel: "high",
          signals: [
            semanticSignal("sync", ["同步", "sync"], 4, true),
            semanticSignal("workspace", ["工作区", "当前工作区"], 3, true),
            semanticSignal("cloud", ["云端", "云", "cloud"], 3, true)
          ],
          summary: "同步当前工作区到云端"
        }
      ]
    }
  })
];

function cloneActionMetadata(metadata: RegisteredActionMetadata): RegisteredActionMetadata {
  return {
    ...metadata,
    inputSchema: {
      ...metadata.inputSchema,
      properties: metadata.inputSchema.properties
        ? { ...metadata.inputSchema.properties }
        : undefined,
      required: metadata.inputSchema.required ? [...metadata.inputSchema.required] : undefined
    },
    outputSchema: {
      ...metadata.outputSchema,
      properties: metadata.outputSchema.properties
        ? { ...metadata.outputSchema.properties }
        : undefined,
      required: metadata.outputSchema.required ? [...metadata.outputSchema.required] : undefined
    },
    progressEvents: metadata.progressEvents ? [...metadata.progressEvents] : undefined,
    requiredContext: [...metadata.requiredContext],
    semantic: metadata.semantic
      ? {
          ambiguityGroups: metadata.semantic.ambiguityGroups?.map((group) => ({
            ...group,
            candidates: group.candidates.map((candidate) => ({
              ...candidate,
              input: { ...candidate.input }
            })),
            missing: [...group.missing],
            signals: group.signals.map((signal) => ({
              ...signal,
              aliases: [...signal.aliases]
            }))
          })),
          frames: metadata.semantic.frames.map((frame) => ({
            ...frame,
            input: { ...frame.input },
            requiredContext: frame.requiredContext ? [...frame.requiredContext] : undefined,
            signals: frame.signals.map((signal) => ({
              ...signal,
              aliases: [...signal.aliases]
            }))
          }))
        }
      : undefined
  };
}

export function getRegisteredActionMetadata(): RegisteredActionMetadata[] {
  return registeredActionMetadata.map(cloneActionMetadata);
}

export function getRuntimeActionPolicy(invocation: ActionInvocation): RegisteredActionMetadata {
  const metadata = registeredActionMetadata.find((action) => action.actionId === invocation.actionId);
  if (!metadata) {
    throw new Error(`Unknown action metadata: ${invocation.actionId}`);
  }

  return cloneActionMetadata(metadata);
}

export async function executeAction(
  invocation: ActionInvocation,
  context: ActionContext
): Promise<ActionResult> {
  if (invocation.actionId === "layout.split_two" || invocation.actionId === "layout.reset") {
    if (!context.applyLayoutPreset) {
      throw new Error(`${invocation.actionId} requires a layout handler`);
    }

    return {
      message: context.applyLayoutPreset(invocation.input)
    };
  }

  if (invocation.actionId === "layout.set_ratio") {
    if (!context.applyLayoutRatio) {
      throw new Error("layout.set_ratio requires a layout ratio handler");
    }

    return {
      message: context.applyLayoutRatio(invocation.input)
    };
  }

  if (invocation.actionId === "pane.focus") {
    if (!context.focusPane) {
      throw new Error("pane.focus requires a pane focus handler");
    }

    return {
      message: context.focusPane(invocation.input)
    };
  }

  if (invocation.actionId === "dock.move_item") {
    if (!context.moveDockItem) {
      throw new Error("dock.move_item requires a dock move handler");
    }

    return {
      message: context.moveDockItem(invocation.input)
    };
  }

  if (invocation.actionId === "theme.apply_generated") {
    if (!context.applyGeneratedTheme) {
      throw new Error("theme.apply_generated requires a generated theme handler");
    }

    const parsed = parseGeneratedThemeInput(invocation.input);
    if (!parsed.ok) {
      return {
        message: `生成主题未通过安全校验：${parsed.errors.join("；")}`
      };
    }

    return {
      message: context.applyGeneratedTheme(parsed.theme)
    };
  }

  if (invocation.actionId === "theme.apply_preset" || invocation.actionId === "theme.reset") {
    if (!context.applyThemePreset) {
      throw new Error(`${invocation.actionId} requires a theme handler`);
    }

    return {
      message: context.applyThemePreset(invocation.input)
    };
  }

  if (
    invocation.actionId === "panel.open" ||
    invocation.actionId === "panel.close" ||
    invocation.actionId === "panel.toggle"
  ) {
    if (!context.applyPanelAction) {
      throw new Error(`${invocation.actionId} requires a panel handler`);
    }

    const operation =
      invocation.actionId === "panel.open"
        ? "open"
        : invocation.actionId === "panel.close"
          ? "close"
          : "toggle";

    return {
      message: context.applyPanelAction({
        ...invocation.input,
        operation
      })
    };
  }

  if (invocation.actionId === "settings.update") {
    if (!context.settingsStore) {
      throw new Error("settings.update requires a settings store");
    }

    context.settingsStore.apply({
      intent: "update_setting",
      target: invocation.input.target,
      value: invocation.input.value
    });

    return {
      message: `已更新 ${settingsRegistry[invocation.input.target].label}：${formatSettingValue(
        invocation.input.target,
        invocation.input.value
      )}`
    };
  }

  if (invocation.actionId === "selected_set.import") {
    if (!context.importSelectedSet) {
      throw new Error("selected_set.import requires an import handler");
    }

    return {
      message: await context.importSelectedSet()
    };
  }

  if (invocation.actionId === "organization.open_shared_library") {
    if (!context.openOrganizationSharedLibrary) {
      throw new Error("organization.open_shared_library requires an organization shared-library handler");
    }

    return {
      message: await context.openOrganizationSharedLibrary()
    };
  }

  if (invocation.actionId === "artifact.generate" || invocation.actionId === "artifact.start_analysis") {
    if (!context.startArtifactAnalysis) {
      throw new Error(`${invocation.actionId} requires an artifact analysis handler`);
    }

    return {
      message: context.startArtifactAnalysis(invocation.input.artifactType)
    };
  }

  if (invocation.actionId === "artifact.open_tab") {
    if (!context.openArtifactTab) {
      throw new Error("artifact.open_tab requires an artifact tab handler");
    }

    return {
      message: context.openArtifactTab(invocation.input)
    };
  }

  if (invocation.actionId === "profile.open_academic_archive") {
    if (!context.openAcademicArchive) {
      throw new Error("profile.open_academic_archive requires a profile handler");
    }

    return {
      message: context.openAcademicArchive()
    };
  }

  if (invocation.actionId === "recommendation.refresh") {
    if (!context.refreshRecommendations) {
      throw new Error("recommendation.refresh requires a recommendation handler");
    }

    return {
      message: await context.refreshRecommendations(invocation.input)
    };
  }

  if (invocation.actionId === "collection.add") {
    if (!context.addToCollection) {
      throw new Error("collection.add requires a collection handler");
    }

    return {
      message: await context.addToCollection(invocation.input)
    };
  }

  if (
    invocation.actionId === "workspace.delete_documents" ||
    invocation.actionId === "workspace.overwrite_documents" ||
    invocation.actionId === "workspace.batch_update_documents" ||
    invocation.actionId === "cloud.upload_documents" ||
    invocation.actionId === "cloud.sync_workspace"
  ) {
    throw new Error(`${invocation.actionId} requires an approved high-risk action handler`);
  }

  throw new Error(`Unknown action: ${(invocation as { actionId: string }).actionId}`);
}

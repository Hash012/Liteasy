import {
  getRegisteredActionMetadata,
  getRuntimeActionPolicy,
  type ActionInvocation
} from "../skills/actionRegistry";
import type { Citation } from "../retrieval/retrieval.types";
import type { ArtifactOutlineNode, ArtifactType } from "../artifacts/artifact.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import type { ModelTransport } from "../models/modelHttpClient";
import type { SettingsState } from "../settings/settings.types";
import type { UIDslActionRef, UIDslDocument, UIDslNode } from "./generativeUi.types";
import { createFallbackUIDslDocument, type FallbackUiReason } from "./fallbackUi";
import { validateUIDslDocument } from "./uiDslValidator";
import { validateUIDslUxWithModelFallback } from "./uxValidator";

export type UIDslPlanProjection = {
  actions: ActionInvocation[];
  intentId?: string;
  planId: string;
  requiredContext?: string[];
  summary: string;
};

function createAudit(plan: UIDslPlanProjection) {
  return {
    createdAt: new Date().toISOString(),
    generatedBy: "rule" as const,
    traceId: `trace-${plan.planId}`
  };
}

function createStatusNode(text: string, tone: "info" | "success" | "warning" = "success"): UIDslNode {
  return {
    component: "StatusBanner",
    id: "status",
    props: {
      text,
      tone
    }
  };
}

function createActionBarNode(actionIds: string[]): UIDslNode {
  return {
    component: "ActionBar",
    id: "action-bar",
    props: {
      actionIds
    }
  };
}

function createResetAction(plan: UIDslPlanProjection): UIDslActionRef | null {
  if (plan.actions.some((action) => action.actionId === "theme.apply_preset")) {
    return {
      actionId: "theme.reset",
      id: "reset-theme",
      input: {},
      label: "恢复默认",
      riskLevel: "low"
    };
  }

  if (plan.actions.some((action) => action.actionId === "layout.split_two")) {
    return {
      actionId: "layout.reset",
      id: "reset-layout",
      input: {},
      label: "恢复默认布局",
      riskLevel: "low"
    };
  }

  return null;
}

function createInverseWorkbenchAction(action: ActionInvocation): UIDslActionRef | null {
  const metadata = getRegisteredActionMetadata().find(
    (registeredAction) => registeredAction.actionId === action.actionId
  );
  const inverseMetadata = metadata?.inverseActionId
    ? getRegisteredActionMetadata().find(
        (registeredAction) => registeredAction.actionId === metadata.inverseActionId
      )
    : undefined;

  if (!metadata?.inverseActionId || !inverseMetadata) {
    return null;
  }

  const input = {};
  const policy = getRuntimeActionPolicy({
    actionId: metadata.inverseActionId,
    input
  } as ActionInvocation);
  const label =
    metadata.family === "theme"
      ? "恢复默认"
      : inverseMetadata.label;

  return {
    actionId: metadata.inverseActionId,
    id: `inverse-${metadata.inverseActionId.replace(/\./g, "-")}`,
    input,
    label,
    riskLevel: policy.riskLevel
  };
}

function createArtifactNode(plan: UIDslPlanProjection): UIDslNode | null {
  const artifactAction = plan.actions.find((action) => action.actionId === "artifact.generate");

  if (!artifactAction || artifactAction.actionId !== "artifact.generate") {
    return null;
  }

  return {
    component: "ArtifactLauncher",
    id: "artifact-launcher",
    props: {
      artifactType: artifactAction.input.artifactType,
      title: "中心栏产物已创建"
    }
  };
}

function getActionResultText(plan: UIDslPlanProjection, fallbackText?: string) {
  if (fallbackText && fallbackText.length > 0) {
    return fallbackText;
  }

  return plan.summary;
}

export function generateUIDslFromSemanticPlan(
  plan: UIDslPlanProjection,
  options: {
    statusText?: string;
  } = {}
): UIDslDocument {
  const actions: UIDslActionRef[] = [];
  const children: UIDslNode[] = [createStatusNode(getActionResultText(plan, options.statusText))];
  const artifactNode = createArtifactNode(plan);
  const resetAction = createResetAction(plan);

  if (artifactNode) {
    children.push(artifactNode);
  }

  if (resetAction) {
    const policy = getRuntimeActionPolicy({
      actionId: resetAction.actionId,
      input: resetAction.input
    } as never);
    actions.push({
      ...resetAction,
      riskLevel: policy.riskLevel
    });
    children.push(createActionBarNode([resetAction.id]));
  }

  return {
    actions,
    audit: createAudit(plan),
    dataSources: [],
    id: `ui-${plan.planId}`,
    intentPlanId: plan.planId,
    root: {
      children,
      component: "Stack",
      id: "root",
      props: {
        direction: "vertical",
        gap: "md"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

export function generateWorkbenchOverlayUIDslDocument(input: {
  action: ActionInvocation;
  message: string;
  planId?: string;
  traceId?: string;
}): UIDslDocument {
  const inverseAction = createInverseWorkbenchAction(input.action);
  const children: UIDslNode[] = [
    createStatusNode(input.message)
  ];

  if (inverseAction) {
    children.push(createActionBarNode([inverseAction.id]));
  }

  const planId =
    input.planId ?? `workbench-${input.action.actionId.replace(/\./g, "-")}`;
  const traceId = input.traceId ?? `trace-${planId}`;

  return {
    actions: inverseAction ? [inverseAction] : [],
    audit: {
      createdAt: new Date().toISOString(),
      generatedBy: "rule",
      traceId
    },
    dataSources: [
      {
        id: "workbench-current",
        params: {},
        sourceId: "workspace.current"
      }
    ],
    id: `ui-${planId}`,
    intentPlanId: planId,
    root: {
      children,
      component: "Stack",
      id: "workbench-overlay-root",
      props: {
        direction: "vertical",
        gap: "sm"
      }
    },
    surface: "workbench_overlay",
    version: "liteasy-ui-dsl/v1"
  };
}

function isUIDslDocumentCandidate(value: unknown): value is UIDslDocument {
  return typeof value === "object" && value !== null;
}

function createGenerationFallbackDocument(input: {
  fallbackDocument: UIDslDocument;
  message: string;
  reason: FallbackUiReason;
  recovery?: string;
}) {
  return createFallbackUIDslDocument({
    baseDocument: input.fallbackDocument,
    message: input.message,
    planId: input.fallbackDocument.intentPlanId,
    reason: input.reason,
    recovery: input.recovery,
    traceId: input.fallbackDocument.audit.traceId
  });
}

export async function generateUIDslWithModelFallback(
  plan: UIDslPlanProjection,
  options: {
    generateModelDsl: (input: {
      fallbackDocument: UIDslDocument;
      plan: UIDslPlanProjection;
      statusText?: string;
    }) => Promise<string> | string;
    generateModelUxReview?: (input: {
      candidateDocument: UIDslDocument;
      fallbackDocument: UIDslDocument;
      plan: UIDslPlanProjection;
      statusText?: string;
    }) => Promise<string> | string;
    statusText?: string;
  }
): Promise<UIDslDocument> {
  const fallbackDocument = generateUIDslFromSemanticPlan(plan, {
    statusText: options.statusText
  });

  let rawDocument: string;
  try {
    rawDocument = await options.generateModelDsl({
      fallbackDocument,
      plan,
      statusText: options.statusText
    });
  } catch {
    return createGenerationFallbackDocument({
      fallbackDocument,
      message: "模型 UI 生成失败，已切换到受控降级界面。",
      reason: "model_failure",
      recovery: "可继续使用基础状态反馈与可逆动作。"
    });
  }

  try {
    const parsed: unknown = JSON.parse(rawDocument);

    if (!isUIDslDocumentCandidate(parsed)) {
      return createGenerationFallbackDocument({
        fallbackDocument,
        message: "模型 UI DSL 未返回可渲染文档，已切换到受控降级界面。",
        reason: "dsl_error",
        recovery: "模型输出必须是 UIDslDocument JSON 对象。"
      });
    }

    const schemaValidation = validateUIDslDocument(parsed);
    if (!schemaValidation.valid) {
      return createGenerationFallbackDocument({
        fallbackDocument,
        message: "模型 UI DSL 未通过契约校验，已切换到受控降级界面。",
        reason: "dsl_error",
        recovery: schemaValidation.errors.join("；")
      });
    }

    const uxValidation = await validateUIDslUxWithModelFallback(parsed, {
      generateModelUxReview: options.generateModelUxReview
        ? ({ document }) =>
            options.generateModelUxReview?.({
              candidateDocument: document,
              fallbackDocument,
              plan,
              statusText: options.statusText
            }) ?? JSON.stringify({ errors: [], valid: true })
        : undefined
    });
    if (!uxValidation.valid) {
      return createGenerationFallbackDocument({
        fallbackDocument,
        message: "模型 UI 存在 UX 风险，已切换到受控降级界面。",
        reason: "ux_risk",
        recovery: uxValidation.errors.join("；")
      });
    }

    return parsed;
  } catch {
    return createGenerationFallbackDocument({
      fallbackDocument,
      message: "模型 UI DSL 解析失败，已切换到受控降级界面。",
      reason: "dsl_error",
      recovery: "模型输出必须是合法 JSON。"
    });
  }
}

function createUIDslGeneratorPrompt(input: {
  fallbackDocument: UIDslDocument;
  plan: UIDslPlanProjection;
  statusText?: string;
}) {
  return [
    "你是 LiteasyClaw 意图原生生成式 UI 的 UI DSL Generator。",
    "只输出 UIDslDocument JSON，不要输出 Markdown。",
    "模型只生成声明式 UI 候选，不拥有执行权。",
    "必须遵守 liteasy-ui-dsl/v1 schema：只能使用已注册组件、已注册 ActionRef、已注册 dataSources，不能输出任意 CSS、脚本或 DOM 操作。",
    "优先表达计划摘要、执行结果、可逆动作和状态反馈；如果不能确定，返回 fallbackDocument 的等价 JSON。",
    `执行计划：${JSON.stringify(input.plan)}`,
    `执行结果：${input.statusText ?? input.plan.summary}`,
    `规则 fallbackDocument：${JSON.stringify(input.fallbackDocument)}`
  ].join("\n");
}

function createUIDslUxReviewPrompt(input: {
  candidateDocument: UIDslDocument;
  fallbackDocument: UIDslDocument;
  plan: UIDslPlanProjection;
  statusText?: string;
}) {
  return [
    "你是 LiteasyClaw UX Validator。",
    "只输出 JSON，不要输出 Markdown。",
    "输出格式必须是 {\"valid\": boolean, \"errors\": string[]}。",
    "模型只评估 UX 风险，不拥有执行权；不得修改 UIDslDocument、不得新增 ActionRef、不得改写 journal 事实。",
    "重点检查遮挡、弹窗叠加、按钮不可达、证据矛盾、认知负担，以及 assistant、center_artifact、workbench_overlay surface 是否适配。",
    "如果没有明显风险，返回 {\"valid\": true, \"errors\": []}。",
    "如果存在风险，返回 {\"valid\": false, \"errors\": [\"具体风险\"]}。",
    `执行计划：${JSON.stringify(input.plan)}`,
    `执行结果：${input.statusText ?? input.plan.summary}`,
    `候选 UIDslDocument：${JSON.stringify(input.candidateDocument)}`,
    `规则 fallbackDocument：${JSON.stringify(input.fallbackDocument)}`
  ].join("\n");
}

export function createModelAssistedUIDslGenerator(input: {
  modelTransport?: ModelTransport;
  settings: SettingsState;
}) {
  return async (request: {
    plan: UIDslPlanProjection;
    statusText: string;
  }) => {
    const provider = input.settings["models.default_provider"];
    const gateway = createModelGatewayFromSettings(input.settings, {
      cloudTransport: input.modelTransport
    });
    const model = getDefaultModelForProvider(provider);

    return generateUIDslWithModelFallback(request.plan, {
      generateModelDsl: async ({ fallbackDocument, plan, statusText }) => {
        const generation = await gateway.generateAnswer({
          model,
          prompt: createUIDslGeneratorPrompt({
            fallbackDocument,
            plan,
            statusText
          }),
          provider
        });

        return generation.answer;
      },
      generateModelUxReview: async ({ candidateDocument, fallbackDocument, plan, statusText }) => {
        const generation = await gateway.generateAnswer({
          model,
          prompt: createUIDslUxReviewPrompt({
            candidateDocument,
            fallbackDocument,
            plan,
            statusText
          }),
          provider
        });

        return generation.answer;
      },
      statusText: request.statusText
    });
  };
}

export function generateEvidenceUIDslDocument(input: {
  answer: string;
  citations: Citation[];
  confidence: number;
  mode: "explain" | "qa";
  question: string;
}): UIDslDocument {
  const firstCitation = input.citations[0];
  const children: UIDslNode[] = [
    createStatusNode(
      input.mode === "explain" ? "已生成概念解释与证据链。" : "已生成文献问答证据视图。",
      "info"
    )
  ];

  if (firstCitation) {
    children.push({
      component: "EvidenceCard",
      id: "primary-evidence",
      props: {
        confidence: input.confidence,
        snippet: firstCitation.snippet,
        source: `${firstCitation.paperId} p.${firstCitation.page}`,
        title: "主要证据"
      }
    });
  }

  children.push({
    component: "CitationList",
    id: "citations",
    props: {
      citations: input.citations.map((citation) => ({
        page: String(citation.page),
        paperId: citation.paperId
      }))
    }
  });

  return {
    actions: [],
    audit: {
      createdAt: new Date().toISOString(),
      generatedBy: "rule",
      traceId: `trace-answer-${Date.now()}`
    },
    dataSources: [
      {
        id: "answer-citations",
        params: {
          question: input.question
        },
        sourceId: "retrieval.citations"
      }
    ],
    id: `ui-answer-${Date.now()}`,
    intentPlanId: `answer-${input.mode}`,
    root: {
      children,
      component: "Stack",
      id: "root",
      props: {
        direction: "vertical",
        gap: "md"
      }
    },
    surface: "assistant",
    version: "liteasy-ui-dsl/v1"
  };
}

function getArtifactProjectionTitle(type: ArtifactType) {
  if (type === "comparison_table") {
    return "Literature Comparison Table";
  }

  if (type === "tree") {
    return "Literature Tree Analysis";
  }

  if (type === "ppt") {
    return "Literature PPT Outline";
  }

  if (type === "layered_graph") {
    return "Layered Literature Graph";
  }

  return "Literature Mind Map";
}

function createComparisonRows(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>
) {
  return selectedPapers.map((paper) => {
    const chunks = importedChunksByPaperId[paper.id] ?? [];
    const firstChunk = chunks[0];

    return {
      evidence: firstChunk ? `${paper.id} p.${firstChunk.page}` : paper.id,
      focus: firstChunk?.summary ?? "等待导入后补全证据摘要",
      paper: paper.title
    };
  });
}

function createEvidenceRows(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>
) {
  return selectedPapers.flatMap((paper) => {
    const chunks = importedChunksByPaperId[paper.id] ?? [];
    const sourceChunks = chunks.length > 0
      ? chunks.slice(0, 3)
      : [
          {
            page: 0,
            snippet: "等待导入后补全原文证据。",
            summary: "",
            tags: []
          }
        ];

    return sourceChunks.map((chunk) => ({
      evidence: chunk.page > 0 ? `${paper.id} p.${chunk.page}` : paper.id,
      paper: paper.title,
      snippet: chunk.snippet || chunk.summary || "等待导入后补全原文证据。",
      tags: chunk.tags
    }));
  });
}

function createMindMapNodes(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>
) {
  const nodes: Array<{ id: string; label: string; parentId?: string }> = [];

  selectedPapers.forEach((paper) => {
    const paperNodeId = `paper-${paper.id}`;
    nodes.push({
      id: paperNodeId,
      label: paper.title
    });

    const tags = new Set(
      (importedChunksByPaperId[paper.id] ?? []).flatMap((chunk) => chunk.tags).filter(Boolean)
    );
    const labels = tags.size > 0 ? [...tags].slice(0, 12) : ["待补全证据"];
    labels.forEach((label, index) => {
      nodes.push({
        id: `${paperNodeId}-topic-${index}`,
        label,
        parentId: paperNodeId
      });
    });
  });

  return nodes;
}

function createTreeOutlineNodes(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>,
  title: string
) {
  return [
    {
      id: "root",
      label: title,
      kind: "root"
    },
    ...selectedPapers.flatMap((paper) => {
      const chunks = importedChunksByPaperId[paper.id] ?? [];
      const evidenceNodes = (chunks.length > 0 ? chunks.slice(0, 3) : []).map((chunk, index) => ({
        id: `evidence-${paper.id}-${index}`,
        kind: "evidence",
        label: chunk.summary || chunk.snippet,
        parentId: `paper-${paper.id}`
      }));

      return [
        {
          id: `paper-${paper.id}`,
          kind: "paper",
          label: paper.title,
          parentId: "root"
        },
        ...evidenceNodes
      ];
    })
  ];
}

function createSlides(
  selectedPapers: Paper[],
  importedChunksByPaperId: Record<string, RetrievalChunk[]>,
  title: string
) {
  const overview = {
    bullets: selectedPapers.map((paper) => paper.title).slice(0, 5),
    title
  };

  return [
    overview,
    ...selectedPapers.map((paper) => {
      const chunks = importedChunksByPaperId[paper.id] ?? [];
      const bullets = chunks.length > 0
        ? chunks.slice(0, 3).map((chunk) => chunk.summary || chunk.snippet)
        : ["等待导入后补全证据摘要"];

      return {
        bullets,
        title: paper.title
      };
    })
  ];
}

function createOpenArtifactAction(input: {
  artifactId: string;
  artifactType: ArtifactType;
}): UIDslActionRef {
  return {
    actionId: "artifact.open_tab",
    id: `open-${input.artifactId}`,
    input: {
      artifactId: input.artifactId,
      artifactType: input.artifactType
    },
    label: "打开产物",
    riskLevel: "low"
  };
}

function createArtifactActionBar(action: UIDslActionRef): UIDslNode {
  return {
    component: "ActionBar",
    id: "artifact-actions",
    props: {
      actionIds: [action.id]
    }
  };
}

function createCenterArtifactRoot(input: {
  actionBar: UIDslNode;
  artifactType: ArtifactType;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  outlineNodes?: ArtifactOutlineNode[];
  selectedPapers: Paper[];
  title: string;
}): UIDslNode {
  if (input.artifactType === "comparison_table") {
    return {
      children: [
        {
          component: "ComparisonTable",
          id: "artifact-comparison-table",
          props: {
            rows: createComparisonRows(input.selectedPapers, input.importedChunksByPaperId),
            title: input.title
          }
        },
        {
          component: "EvidenceMatrix",
          id: "artifact-evidence-matrix",
          props: {
            rows: createEvidenceRows(input.selectedPapers, input.importedChunksByPaperId),
            title: "Evidence Matrix"
          }
        },
        input.actionBar
      ],
      component: "Stack",
      id: "artifact-comparison-root",
      props: {
        direction: "vertical",
        gap: "md"
      }
    };
  }

  if (input.artifactType === "tree") {
    return {
      children: [input.actionBar],
      component: "TreeOutline",
      id: "artifact-tree-outline",
      props: {
        nodes:
          input.outlineNodes ??
          createTreeOutlineNodes(
            input.selectedPapers,
            input.importedChunksByPaperId,
            input.title
          ),
        title: input.title
      }
    };
  }

  if (input.artifactType === "ppt") {
    return {
      children: [input.actionBar],
      component: "SlideDeck",
      id: "artifact-slide-deck",
      props: {
        slides: createSlides(input.selectedPapers, input.importedChunksByPaperId, input.title),
        title: input.title
      }
    };
  }

  return {
    children: [input.actionBar],
    component: "MindMap",
    id: "artifact-mindmap",
    props: {
      nodes:
        input.outlineNodes ??
        createMindMapNodes(input.selectedPapers, input.importedChunksByPaperId),
      title: input.title
    }
  };
}

export function generateCenterArtifactUIDslDocument(input: {
  artifactId: string;
  artifactType: ArtifactType;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  outlineNodes?: ArtifactOutlineNode[];
  selectedPapers: Paper[];
  title?: string;
}): UIDslDocument {
  const title = input.title ?? getArtifactProjectionTitle(input.artifactType);
  const openArtifactAction = createOpenArtifactAction({
    artifactId: input.artifactId,
    artifactType: input.artifactType
  });
  const root = createCenterArtifactRoot({
    actionBar: createArtifactActionBar(openArtifactAction),
    artifactType: input.artifactType,
    importedChunksByPaperId: input.importedChunksByPaperId,
    outlineNodes: input.outlineNodes,
    selectedPapers: input.selectedPapers,
    title
  });

  return {
    actions: [openArtifactAction],
    audit: {
      createdAt: new Date().toISOString(),
      generatedBy: "rule",
      traceId: `trace-${input.artifactId}`
    },
    dataSources: [
      {
        id: "artifact-selected-set",
        params: {
          artifactType: input.artifactType,
          paperIds: input.selectedPapers.map((paper) => paper.id)
        },
        sourceId: "selected_document_set.summary"
      }
    ],
    id: `ui-${input.artifactId}`,
    intentPlanId: `artifact-${input.artifactId}`,
    root,
    surface: "center_artifact",
    version: "liteasy-ui-dsl/v1"
  };
}

function createGoldenPlan(
  plan: Pick<UIDslPlanProjection, "actions" | "intentId" | "planId" | "summary"> &
    Partial<Pick<UIDslPlanProjection, "requiredContext">>
): UIDslPlanProjection {
  return {
    requiredContext: [],
    ...plan
  };
}

function withStableAudit(document: UIDslDocument): UIDslDocument {
  return {
    ...document,
    audit: {
      ...document.audit,
      createdAt: "2026-07-05T00:00:00.000Z"
    }
  };
}

export function generateGoldenIntentUIDslDocuments(): UIDslDocument[] {
  const plans: UIDslPlanProjection[] = [
    createGoldenPlan({
      actions: [
        {
          actionId: "theme.apply_preset",
          input: {
            preset: "playful",
            tone: "cartoon"
          }
        }
      ],
      intentId: "theme.apply",
      planId: "golden-theme-cartoon",
      summary: "已应用卡通风格。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "theme.reset",
          input: {}
        }
      ],
      intentId: "theme.apply",
      planId: "golden-theme-reset",
      summary: "已恢复默认界面风格。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "layout.split_two",
          input: {
            preset: "two_column"
          }
        }
      ],
      intentId: "layout.change",
      planId: "golden-layout-split",
      summary: "已切换双栏布局。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "layout.reset",
          input: {}
        }
      ],
      intentId: "layout.change",
      planId: "golden-layout-reset",
      summary: "已恢复默认布局。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "panel.open",
          input: {
            panel: "settings"
          }
        }
      ],
      intentId: "panel.change",
      planId: "golden-panel-open",
      summary: "已打开设置面板。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "panel.close",
          input: {
            panel: "right"
          }
        }
      ],
      intentId: "panel.change",
      planId: "golden-panel-close",
      summary: "已收起右栏。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "comparison_table",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      planId: "golden-artifact-comparison",
      requiredContext: ["selected_document_set"],
      summary: "已创建论文对比表任务。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "mindmap",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      planId: "golden-artifact-mindmap",
      requiredContext: ["selected_document_set"],
      summary: "已创建思维导图任务。"
    }),
    createGoldenPlan({
      actions: [
        {
          actionId: "selected_set.import",
          input: {
            source: "selected_document_set"
          }
        }
      ],
      intentId: "selected_set.import",
      planId: "golden-selection-import",
      requiredContext: ["selected_document_set"],
      summary: "已导入当前选中文献集。"
    })
  ];

  const evidenceDocument = generateEvidenceUIDslDocument({
    answer: "向量数据库系统围绕向量表示、索引和查询处理组织。",
    citations: [
      {
        page: 4,
        paperId: "golden-paper-vector-database",
        snippet: "vector database management systems manage unstructured data embeddings"
      }
    ],
    confidence: 0.86,
    mode: "qa",
    question: "如何定义向量数据库系统？"
  });

  return [
    ...plans.map((plan) => withStableAudit(generateUIDslFromSemanticPlan(plan))),
    withStableAudit({
      ...evidenceDocument,
      audit: {
        ...evidenceDocument.audit,
        traceId: "trace-golden-evidence-answer"
      },
      id: "ui-golden-evidence-answer",
      intentPlanId: "golden-evidence-answer"
    })
  ];
}

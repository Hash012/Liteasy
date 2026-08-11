import { z } from "zod";
import type { GeneratedVisualizationModality } from "./visualizationArtifact.types";

export const visualizationDecisionBases = [
  "semantic_structure",
  "bounded_function_relationship",
  "planar_geometry",
  "spatial_geometry",
  "static_physics",
  "temporal_physics",
  "biology_structure",
  "circuit_topology",
  "supported_reaction_process",
  "scientific_illustration",
  "plain_text_sufficient",
  "insufficient_evidence"
] as const;

const basisSchema = z.enum(visualizationDecisionBases);
const decisionSchema = z.enum(["generate", "omit"]);

export const visualizationDecisionOutputSchema = z.object({
  basis: basisSchema,
  decision: decisionSchema,
  evidenceIds: z.array(z.string().min(1).max(120)).max(32),
  rationale: z.string().min(12).max(1_000)
}).strict();

export const visualizationDecisionOutputJsonSchema = Object.freeze({
  additionalProperties: false,
  properties: {
    basis: { enum: [...visualizationDecisionBases], type: "string" },
    decision: { enum: ["generate", "omit"], type: "string" },
    evidenceIds: {
      items: { maxLength: 120, minLength: 1, type: "string" },
      maxItems: 32,
      type: "array"
    },
    rationale: { maxLength: 1_000, minLength: 12, type: "string" }
  },
  required: ["decision", "basis", "evidenceIds", "rationale"],
  type: "object"
});

export type VisualizationDecisionOutput = z.infer<typeof visualizationDecisionOutputSchema>;

export type VisualizationDecisionPlannerAttempt = {
  accepted: boolean;
  prompt: string;
  rejectionReason?: string;
  response: string;
};

type DecisionEvidence = {
  id: string;
  page: number;
  quote: string;
};

type MaterializedVisualizationIntent = {
  candidateModalities: readonly GeneratedVisualizationModality[];
  evidenceIds: readonly string[];
  expectedLearningGain: "medium" | "high";
  purpose: "explain_structure" | "show_process" | "show_geometry" | "show_evidence";
  requestedBy: "automatic" | "explicit_user_request";
};

const omittedBases = new Set<VisualizationDecisionOutput["basis"]>([
  "plain_text_sufficient",
  "insufficient_evidence"
]);

const intentByBasis: Partial<Record<VisualizationDecisionOutput["basis"], Omit<
  MaterializedVisualizationIntent,
  "evidenceIds" | "requestedBy"
>>> = {
  semantic_structure: {
    candidateModalities: ["semantic_graph"],
    expectedLearningGain: "medium",
    purpose: "explain_structure"
  },
  bounded_function_relationship: {
    candidateModalities: ["function_plot"],
    expectedLearningGain: "high",
    purpose: "show_geometry"
  },
  planar_geometry: {
    candidateModalities: ["geometry_2d"],
    expectedLearningGain: "high",
    purpose: "show_geometry"
  },
  spatial_geometry: {
    candidateModalities: ["geometry_3d"],
    expectedLearningGain: "high",
    purpose: "show_geometry"
  },
  static_physics: {
    candidateModalities: ["physics_diagram"],
    expectedLearningGain: "medium",
    purpose: "show_evidence"
  },
  temporal_physics: {
    candidateModalities: ["physics_process"],
    expectedLearningGain: "high",
    purpose: "show_process"
  },
  biology_structure: {
    candidateModalities: ["biology_structure"],
    expectedLearningGain: "medium",
    purpose: "explain_structure"
  },
  circuit_topology: {
    candidateModalities: ["circuit"],
    expectedLearningGain: "high",
    purpose: "explain_structure"
  },
  supported_reaction_process: {
    candidateModalities: ["reaction_process"],
    expectedLearningGain: "high",
    purpose: "show_process"
  },
  scientific_illustration: {
    candidateModalities: ["raster_illustration"],
    expectedLearningGain: "medium",
    purpose: "explain_structure"
  }
};

export function buildVisualizationDecisionPrompt(input: {
  evidence: readonly DecisionEvidence[];
  question: string;
  requestedBy: "automatic" | "explicit_user_request";
  title: string;
}) {
  const evidence = input.evidence.map((item) => (
    `[${item.id}] 第 ${item.page} 页\n${item.quote}`
  )).join("\n\n");
  return [
    "你是 Liteasy 的可视化必要性门。独立判断是否需要受控可视化，不生成薄读正文，也不生成图形源码。",
    "只根据下列任务和 evidence 判断。一张图必须比准确、简洁的正文显著改善结构、过程、几何或证据关系的理解，才能选择 generate。",
    "先选择一个 basis，再给出 decision。basis 与受控模态的唯一映射由系统代码完成，不得自行发明模态。",
    "生成判据：",
    "- semantic_structure：至少三个已证实组件、类别或节点及其依赖、层级或因果边。",
    "- bounded_function_relationship：证据给出函数、定义域以及顶点、极值、端点或其他关键点，读者需要看出形状与边界关系。",
    "- planar_geometry：证据给出平面点线圆、角、相交、相切或作图关系。",
    "- spatial_geometry：证据给出三维物体、平面、截面或空间约束。",
    "- static_physics：证据给出同一状态中的力、场、方向或器件关系，但不需要时间演化。",
    "- temporal_physics：证据给出状态、位置或速度随时间的变化以及轨迹或事件顺序。",
    "- biology_structure：证据给出生物结构的组成、位置或功能关系。",
    "- circuit_topology：证据给出元件、连接、方向或测量拓扑。",
    "- supported_reaction_process：证据明确给出反应步骤、中间体或基元过程；总反应式或配平关系不等于已知反应过程。",
    "- scientific_illustration：证据支持需要直接观察形态的科学对象，且上述结构化模态均不能准确表达。",
    "省略判据：",
    "- plain_text_sufficient：单个术语定义、单个数值比较、普通历史叙述、纯局限性陈述、简单计量关系，或图只会重复正文。",
    "- insufficient_evidence：图需要补造证据未支持的性质、几何约束、因果关系、反应步骤、标签或外观。",
    "不能因为论文很短、只讨论一个构造或没有实验，就省略本质上依赖空间或时间关系的图。",
    "generate 必须填写至少一个下方 evidence ID；omit 的 evidenceIds 必须为空数组。rationale 只解释判据，不引用模型、供应商或实现。",
    `请求来源：${input.requestedBy}`,
    `标题：${input.title}`,
    `任务：${input.question}`,
    `Evidence：\n${evidence}`,
    "只返回符合 JSON schema 的对象。"
  ].join("\n");
}

export function parseVisualizationDecisionOutput(
  value: string | unknown,
  options: { allowedEvidenceIds: readonly string[] }
) {
  let json: unknown = value;
  if (typeof value === "string") {
    try {
      json = JSON.parse(value);
    } catch {
      throw new Error("visualization_decision_json_invalid");
    }
  }
  const parsed = visualizationDecisionOutputSchema.parse(json);
  const shouldGenerate = !omittedBases.has(parsed.basis);
  if ((parsed.decision === "generate") !== shouldGenerate ||
    (parsed.decision === "generate" && parsed.evidenceIds.length === 0) ||
    (parsed.decision === "omit" && parsed.evidenceIds.length > 0)) {
    throw new Error("visualization_decision_inconsistent");
  }
  const allowed = new Set(options.allowedEvidenceIds);
  if (new Set(parsed.evidenceIds).size !== parsed.evidenceIds.length ||
    parsed.evidenceIds.some((id) => !allowed.has(id))) {
    throw new Error("visualization_decision_evidence_invalid");
  }
  return parsed;
}

export function materializeVisualizationIntent(
  decision: VisualizationDecisionOutput,
  requestedBy: "automatic" | "explicit_user_request"
): MaterializedVisualizationIntent | null {
  if (decision.decision === "omit") return null;
  const template = intentByBasis[decision.basis];
  if (!template) throw new Error("visualization_decision_basis_unmapped");
  return {
    ...template,
    evidenceIds: [...decision.evidenceIds],
    requestedBy
  };
}

function buildVisualizationDecisionRepairPrompt(input: {
  basePrompt: string;
  invalidOutput: string;
  reason: string;
}) {
  return [
    input.basePrompt,
    "",
    "上一份 JSON 未通过确定性校验。只修复结构、判据一致性和 evidence ID；不要改变任务或补造证据。",
    `校验错误：${input.reason.slice(0, 1_000)}`,
    `无效输出：${input.invalidOutput.slice(0, 8_000)}`,
    "重新返回一个符合原 JSON schema 的完整对象。"
  ].join("\n");
}

export async function runVisualizationDecisionPlanner(input: {
  evidence: readonly DecisionEvidence[];
  generate: (request: {
    prompt: string;
    schema: typeof visualizationDecisionOutputJsonSchema;
    schemaName: "liteasy_visualization_decision_v1";
  }) => Promise<{ text: string }>;
  question: string;
  requestedBy: "automatic" | "explicit_user_request";
  title: string;
}) {
  const basePrompt = buildVisualizationDecisionPrompt(input);
  const attempts: VisualizationDecisionPlannerAttempt[] = [];
  let prompt = basePrompt;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await input.generate({
      prompt,
      schema: visualizationDecisionOutputJsonSchema,
      schemaName: "liteasy_visualization_decision_v1"
    });
    try {
      const decision = parseVisualizationDecisionOutput(response.text, {
        allowedEvidenceIds: input.evidence.map(({ id }) => id)
      });
      attempts.push({ accepted: true, prompt, response: response.text });
      return {
        attempts,
        basePrompt,
        decision,
        intent: materializeVisualizationIntent(decision, input.requestedBy)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({
        accepted: false,
        prompt,
        rejectionReason: reason,
        response: response.text
      });
      if (attempt === 2) throw new Error(`visualization_decision_planner_rejected:${reason}`);
      prompt = buildVisualizationDecisionRepairPrompt({
        basePrompt,
        invalidOutput: response.text,
        reason
      });
    }
  }
  throw new Error("visualization_decision_planner_missing");
}

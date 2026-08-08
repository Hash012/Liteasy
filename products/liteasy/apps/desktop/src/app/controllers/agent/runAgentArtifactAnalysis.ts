import type {
  ArtifactTaskStage,
  ArtifactType
} from "../../features/artifacts/artifact.types";
import type { FrontendAgentClient } from "../../features/agent-api/frontendAgentClient";
import type { AgentAttachment } from "../../features/agent-api/agentApi.types";
import { parseStreamingOutlineMarkdown } from "../../features/artifacts/artifactOutline";
import type { AgentArtifactGenerationOptions } from "../../features/artifacts/useArtifactActions";

const modalityLabels = {
  comparison_table: "对比表",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "PPT 大纲",
  thin_reading: "薄读",
  tree: "树形分析"
} as const;

function mapArtifactProgressStage(
  artifactType: ArtifactType,
  phase: string | undefined,
  options?: AgentArtifactGenerationOptions
): ArtifactTaskStage {
  if (artifactType === "thin_reading") {
    if (phase === "retrieving_evidence") {
      return "thin_reading_retrieving_evidence";
    }
    if (phase === "retrieving_external_knowledge") {
      return "thin_reading_retrieving_external_knowledge";
    }
    if (phase === "generating_answer") {
      return options?.thinReadingContext?.source.kind === "root_overview"
        ? "thin_reading_generating_root"
        : "thin_reading_generating_branch";
    }
    if (phase === "repairing_structured_output") {
      return "thin_reading_repairing_trace";
    }
    if (phase === "auditing_answer" || phase === "structuring_artifact") {
      return "thin_reading_validating";
    }
    return "thin_reading_planning";
  }
  if (phase === "planning_artifact" || phase === "collecting_external_knowledge") {
    return "retrieving_evidence";
  }
  if (phase === "verifying_artifact" || phase === "repairing_artifact") {
    return "auditing_answer";
  }
  if (
    phase === "retrieving_evidence" ||
    phase === "generating_answer" ||
    phase === "auditing_answer" ||
    phase === "structuring_artifact"
  ) {
    return phase;
  }
  return "generating_answer";
}

function createArtifactIdempotencyKey(artifactType: ArtifactType) {
  const randomPart = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `artifact:${artifactType}:${randomPart}`;
}

function buildSelectionAttachment(options?: AgentArtifactGenerationOptions): AgentAttachment {
  const metadata = {
    ...(options?.sourcePaperIds?.length ? { paperIds: [...options.sourcePaperIds] } : {}),
    ...(options?.thinReadingContext
      ? { thinReadingContext: JSON.parse(JSON.stringify(options.thinReadingContext)) }
      : {})
  };
  return {
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    source: "selection",
    uri: "liteasy://selection/current"
  };
}

function buildThinReadingMessage(options?: AgentArtifactGenerationOptions) {
  const context = options?.thinReadingContext;
  const target = context?.primaryPaperTitle ?? "当前论文";
  const task = context?.source.kind === "omitted_section"
    ? `深入薄读遗漏板块“${context.source.label}”`
    : context?.source.kind === "selected_text"
      ? `深入薄读选区“${context.source.excerpt}”`
      : "生成薄读初始总述";
  const prompt = context?.source.kind === "selected_text" && context.source.prompt
    ? ` 用户补充提示：${context.source.prompt}。`
    : "";
  return [
    `基于指定论文《${target}》${task}。`,
    "必须走真实模型链路，先检索并组织论文内证据，再按论文类型生成结构化薄读 JSON。",
    "输出必须区分论文内证据与外部知识；证据不足、引用外溢或越过论文闭包时要显式标注。",
    "不要生成本地模板、演示文案或假装已有社区后端。",
    prompt
  ].join("");
}

export async function runAgentArtifactAnalysis(
  client: FrontendAgentClient,
  artifactType: ArtifactType,
  onProgress?: (input: {
    agentRunId?: string;
    message: string;
    partialAnswer?: string;
    partialOutlineNodes?: ReturnType<typeof parseStreamingOutlineMarkdown>;
    progress: number;
    stage: ArtifactTaskStage;
  }) => void,
  options?: AgentArtifactGenerationOptions
) {
  if (artifactType === "skill_doc") {
    throw new Error("Skill 文档不是论文分析模态");
  }
  const outlineInstruction = artifactType === "tree" || artifactType === "mindmap" || artifactType === "layered_graph"
    ? [
        "严格使用 Markdown unordered list 表达层级，每层缩进两个空格；不要使用制表符、ASCII 树线或代码围栏。",
        "以每篇论文为一级分析对象，继续展开研究动机、问题定义、关键假设、数据流、算法步骤、公式/变量、模型与组件、数据集、基线、指标、定量结果、消融、效率、失败模式、局限与可复现信息。",
        "证据中出现的专有名词、模型名、组件名、算法名、数据集名和指标名都要作为可继续展开的节点，解释它是什么、在方法中的位置、与相邻概念的关系。",
        "不要为了缩短输出而合并有独立含义的概念，也不要设置固定节点数；深度和规模应随证据量增长。每个事实节点附 evidence ID。",
        "证据不足时明确标注未知项，不能用常识补写。"
      ].join("")
    : "";
  const sourceDescription = artifactType === "thin_reading"
    ? buildThinReadingMessage(options)
    : options?.sourcePaperIds?.length
    ? `基于指定的 ${options.sourcePaperIds.length} 篇来源论文生成可供读者深入理解论文的${modalityLabels[artifactType]}`
    : `基于当前锁定的选中文献集生成可供读者深入理解论文的${modalityLabels[artifactType]}`;
  const supplementalInstruction = options?.supplementalContext
    ? `\n\n用户补充资料（必须与论文原始证据分开标注，不得把用户材料伪装成论文原文）：\n<user-supplement>\n${options.supplementalContext}\n</user-supplement>`
    : "";
  const message = artifactType === "thin_reading"
    ? `${sourceDescription}${supplementalInstruction}`
    : `${sourceDescription}。完整梳理论文结构、术语关系、方法细节、实验设计与结论边界，并提取可追溯证据。${outlineInstruction}${supplementalInstruction}`;
  const idempotencyKey = createArtifactIdempotencyKey(artifactType);
  let targetRunId: string | null = null;
  let partialAnswer = "";
  const subtaskDrafts = new Map<string, { content: string; label: string }>();
  const unsubscribe = client.subscribe((event) => {
    if (event.type === "run.started" && event.idempotencyKey === idempotencyKey) {
      targetRunId = event.runId;
      onProgress?.({
        agentRunId: event.runId,
        message: "Agent 已接收分析任务",
        progress: 18,
        stage: artifactType === "thin_reading" ? "thin_reading_planning" : "preparing_context"
      });
      return;
    }
    if (!targetRunId || event.runId !== targetRunId) {
      return;
    }
    if (event.type === "context.prepared") {
      onProgress?.({
        message: artifactType === "thin_reading" ? "已装配论文范围，正在规划薄读证据" : "已装配工作区与 Agent 上下文",
        progress: 25,
        stage: artifactType === "thin_reading" ? "thin_reading_planning" : "preparing_context"
      });
      return;
    }
    if (event.type === "progress.started") {
      onProgress?.({
        message: event.summary,
        progress: Math.max(25, Math.min(90, event.progress ?? 50)),
        stage: mapArtifactProgressStage(artifactType, event.phase, options)
      });
      return;
    }
    if (event.type === "analysis.subtask.delta") {
      const current = subtaskDrafts.get(event.subtaskId);
      subtaskDrafts.set(event.subtaskId, {
        content: `${current?.content ?? ""}${event.delta}`,
        label: event.label
      });
      const visibleWorklog = [...subtaskDrafts.values()]
        .map((draft) => `### ${draft.label}\n\n${draft.content}`)
        .join("\n\n");
      onProgress?.({
        message: `正在并行分析论文区段（${subtaskDrafts.size} 路工作记录已更新）`,
        partialAnswer: visibleWorklog.slice(-6_000),
        progress: 48,
        stage: artifactType === "thin_reading"
          ? options?.thinReadingContext?.source.kind === "root_overview"
            ? "thin_reading_generating_root"
            : "thin_reading_generating_branch"
          : "generating_answer"
      });
      return;
    }
    if (event.type === "assistant.delta") {
      partialAnswer += event.delta;
      const partialOutlineNodes = artifactType === "tree" || artifactType === "mindmap" || artifactType === "layered_graph"
        ? parseStreamingOutlineMarkdown(partialAnswer)
        : undefined;
      onProgress?.({
        message: "正在接收模型流式输出",
        partialAnswer: partialAnswer.slice(-1600),
        partialOutlineNodes,
        progress: 68,
        stage: artifactType === "thin_reading"
          ? options?.thinReadingContext?.source.kind === "root_overview"
            ? "thin_reading_generating_root"
            : "thin_reading_generating_branch"
          : "generating_answer"
      });
    }
  });
  let result: Awaited<ReturnType<FrontendAgentClient["send"]>>;
  try {
    result = await client.send(
      { artifactType, message, mode: "qa" },
      {
        attachments: [buildSelectionAttachment(options)],
        idempotencyKey
      }
    );
  } finally {
    unsubscribe();
  }
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  if (result.data.status === "failed") {
    const failure = [...result.data.events]
      .reverse()
      .find((event) => event.type === "run.failed");
    throw new Error(
      failure?.type === "run.failed"
        ? failure.message
        : "Agent run failed without a diagnostic message"
    );
  }
  return result.data;
}

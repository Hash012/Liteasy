import { formatAnswer } from "./answerFormatter";
import type { AssistantMode } from "./assistant.types";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import { createHttpModelAuditClient, type ModelAuditTransport } from "../models/modelAuditClient";
import type { ModelTransport } from "../models/modelHttpClient";
import { getMockAnswer } from "../retrieval/mockRetriever";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import type { Paper } from "../workspace/workspace.types";
import { auditAssistantAnswer } from "./answerAuditor";
import { generateEvidenceUIDslDocument } from "../generative-ui/uiDslGenerator";
import type { AgentCorePromptContext } from "../agent-core/contextAssembler";
import { formatAgentCorePromptContext } from "../agent-core/contextAssembler";
import type { AgentArtifactType } from "../agent-api/agentApi.types";
import {
  completeMultiPaperAnalysis,
  prepareMultiPaperAnalysis
} from "../paper-analysis/multiPaperAnalysisWorkflow";
import type { PreparedMultiPaperAnalysis } from "../paper-analysis/analysis.types";

type GenerateAssistantAnswerInput = {
  agentCoreContext?: AgentCorePromptContext;
  artifactType?: AgentArtifactType;
  auditTransport?: ModelAuditTransport;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  mode: Exclude<AssistantMode, "command">;
  modelTransport?: ModelTransport;
  onDelta?: (delta: string, accumulated: string) => void;
  onProgress?: (input: { phase: string; progress: number; summary: string }) => void;
  question: string;
  selectedPapers: Paper[];
  settings: SettingsState;
  signal?: AbortSignal;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function getActiveModelEndpoint(settings: SettingsState) {
  return settings["models.cloud_proxy_endpoint"];
}

type AnalysisSubtask = {
  evidencePrompt: string;
  focus: string;
  id: string;
  paperTitle: string;
};

function formatSubtaskEvidence(
  evidence: PreparedMultiPaperAnalysis["evidence"]
) {
  return evidence
    .map(
      (item) =>
        `[${item.id}] p.${item.page}\n摘要：${item.summary}\n原文：${item.quote}`
    )
    .join("\n\n");
}

export function buildAnalysisSubtasks(
  prepared: PreparedMultiPaperAnalysis
): AnalysisSubtask[] {
  const paperIds = prepared.run.coverage.selectedPaperIds;
  if (paperIds.length !== 1) {
    return paperIds.flatMap((paperId) => {
      const evidence = prepared.evidence.filter((item) => item.paperId === paperId);
      if (evidence.length === 0) {
        return [];
      }
      return [{
        evidencePrompt: formatSubtaskEvidence(evidence),
        focus: "逐页提取研究问题、方法机制、术语、实验结果、局限及其关系",
        id: `paper:${paperId}`,
        paperTitle: evidence[0].paperTitle
      }];
    });
  }

  const paperEvidence = prepared.evidence
    .filter((item) => item.paperId === paperIds[0])
    .sort((left, right) => left.page - right.page || left.chunkId.localeCompare(right.chunkId));
  if (paperEvidence.length === 0) {
    return [];
  }
  const taskCount = Math.min(4, paperEvidence.length);
  const perTask = Math.ceil(paperEvidence.length / taskCount);
  return Array.from({ length: taskCount }, (_, index) => {
    const evidence = paperEvidence.slice(index * perTask, (index + 1) * perTask);
    if (evidence.length === 0) {
      return null;
    }
    const firstPage = evidence[0].page;
    const lastPage = evidence[evidence.length - 1].page;
    return {
      evidencePrompt: formatSubtaskEvidence(evidence),
      focus: `深入分析论文第 ${index + 1}/${taskCount} 区段（p.${firstPage}–${lastPage}），识别本区段的章节作用、全部关键术语、方法步骤、公式变量、实验数字和限制`,
      id: `section:${paperIds[0]}:${index + 1}`,
      paperTitle: evidence[0].paperTitle
    };
  }).filter((task): task is AnalysisSubtask => task !== null);
}

async function runAnalysisSubtasks(input: {
  gateway: ReturnType<typeof createModelGatewayFromSettings>;
  model: string;
  prepared: PreparedMultiPaperAnalysis;
  provider: SettingsState["models.default_provider"];
  signal?: AbortSignal;
}) {
  const tasks = buildAnalysisSubtasks(input.prepared);
  const reports = new Array<string>(tasks.length);
  let cursor = 0;
  const workerCount = Math.min(4, tasks.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const taskIndex = cursor;
      cursor += 1;
      const task = tasks[taskIndex];
      if (input.signal?.aborted) {
        throw new Error("Assistant answer generation was cancelled");
      }
      const prompt = [
        "你是论文分析 Agent 的并行子任务。只分析分配给你的论文和证据，不得引入外部事实。",
        `论文：${task.paperTitle}`,
        `任务：${task.focus}`,
        "输出结构化中文研究记录；每个事实都保留 evidence ID，逐项解释名词含义及相互关系，不要只列名词。",
        `证据：\n${task.evidencePrompt}`
      ].join("\n");
      try {
        const generation = await input.gateway.generateAnswer({
          model: input.model,
          prompt,
          provider: input.provider
        });
        reports[taskIndex] = `### 子任务 ${task.id}：${task.focus}\n${generation.answer}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        reports[taskIndex] = `### 子任务 ${task.id} 未完成\n${message}`;
      }
    }
  }));

  return reports.join("\n\n");
}

export async function generateAssistantAnswer({
  agentCoreContext,
  artifactType,
  auditTransport,
  importedChunksByPaperId,
  mode,
  modelTransport,
  onDelta,
  onProgress,
  question,
  selectedPapers,
  settings,
  signal
}: GenerateAssistantAnswerInput) {
  if (signal?.aborted) {
    throw new Error("Assistant answer generation was cancelled");
  }
  onProgress?.({
    phase: "retrieving_evidence",
    progress: 32,
    summary: "正在检索并整理选中文献证据"
  });
  const preparedAnalysis = artifactType || selectedPapers.length > 1
    ? prepareMultiPaperAnalysis({
        importedChunksByPaperId,
        query: question,
        selectedPapers,
        signal
      })
    : null;
  const groundedAnswer = preparedAnalysis
    ? {
        answer: "",
        citations: preparedAnalysis.citations,
        confidence: preparedAnalysis.retrievalConfidence
      }
    : getMockAnswer(selectedPapers, importedChunksByPaperId, question);
  const gateway = createModelGatewayFromSettings(settings, {
    cloudTransport: modelTransport
  });
  const provider = settings["models.default_provider"];
  const model = getDefaultModelForProvider(provider);
  let parallelAnalysis = "";
  if (artifactType && preparedAnalysis && !isMockEndpoint(getActiveModelEndpoint(settings))) {
    onProgress?.({
      phase: "analyzing_sections",
      progress: 44,
      summary: "正在并行分析各篇论文与不同区段"
    });
    parallelAnalysis = await runAnalysisSubtasks({
      gateway,
      model,
      prepared: preparedAnalysis,
      provider,
      signal
    });
  }
  const prompt = [
    /*
     * Agent core 上下文放在问题和证据前面，作用类似稳定的 system prefix：
     * - agent.md 约束回答边界。
     * - memory 让跨轮偏好和项目事实可见。
     * - capability/budget 摘要提醒模型不要假装有未注册工具。
     *
     * 这里仍然把文献片段作为明确“参考片段”传入，避免 memory 抢过证据优先级。
     */
    agentCoreContext ? `Agent核心上下文：\n${formatAgentCorePromptContext(agentCoreContext)}` : "",
    `问题：${question}`,
    `参考文献：${selectedPapers.map((paper) => paper.title).join("；")}`,
    artifactType ? `目标产物模态：${artifactType}` : "",
    parallelAnalysis
      ? `并行分析子任务记录（仍须回到原始 evidence 复核后综合）：\n${parallelAnalysis}`
      : "",
    preparedAnalysis
      ? [
          "多论文分析规则：逐篇比较，区分共同点、分歧与未知项；所有事实性结论必须由下列 evidence ID 支撑，不得用常识填补缺失论文。",
          `比较维度：${preparedAnalysis.run.plan.dimensions.join("；")}`,
          `覆盖缺口：${preparedAnalysis.run.coverage.missingPaperIds.join("；") || "无"}`,
          `证据矩阵：\n${preparedAnalysis.evidencePrompt}`
        ].join("\n")
      : `参考片段：${groundedAnswer.citations.map((citation) => citation.snippet).join("；")}`
  ]
    .filter(Boolean)
    .join("\n");
  onProgress?.({
    phase: "generating_answer",
    progress: 55,
    summary: "正在调用模型生成分析结构"
  });
  const generation = await gateway.generateAnswer({
    model,
    onDelta,
    prompt,
    provider
  });
  if (signal?.aborted) {
    throw new Error("Assistant answer generation was cancelled");
  }
  const generatedAnswerText = generation.answer;
  onProgress?.({
    phase: "auditing_answer",
    progress: 78,
    summary: "正在核对引用与证据覆盖"
  });
  const localAudit = auditAssistantAnswer({
    answer: generatedAnswerText,
    citations: groundedAnswer.citations,
    retrievalConfidence: groundedAnswer.confidence
  });
  const activeEndpoint = getActiveModelEndpoint(settings);
  const audit = isMockEndpoint(activeEndpoint)
    ? localAudit
    : await createHttpModelAuditClient({
        endpoint: activeEndpoint,
        source: "cloud_proxy",
        transport: auditTransport
      })({
        answer: generatedAnswerText,
        citations: groundedAnswer.citations,
        model: "gpt-5-mini-auditor",
        provider: settings["models.default_provider"],
        question,
        retrievalConfidence: groundedAnswer.confidence
      }).catch(() => localAudit);
  if (signal?.aborted) {
    throw new Error("Assistant answer generation was cancelled");
  }
  const analysis = preparedAnalysis
    ? completeMultiPaperAnalysis({
        answer: generatedAnswerText,
        auditScore: audit.score,
        auditVerdict: audit.verdict,
        prepared: preparedAnalysis,
        signal
      })
    : undefined;
  onProgress?.({
    phase: "structuring_artifact",
    progress: 88,
    summary: "正在构造可视化产物数据"
  });

  return {
    analysis,
    answer: generatedAnswerText,
    audit,
    citations: groundedAnswer.citations,
    confidence: groundedAnswer.confidence,
    executionTrace: generation.trace,
    uiDsl: generateEvidenceUIDslDocument({
      answer: generatedAnswerText,
      citations: groundedAnswer.citations,
      confidence: groundedAnswer.confidence,
      mode,
      question
    }),
    content:
      mode === "explain"
        ? `概念解释：${generatedAnswerText}\n引用: ${groundedAnswer.citations
            .map((citation) => `${citation.paperId} p.${citation.page}`)
            .join(", ")}\n可信度: ${groundedAnswer.confidence.toFixed(2)}`
        : formatAnswer({
            ...groundedAnswer,
            answer: generatedAnswerText
          })
  };
}

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

type GenerateAssistantAnswerInput = {
  agentCoreContext?: AgentCorePromptContext;
  auditTransport?: ModelAuditTransport;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  mode: Exclude<AssistantMode, "command">;
  modelTransport?: ModelTransport;
  question: string;
  selectedPapers: Paper[];
  settings: SettingsState;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

function getActiveModelEndpoint(settings: SettingsState) {
  return settings["models.cloud_proxy_endpoint"];
}

export async function generateAssistantAnswer({
  agentCoreContext,
  auditTransport,
  importedChunksByPaperId,
  mode,
  modelTransport,
  question,
  selectedPapers,
  settings
}: GenerateAssistantAnswerInput) {
  const groundedAnswer = getMockAnswer(selectedPapers, importedChunksByPaperId, question);
  const gateway = createModelGatewayFromSettings(settings, {
    cloudTransport: modelTransport
  });
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
    `参考片段：${groundedAnswer.citations.map((citation) => citation.snippet).join("；")}`
  ]
    .filter(Boolean)
    .join("\n");
  const provider = settings["models.default_provider"];
  const generation = await gateway.generateAnswer({
    model: getDefaultModelForProvider(provider),
    prompt,
    provider
  });
  const generatedAnswerText = generation.answer;
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

  return {
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

import { formatAnswer } from "./answerFormatter";
import type { AssistantMode } from "./assistant.types";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import { getMockAnswer } from "../retrieval/mockRetriever";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import type { Paper } from "../workspace/workspace.types";

type GenerateAssistantAnswerInput = {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  mode: AssistantMode;
  question: string;
  selectedPapers: Paper[];
  settings: SettingsState;
};

export async function generateAssistantAnswer({
  importedChunksByPaperId,
  mode,
  question,
  selectedPapers,
  settings
}: GenerateAssistantAnswerInput) {
  const groundedAnswer = getMockAnswer(selectedPapers, importedChunksByPaperId, question);
  const gateway = createModelGatewayFromSettings(settings);
  const prompt = [
    `问题：${question}`,
    `参考文献：${selectedPapers.map((paper) => paper.title).join("；")}`,
    `参考片段：${groundedAnswer.citations.map((citation) => citation.snippet).join("；")}`
  ].join("\n");
  const generation = await gateway.generateAnswer({
    model: "gpt-5-mini",
    prompt,
    provider: settings["models.default_provider"]
  });
  const generatedAnswerText = generation.answer;

  return {
    answer: generatedAnswerText,
    citations: groundedAnswer.citations,
    confidence: groundedAnswer.confidence,
    executionTrace: generation.trace,
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

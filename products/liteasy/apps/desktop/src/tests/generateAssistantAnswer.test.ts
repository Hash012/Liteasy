import {
  buildThinReadingRepairPrompt,
  buildThinReadingExternalQueryPlan,
  collectThinReadingExternalRoutes,
  generateAssistantAnswer,
  planThinReadingInterpretation,
  prioritizeThinReadingGenerationSources,
  resolveThinReadingSourcePolicy,
  shouldRetrieveThinReadingExternalKnowledge
} from "../app/features/assistant/generateAssistantAnswer";
import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";
import { afterEach, vi } from "vitest";

let thinReadingExternalKnowledgeClientConstructionError: Error | undefined;

vi.mock("../app/features/thin-reading/thinReadingExternalKnowledgeClient", async () => {
  const actual = await vi.importActual<typeof import("../app/features/thin-reading/thinReadingExternalKnowledgeClient")>(
    "../app/features/thin-reading/thinReadingExternalKnowledgeClient"
  );
  return {
    ...actual,
    createThinReadingExternalKnowledgeClient: (...args: Parameters<typeof actual.createThinReadingExternalKnowledgeClient>) => {
      if (thinReadingExternalKnowledgeClientConstructionError) {
        throw thinReadingExternalKnowledgeClientConstructionError;
      }
      return actual.createThinReadingExternalKnowledgeClient(...args);
    }
  };
});

afterEach(() => {
  thinReadingExternalKnowledgeClientConstructionError = undefined;
});

test("exports the production thin-reading repair prompt for evaluation recording", () => {
  expect(typeof buildThinReadingRepairPrompt).toBe("function");
});

const liveModelTransport = async () => ({
  json: async () => ({
    answer: "云端回答：这篇综述如何定义向量数据库系统？ [demo-2 p.4]",
    execution: {
      backend: "test_cloud",
      mode: "live",
      provider: "openai"
    }
  }),
  ok: true,
  status: 200
});

const liveAuditTransport = async () => ({
  json: async () => ({
    audit: {
      model: "gpt-5-mini-auditor",
      rationale: "回答包含可追溯引用，且引用片段覆盖问题关键词。",
      score: 0.86,
      verdict: "pass"
    }
  }),
  ok: true,
  status: 200
});

function evidenceReviewPropositions(
  prompt: string,
  unsupportedSentenceIds: readonly string[] = []
) {
  const unsupported = new Set(unsupportedSentenceIds);
  return [...prompt.matchAll(/^- id=(thin-reading-sentence-[^;\s]+);[^\n]*?text=(.+)$/gm)]
    .map((match) => {
      let proposition = match[2];
      try {
        proposition = String(JSON.parse(match[2]));
      } catch {
        // The prompt builder normally emits JSON strings; retain the captured text in malformed fixtures.
      }
      return {
        proposition: proposition.slice(0, 300),
        sentenceId: match[1],
        verdict: unsupported.has(match[1]) ? "partial" as const : "supported" as const
      };
    });
}

function evidenceReviewRootOrientation(prompt: string) {
  if (!prompt.includes("root_orientation_review_required=true")) {
    return null;
  }
  const paperType = prompt.match(/候选主要论文类型：([a-z_]+)。/)?.[1] ?? "unknown";
  const sentenceIds = [...prompt.matchAll(
    /^- id=(thin-reading-sentence-[^;\s]+);/gm
  )].map((match) => match[1]);
  const conclusionSentenceId = sentenceIds[0] ?? "thin-reading-sentence-missing";
  const supportSentenceId = sentenceIds[1] ?? conclusionSentenceId;
  return {
    conclusionSupport: {
      chains: [{
        conclusionSentenceId,
        reason: "核心结论由正文中的机制、推导或决定性证据形成最短充分支持链。",
        supportKinds: ["mechanism" as const],
        supportSentenceIds: [supportSentenceId],
        verdict: "complete" as const
      }],
      reason: "总述给出了核心结论，并用最短充分的论文内支持过程说明结论为何成立。",
      status: "complete" as const
    },
    coreIdea: "covered" as const,
    fieldPosition: "evidence_unavailable" as const,
    paperPanorama: "covered" as const,
    paperType,
    paperTypeVerdict: paperType === "unknown" ? "ambiguous" as const : "supported" as const,
    reason: "首页围绕候选论文的主要贡献形成聚焦总述；当前测试证据没有额外的领域位置材料。",
    retentionVerdict: "focused" as const,
    verdict: "pass" as const
  };
}

function paperAnswerabilityForPrompt(prompt: string) {
  const paperSupportedSentenceIds = [...prompt.matchAll(
    /^- id=(thin-reading-sentence-[^;\s]+);[^\n]*?evidence=(?!无(?:;|$))[^;]+;/gm
  )].map((match) => match[1]);
  const paperEvidenceIds = [...new Set(
    [...prompt.matchAll(/^- id=(evidence-[^;\s]+);/gm)].map((match) => match[1])
  )];
  const hasExternalSentence = /^- id=thin-reading-sentence-[^;\s]+;[^\n]*?external=(?!无(?:;|$))[^;]+;/m.test(prompt);
  const status = paperSupportedSentenceIds.length === 0
    ? "none" as const
    : hasExternalSentence
      ? "partial" as const
      : "complete" as const;
  return {
    answerObligations: [{
      obligation: "完整回答当前用户问题",
      paperCoverage: status,
      paperEvidenceIds: status === "none" ? [] : paperEvidenceIds.slice(0, 4),
      reason: status === "complete"
        ? "目标论文证据覆盖当前问题的全部必要语义义务。"
        : status === "partial"
          ? "目标论文只覆盖当前问题的一部分必要语义义务。"
          : "目标论文不能覆盖当前问题的必要语义义务。"
    }],
    paperSupportedSentenceIds,
    reason: status === "complete"
      ? "目标论文证据能够完整回答当前问题。"
      : status === "partial"
        ? "目标论文能回答实质部分，完整回答仍需要论文外来源。"
        : "目标论文证据不能实质回答当前问题。",
    status
  };
}

function passingEvidenceReview(prompt: string) {
  return {
    paperAnswerability: paperAnswerabilityForPrompt(prompt),
    propositionVerdicts: evidenceReviewPropositions(prompt),
    reason: "每个正文句均由其绑定证据直接支持。",
    rootOrientation: evidenceReviewRootOrientation(prompt),
    unsupportedSentenceIds: [],
    verdict: "pass" as const
  };
}

function semanticAnswerabilityReview(
  prompt: string,
  status: "complete" | "partial" | "none"
) {
  const propositions = evidenceReviewPropositions(prompt);
  const paperSupportedSentenceIds = status === "none"
    ? []
    : [...prompt.matchAll(
        /^- id=(thin-reading-sentence-[^;\s]+);[^\n]*?evidence=(?!无(?:;|$))[^;]+;/gm
      )].map((match) => match[1]);
  const paperEvidenceIds = [...new Set(
    [...prompt.matchAll(/^- id=(evidence-[^;\s]+);/gm)].map((match) => match[1])
  )];
  return {
    paperAnswerability: {
      answerObligations: [{
        obligation: "完整回答当前用户问题",
        paperCoverage: status,
        paperEvidenceIds: status === "none" ? [] : paperEvidenceIds.slice(0, 4),
        reason: status === "complete"
          ? "目标论文证据覆盖当前问题的全部必要语义义务。"
          : status === "partial"
            ? "目标论文只覆盖当前问题的一部分必要语义义务。"
            : "目标论文不能覆盖当前问题的必要语义义务。"
      }],
      paperSupportedSentenceIds,
      reason: status === "complete"
        ? "目标论文证据能够完整回答当前问题。"
        : status === "partial"
          ? "目标论文能回答机制本身，但完整解释部署边界仍需要论文外来源。"
          : "目标论文中的命题不能实质回答当前部署问题。",
      status
    },
    propositionVerdicts: propositions,
    reason: "每个正文句均由其绑定来源直接支持。",
    rootOrientation: evidenceReviewRootOrientation(prompt),
    unsupportedSentenceIds: [],
    verdict: "pass" as const
  };
}

function semanticBoundaryExternalResponse() {
  return {
    provider: "openalex",
    query: "deployment boundary",
    sources: [{
      abstract: "Deployment constraints determine when the mechanism remains effective.",
      authors: ["A. Researcher"],
      id: "openalex:W424242",
      provider: "openalex",
      relation: "topic_search",
      relevance: 0.91,
      retrievalQuery: "deployment boundary",
      sourceRecordUrl: "https://openalex.org/W424242",
      sourceId: "W424242",
      title: "Deployment Constraints for Retrieval Systems",
      url: "https://openalex.org/W424242",
      year: 2026
    }],
    status: "available"
  };
}

async function runSemanticAnswerabilityCorrection(input: {
  correctedStatus: "complete" | "partial" | "none";
  initialStatus: "partial" | "none";
}) {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => semanticBoundaryExternalResponse(),
    ok: true,
    status: 200
  }));
  let bodyAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-correction": [{
        page: 3,
        paperId: "paper-semantic-correction",
        paperTitle: "Bounded Retrieval Mechanism",
        snippet: "The paper explains token ranking and the conditions under which it remains effective.",
        summary: "论文解释了词元排序及其成立条件。",
        tags: ["mechanism", "boundary"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(
              prompt,
              reviewAttempts === 1 ? input.initialStatus : input.correctedStatus
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const paperSentence = "论文解释了索引集合中的词元排序机制及其保持有效所需的条件。";
      const answer = prompt.includes("来源结构目标：paper_and_external")
        ? {
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: paperSentence }],
            externalKnowledge: ["openalex:W424242"],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            recommendedFigures: [],
            summary: `${paperSentence}外部研究补充了部署资源约束。`,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: paperSentence
            }, {
              evidenceIds: [],
              externalKnowledge: ["openalex:W424242"],
              status: "weak",
              text: "外部研究补充了部署资源约束。"
            }],
            withinPaperClosure: false
          }
        : prompt.includes("来源结构目标：external_only")
          ? {
              claims: [],
              externalKnowledge: ["openalex:W424242"],
              omittedSections: [],
              paperEvidence: [],
              paperType: "systems",
              recommendedFigures: [],
              summary: "外部研究说明部署资源约束会改变机制保持有效的条件。",
              summarySentences: [{
                evidenceIds: [],
                externalKnowledge: ["openalex:W424242"],
                status: "weak",
                text: "外部研究说明部署资源约束会改变机制保持有效的条件。"
              }],
              withinPaperClosure: false
            }
          : paperInterpretationAnswer(paperSentence, evidenceId);
      return {
        json: async () => ({
          answer: JSON.stringify(answer),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么这一机制只在特定部署条件下保持有效？",
    selectedPapers: [{ id: "paper-semantic-correction", title: "Bounded Retrieval Mechanism" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-correction",
      depth: 2,
      paperIds: ["paper-semantic-correction"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-correction",
      primaryPaperTitle: "Bounded Retrieval Mechanism",
      prompt: "为什么这一机制只在特定部署条件下保持有效？",
      source: { excerpt: "词元排序及其成立条件", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  return { bodyAttempts, externalTransport, result, reviewAttempts };
}

function aiInterpretationAnswer(summary: string) {
  return {
    anchors: [],
    claims: [],
    externalKnowledge: [],
    omittedSections: [],
    paperEvidence: [],
    paperType: "unknown",
    recommendations: [],
    recommendedFigures: [],
    summary,
    summarySentences: [{
      evidenceIds: [],
      externalKnowledge: [],
      status: "unsupported",
      text: summary
    }],
    withinPaperClosure: false
  };
}

function paperInterpretationAnswer(summary: string, evidenceId: string) {
  return {
    anchors: [],
    claims: [],
    externalKnowledge: [],
    omittedSections: [],
    paperEvidence: [evidenceId],
    paperType: "experimental",
    recommendedFigures: [],
    summary,
    summarySentences: [{
      evidenceIds: [evidenceId],
      externalKnowledge: [],
      status: "grounded",
      text: summary
    }],
    withinPaperClosure: true
  };
}

function generateAiInterpretationFallbackForTest(input: {
  modelTransport: NonNullable<Parameters<typeof generateAssistantAnswer>[0]["modelTransport"]>;
  signal?: AbortSignal;
  thinReadingContext?: NonNullable<Parameters<typeof generateAssistantAnswer>[0]["thinReadingContext"]>;
  thinReadingExternalKnowledgeTransport?: NonNullable<Parameters<typeof generateAssistantAnswer>[0]["thinReadingExternalKnowledgeTransport"]>;
}) {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  return generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: input.modelTransport,
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    signal: input.signal,
    thinReadingContext: input.thinReadingContext ?? {
      artifactId: "artifact-thin-ai-review-boundary",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: input.thinReadingExternalKnowledgeTransport ?? (async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    }))
  });
}

function generateFocusedRecoveryBoundaryForTest(
  focusedResult: "abort" | "http_unavailable" | "malformed" | "transport_unavailable" | "unknown" | "untrusted"
) {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  const abortError = new DOMException("focused recovery cancelled", "AbortError");
  const unknownError = new Error("focused recovery response reader failed");
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const unsupportedSource = {
    abstract: "A study about a neighboring retrieval topic.",
    authors: ["A. Author"],
    id: "openalex:W1",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: "https://openalex.org/W1",
    sourceId: "W1",
    title: "Adjacent Retrieval Topic",
    url: "https://openalex.org/W1",
    year: 2025
  };
  const untrustedReplacement = {
    abstract: "",
    arxivId: "2508.00009",
    authors: ["A. Author"],
    id: "arxiv:2508.00009",
    provider: "arxiv" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: "https://arxiv.org/abs/2508.00009",
    sourceId: "2508.00009",
    title: "Metadata-only Follow-up Retrieval Candidate",
    url: "https://arxiv.org/abs/2508.00009",
    year: 2025
  };
  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        const sentenceLine = prompt.split("\n").find((line) => line.includes("external=openalex:W1"));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
              reason: "该来源只涉及相邻主题，不能直接支持所问外部命题。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [sentenceId],
              verdict: "fail"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句是明确披露的概念推理，没有来源归因或精确经验数据。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer(
              "一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。"
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [unsupportedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [unsupportedSource.id],
              status: "weak",
              text: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: `artifact-focused-recovery-${focusedResult}`,
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      if (externalRequests === 4) {
        if (focusedResult === "abort") {
          throw abortError;
        }
        if (focusedResult === "transport_unavailable") {
          throw new TypeError("Failed to fetch");
        }
        if (focusedResult === "http_unavailable") {
          return { json: async () => ({}), ok: false, status: 503 };
        }
        if (focusedResult === "unknown") {
          return {
            json: async () => { throw unknownError; },
            ok: true,
            status: 200
          };
        }
        if (focusedResult === "malformed") {
          return {
            json: async () => ({ provider: "openalex", sources: "malformed", status: "available" }),
            ok: true,
            status: 200
          };
        }
        return {
          json: async () => ({
            provider: "openalex",
            query: "external",
            sources: [untrustedReplacement],
            status: "available"
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          provider: "openalex",
          query: "external",
          sources: [unsupportedSource],
          status: "available"
        }),
        ok: true,
        status: 200
      };
    }
  });

  return {
    abortError,
    aiBodyPrompts,
    externalRequestCount: () => externalRequests,
    result,
    unknownError
  };
}

function generateEvidenceReviewTransportBoundaryForTest(input: {
  failuresBeforeSuccess: number;
  reviewError: Error;
}) {
  const store = createSettingsStore();
  let bodyCalls = 0;
  let reviewCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-review-transport": [{
        page: 1,
        paperId: "paper-review-transport",
        paperTitle: "Review Transport",
        snippet: "The mechanism preserves the decisive signal.",
        summary: "该机制保留决定性信号。",
        tags: ["mechanism"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        reviewCalls += 1;
        if (reviewCalls <= input.failuresBeforeSuccess) throw input.reviewError;
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(body.prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyCalls += 1;
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer(
            "该机制通过保留决定性信号来稳定后续判断，并避免关键信息在处理中丢失。",
            evidenceId
          )),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "这一机制是什么？",
    selectedPapers: [{ id: "paper-review-transport", title: "Review Transport" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: `artifact-review-transport-${input.failuresBeforeSuccess}`,
      depth: 1,
      paperIds: ["paper-review-transport"],
      primaryPaperId: "paper-review-transport",
      primaryPaperTitle: "Review Transport",
      source: { excerpt: "decisive signal", kind: "selected_text" },
      targetLanguage: "zh-CN"
    }
  });
  return {
    bodyCallCount: () => bodyCalls,
    result,
    reviewCallCount: () => reviewCalls
  };
}

test("prioritizes verified citation edges while retaining bounded topic-search context", () => {
  const sources = [
    {
      abstract: "A graph-linked paper.", authors: [], id: "openalex:W1", provider: "openalex" as const,
      relation: "cites_target" as const, relevance: 0.9, retrievalQuery: "BERT", sourceId: "W1",
      sourceRecordUrl: "https://openalex.org/W1", title: "Graph source", url: "https://openalex.org/W1"
    },
    {
      abstract: "A traceable topic result with reviewable source content.", authors: [], id: "openalex:W2", provider: "openalex" as const,
      relation: "topic_search" as const, relevance: 0.7, retrievalQuery: "BERT", sourceId: "W2",
      sourceRecordUrl: "https://openalex.org/W2", title: "Topic source", url: "https://openalex.org/W2"
    }
  ];
  const context = {
    artifactId: "artifact-external-priority",
    depth: 1,
    paperIds: ["paper-1"],
    primaryPaperId: "paper-1",
    source: { kind: "selected_text" as const, excerpt: "external relation" },
    targetLanguage: "en-US"
  };

  expect(prioritizeThinReadingGenerationSources({ context, sources }).map((source) => source.id)).toEqual([
    "openalex:W1",
    "openalex:W2"
  ]);
  expect(prioritizeThinReadingGenerationSources({
    context: {
      ...context,
      source: { ...context.source, externalSourceIds: ["openalex:W2"] }
    },
    sources
  }).map((source) => source.id)).toEqual(["openalex:W1", "openalex:W2"]);
});

test("joins external routes early once a reviewable source set is sufficient", async () => {
  const routes = [
    { intent: "support" as const, query: "support" },
    { intent: "challenge" as const, query: "challenge" },
    { intent: "context" as const, query: "context" }
  ];
  const started: string[] = [];
  const source = (id: string) => ({
    abstract: `A directly reviewable source abstract for ${id}.`,
    authors: [],
    id: `openalex:${id}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalIntents: ["support" as const],
    retrievalQuery: "support",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title: `Source ${id}`,
    url: `https://openalex.org/${id}`
  });
  const result = await collectThinReadingExternalRoutes({
    context: {
      artifactId: "artifact-early-join",
      depth: 1,
      paperIds: ["paper-1"],
      source: { kind: "selected_text", excerpt: "follow-up" },
      targetLanguage: "zh-CN"
    },
    deadlineMs: 100,
    routes,
    run: async (route) => {
      started.push(route.intent);
      if (route.intent === "support") {
        return { sources: [source("W1"), source("W2")] };
      }
      return new Promise(() => undefined);
    }
  });

  expect(started).toEqual(["support", "challenge", "context"]);
  expect(result.audit.joinReason).toBe("sufficient_sources");
  expect(result.audit.completedRoutes).toEqual(["support"]);
  expect(result.audit.routeOutcomes.map((outcome) => outcome.status)).toEqual([
    "completed",
    "cancelled",
    "cancelled"
  ]);
});

test("bounds external tail latency and audits unfinished routes", async () => {
  const result = await collectThinReadingExternalRoutes({
    context: {
      artifactId: "artifact-route-deadline",
      depth: 1,
      paperIds: ["paper-1"],
      source: { kind: "selected_text", excerpt: "follow-up" },
      targetLanguage: "zh-CN"
    },
    deadlineMs: 5,
    routes: [
      { intent: "support", query: "support" },
      { intent: "challenge", query: "challenge" },
      { intent: "context", query: "context" }
    ],
    run: async () => new Promise(() => undefined)
  });

  expect(result.audit.joinReason).toBe("deadline");
  expect(result.audit.completedRoutes).toEqual([]);
  expect(result.audit.routeOutcomes.every((outcome) => (
    outcome.status === "timed_out" && outcome.failureKind === "deadline"
  ))).toBe(true);
});

test("keeps the generation context bounded after retrieving a larger candidate pool", () => {
  const sources = Array.from({ length: 12 }, (_, index) => ({
    abstract: `This abstract directly supports retrieval candidate ${index}.`,
    authors: [],
    id: `openalex:W${index + 10}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 1 - index / 20,
    retrievalQuery: "retrieval evaluation",
    sourceId: `W${index + 10}`,
    sourceRecordUrl: `https://openalex.org/W${index + 10}`,
    title: `Retrieval candidate ${index}`,
    url: `https://openalex.org/W${index + 10}`
  }));

  const selected = prioritizeThinReadingGenerationSources({
    context: {
      artifactId: "artifact-candidate-pool",
      depth: 1,
      paperIds: ["paper-1"],
      primaryPaperId: "paper-1",
      source: { kind: "selected_text" as const, excerpt: "retrieval evaluation" },
      targetLanguage: "en-US"
    },
    sources
  });

  expect(selected).toHaveLength(8);
  expect(selected.map((source) => source.id)).toEqual(sources.slice(0, 8).map((source) => source.id));
});

test("builds bounded support, challenge, and context queries for external evidence", () => {
  const plan = buildThinReadingExternalQueryPlan({
    artifactId: "artifact-query-plan",
    depth: 2,
    paperIds: ["paper-1"],
    primaryPaperId: "paper-1",
    primaryPaperTitle: "A Retrieval Study",
    source: { kind: "selected_text", excerpt: "late interaction efficiency" },
    targetLanguage: "en-US"
  });

  expect(plan.map((item) => item.intent)).toEqual(["support", "challenge", "context"]);
  expect(plan.every((item) => item.query.length <= 500)).toBe(true);
  expect(plan.find((item) => item.intent === "challenge")?.query).toContain("conflicting results");
});

test("generates cloud-proxy answers through an injected live transport", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    auditTransport: liveAuditTransport,
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 4,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
          summary: "这篇综述把向量数据库管理系统概括为围绕向量表示、索引和查询处理组织的系统。",
          tags: ["向量数据库", "索引", "查询处理"]
        }
      ]
    },
    mode: "qa",
    modelTransport: liveModelTransport,
    question: "这篇综述如何定义向量数据库系统？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    settings
  });

  expect(result.content).toContain("云端回答：这篇综述如何定义向量数据库系统？");
  expect(result.content).toContain("demo-2 p.4");
  expect(result.audit).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "回答包含可追溯引用，且引用片段覆盖问题关键词。",
    score: 0.86,
    verdict: "pass"
  });
  expect(result.executionTrace).toEqual({
    backend: "http_service",
    endpoint: "http://127.0.0.1:8787",
    mode: "live",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("qa answers include evidence ui dsl without state-changing actions", async () => {
  const settings = createSettingsStore().getState();

  const result = await generateAssistantAnswer({
    auditTransport: liveAuditTransport,
    importedChunksByPaperId: {
      "demo-2": [
        {
          page: 4,
          paperId: "demo-2",
          paperTitle: "Survey of Vector Database Management Systems",
          snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
          summary: "这篇综述把向量数据库管理系统概括为围绕向量表示、索引和查询处理组织的系统。",
          tags: ["向量数据库", "索引", "查询处理"]
        }
      ]
    },
    mode: "qa",
    modelTransport: liveModelTransport,
    question: "这篇综述如何定义向量数据库系统？",
    selectedPapers: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    settings
  });

  expect(result.uiDsl).toMatchObject({
    actions: [],
    dataSources: [
      expect.objectContaining({
        sourceId: "retrieval.citations"
      })
    ],
    root: {
      component: "Stack"
    },
    surface: "assistant"
  });
});

test("keeps generation on the unified cloud model path when stale local-direct settings exist", async () => {
  const store = createSettingsStore();
  const settingsWithStaleLocalDirectKeys = {
    ...store.getState(),
    "models.access_mode": "local_direct",
    "models.local_direct_enabled": true
  };

  const result = await generateAssistantAnswer({
    auditTransport: liveAuditTransport,
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: liveModelTransport,
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: settingsWithStaleLocalDirectKeys
  });

  expect(result.content).toContain("云端回答：");
  expect(result.audit.model).toBe("gpt-5-mini-auditor");
  expect(result.audit.score).toBeGreaterThanOrEqual(0.8);
  expect(result.executionTrace).toEqual({
    backend: "http_service",
    endpoint: "http://127.0.0.1:8787",
    mode: "live",
    provider: "openai",
    source: "cloud_proxy"
  });
});

test("uses the cloud audit endpoint after http model generation", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    auditTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          audit: {
            model: "gpt-5-mini-auditor",
            rationale: "云端审计确认回答有引用支撑。",
            score: 0.91,
            verdict: "pass"
          }
        }),
        ok: true,
        status: 200
      };
    },
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async () => ({
      json: async () => ({
        answer: "真实模型回答",
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    }),
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: store.getState()
  });

  expect(result.answer).toBe("真实模型回答");
  expect(result.audit).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "云端审计确认回答有引用支撑。",
    score: 0.91,
    verdict: "pass"
  });
  expect(requests[0].url).toBe("https://liteasy.example.com/model-proxy/v1/model/audit");
  expect(JSON.parse(requests[0].body)).toMatchObject({
    answer: "真实模型回答",
    model: "gpt-5-mini-auditor",
    provider: "openai",
    question: "总结这篇论文的核心方法",
    source: "cloud_proxy"
  });
});

test("uses the DeepSeek default model for assistant generation when provider is deepseek", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  await generateAssistantAnswer({
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "云端审计确认回答有引用支撑。",
          score: 0.91,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          answer: "DeepSeek 模型回答",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "deepseek"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "总结这篇论文的核心方法",
    selectedPapers: [
      {
        id: "demo-1",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      }
    ],
    settings: store.getState()
  });

  expect(requests[0].url).toBe("https://liteasy.example.com/model-proxy/v1/model/generate");
  expect(JSON.parse(requests[0].body)).toMatchObject({
    model: "deepseek-v4-flash",
    provider: "deepseek",
    source: "cloud_proxy"
  });
});

test("injects agent core context into qa generation prompts", async () => {
  const store = createSettingsStore();
  const session = createAgentCoreSession();
  const prepared = session.prepareTurn({
    message: "实现 Agent 核心时要注意什么？",
    mode: "qa"
  });
  if (!prepared.ok) {
    throw new Error("expected prepared agent turn");
  }
  const requests: Array<{ body: string; url: string }> = [];

  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await generateAssistantAnswer({
    agentCoreContext: prepared.turn.runtimeContext.prompt,
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "测试审计。",
          score: 0.9,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {},
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          answer: "带 Agent 上下文的回答",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "实现 Agent 核心时要注意什么？",
    selectedPapers: [],
    settings: store.getState()
  });

  const prompt = JSON.parse(requests[0].body).prompt;
  expect(prompt).toContain("Agent核心上下文");
  expect(prompt).toContain("Liteasy 学术工作台 Agent");
  expect(prompt).toContain("Memory");
  expect(prompt).toContain("Skills");
});

test("rejects non-http model endpoints before thin-reading generation", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "mock://cloud-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses late interaction for efficient retrieval.",
        summary: "ColBERT 使用后期交互进行高效检索。",
        tags: ["late interaction"]
      }]
    },
    mode: "qa",
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState()
  })).rejects.toThrow("模型云代理必须使用 HTTPS");
});

test("stops live thin-reading before the model call when PDF text evidence is unavailable", async () => {
  const store = createSettingsStore();
  const modelTransport = vi.fn();
  const thinReadingExternalKnowledgeTransport = vi.fn();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: { "scan-1": [] },
    mode: "qa",
    modelTransport,
    question: "生成薄读",
    selectedPapers: [{ id: "scan-1", title: "扫描版论文" }],
    settings: store.getState(),
    thinReadingExternalKnowledgeTransport
  })).rejects.toThrow("《扫描版论文》没有可用的本地文本索引");

  expect(modelTransport).not.toHaveBeenCalled();
  expect(thinReadingExternalKnowledgeTransport).not.toHaveBeenCalled();
});

test("retrieves external literature only for a concrete interpretation gap or beyond-paper request", () => {
  const baseContext = {
    artifactId: "artifact-scope",
    depth: 1,
    paperIds: ["demo-1"],
    primaryPaperTitle: "ColBERT",
    targetLanguage: "zh-CN"
  } as const;

  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 0,
    source: { kind: "root_overview" }
  })).toBe(false);

  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "omitted_section", label: "方法细节", sectionKey: "method" }
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" }
  })).toBe(true);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "omitted_section", label: "相关工作", sectionKey: "related_work" }
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    source: { kind: "selected_text", excerpt: "MaxSim", prompt: "检索相关论文" }
  })).toBe(true);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    parentWithinPaperClosure: false,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 3,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 2,
    source: { kind: "selected_text", excerpt: "MaxSim" }
  }, { maximumInternalDepth: 4 })).toBe(false);
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...baseContext,
    depth: 1,
    source: {
      externalSourceIds: ["openalex:W42"],
      kind: "selected_text",
      excerpt: "A follow-up study"
    }
  }, { maximumInternalDepth: 4 })).toBe(true);
});

test("plans why/how/what explanations without treating lexical evidence gaps as a source-boundary verdict", () => {
  const baseContext = {
    artifactId: "artifact-interpretation-plan",
    depth: 1,
    paperIds: ["paper-1"],
    primaryPaperTitle: "Target Paper",
    source: { kind: "selected_text" as const, excerpt: "核心结论", prompt: "为什么会得到这个结论？" },
    targetLanguage: "zh-CN"
  };
  const plan = planThinReadingInterpretation({
    context: baseContext,
    prepared: {
      evidence: [{ summary: "论文报告了最终结果。", quote: "The final result is reported.", terms: ["result"] }]
    }
  });

  expect(plan).toMatchObject({
    externalKnowledgeNeeded: false,
    intent: "why",
    learningGoals: ["selected_focus", "parent_continuity"],
    readingMode: "exploration",
    requestedDepth: "standard"
  });
  expect(plan.gap).toBeUndefined();
  expect(plan.discourseMoves.join(" ")).toContain("因果");
  expect(shouldRetrieveThinReadingExternalKnowledge({ ...baseContext, interpretationPlan: plan })).toBe(false);
});

test("treats explicit paper-only and traceable-only instructions as source routing constraints", () => {
  const paperOnlyContext = {
    artifactId: "artifact-paper-only-policy",
    depth: 1,
    paperIds: ["paper-1"],
    source: {
      excerpt: "后续研究",
      kind: "selected_text" as const,
      prompt: "只依据目标论文回答，不要使用论文外材料。"
    },
    targetLanguage: "zh-CN"
  };
  const traceableOnlyContext = {
    ...paperOnlyContext,
    artifactId: "artifact-traceable-only-policy",
    source: {
      ...paperOnlyContext.source,
      prompt: "可以检索外部文献，但只使用可追溯来源，不要 AI 独立理解。"
    }
  };

  expect(resolveThinReadingSourcePolicy(paperOnlyContext)).toEqual({
    aiInterpretationAllowed: false,
    externalKnowledgeAllowed: false,
    mode: "paper_only"
  });
  expect(resolveThinReadingSourcePolicy(traceableOnlyContext)).toEqual({
    aiInterpretationAllowed: false,
    externalKnowledgeAllowed: true,
    mode: "traceable_only"
  });
  expect(resolveThinReadingSourcePolicy({
    ...paperOnlyContext,
    artifactId: "artifact-paper-only-policy-en",
    source: {
      ...paperOnlyContext.source,
      prompt: "Only use the target paper. Do not use external sources."
    },
    targetLanguage: "en-US"
  })).toEqual({
    aiInterpretationAllowed: false,
    externalKnowledgeAllowed: false,
    mode: "paper_only"
  });
  expect(resolveThinReadingSourcePolicy({
    ...traceableOnlyContext,
    artifactId: "artifact-traceable-only-policy-en",
    source: {
      ...traceableOnlyContext.source,
      prompt: "Use traceable sources only; do not use AI interpretation."
    },
    targetLanguage: "en-US"
  })).toEqual({
    aiInterpretationAllowed: false,
    externalKnowledgeAllowed: true,
    mode: "traceable_only"
  });

  const plan = planThinReadingInterpretation({
    context: paperOnlyContext,
    prepared: {
      evidence: [{ summary: "论文给出当前结论。", quote: "The paper reports the result.", terms: ["result"] }]
    }
  });
  expect(plan.externalKnowledgeNeeded).toBe(false);
  expect(plan.intentSignals).toContain("source_policy:paper_only");
  expect(shouldRetrieveThinReadingExternalKnowledge({
    ...paperOnlyContext,
    interpretationPlan: plan
  })).toBe(false);
});

test("plans a root overview as reader orientation rather than a generic mixed explanation", () => {
  const plan = planThinReadingInterpretation({
    context: {
      artifactId: "artifact-root-orientation",
      depth: 0,
      paperIds: ["paper-1"],
      primaryPaperTitle: "Target Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    prepared: {
      evidence: [{
        summary: "论文提出核心方法，并与既有路线比较其适用边界。",
        quote: "We introduce the central method and compare it with prior approaches.",
        terms: ["method", "prior work", "limitation"]
      }]
    }
  });

  expect(plan).toMatchObject({
    externalKnowledgeNeeded: false,
    learningGoals: ["core_idea", "core_conclusion", "conclusion_support", "paper_panorama", "field_position"],
    readingMode: "orientation"
  });
  expect(plan.discourseMoves.join(" ")).toContain("核心思想");
  expect(plan.discourseMoves.join(" ")).toContain("全景");
  expect(plan.discourseMoves.join(" ")).toContain("领域位置");
});

test("lets the current question dominate historical reading-intent signals", () => {
  const plan = planThinReadingInterpretation({
    context: {
      ancestorSummaries: [
        { nodeId: "root", summary: "上一页已经反复讲解系统如何执行各个步骤。", title: "系统流程" },
        { nodeId: "parent", summary: "父页继续展开实现方法和执行过程。", title: "实现机制" }
      ],
      artifactId: "artifact-current-intent-dominates",
      depth: 2,
      paperIds: ["paper-1"],
      parentSummary: "这里已经讲过方法怎样运行。",
      parentTitle: "运行过程",
      primaryPaperTitle: "Target Paper",
      prompt: "为什么这个机制能提高稳定性？",
      source: {
        excerpt: "稳定性提升机制",
        kind: "selected_text",
        prompt: "为什么这个机制能提高稳定性？"
      },
      targetLanguage: "zh-CN"
    },
    prepared: {
      evidence: [{
        summary: "该机制通过约束更新过程提高稳定性。",
        quote: "The mechanism improves stability by constraining the update process.",
        terms: ["mechanism", "stability"]
      }]
    }
  });

  expect(plan.intent).toBe("why");
  expect(plan.intentWeights?.why).toBeGreaterThan(plan.intentWeights?.how ?? 0);
  expect(plan.intentSignals).toContain("current_prompt:why");
  expect(plan.explanationDepth).toBe("mechanistic");
  expect(plan.discourseMoves.join(" ")).toContain("因果");
});

test("uses the reading path for an ambiguous prompt without turning topology depth into a source boundary", () => {
  const plan = planThinReadingInterpretation({
    context: {
      ancestorSummaries: [
        { nodeId: "root", summary: "总述已经说明论文提出了什么。", title: "论文总述" },
        { nodeId: "why-1", summary: "这一层开始追问为什么该结论成立。", title: "成立原因" },
        { nodeId: "why-2", summary: "继续追踪因果链和必要前提。", title: "因果链" }
      ],
      artifactId: "artifact-history-intent",
      depth: 3,
      paperIds: ["paper-1"],
      parentSummary: "上一层正在解释结论成立的原因和边界。",
      parentTitle: "成立原因",
      primaryPaperTitle: "Target Paper",
      source: { excerpt: "稳定性条件", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    prepared: {
      evidence: [{
        summary: "稳定性依赖一个必要条件。",
        quote: "Stability depends on a necessary condition.",
        terms: ["stability", "condition"]
      }]
    }
  });

  expect(plan.intentWeights?.why).toBeGreaterThan(plan.intentWeights?.what ?? 0);
  expect(plan.intentSignals?.some((signal) => signal.startsWith("reading_path:why"))).toBe(true);
  expect(plan.explanationDepth).toBe("mechanistic");
  expect(plan.discourseMoves.join(" ")).toContain("边界");
  expect(plan.externalKnowledgeNeeded).toBe(false);
});

test("retrieves external knowledge only from explicit source scope before semantic answerability review", () => {
  const base = {
    artifactId: "artifact-semantic-closure",
    depth: 9,
    paperIds: ["paper-1"],
    primaryPaperTitle: "Target Paper",
    source: { kind: "selected_text" as const, excerpt: "稳定性条件", prompt: "继续深入解释" },
    targetLanguage: "zh-CN"
  };
  const localPlan = planThinReadingInterpretation({
    context: base,
    prepared: {
      evidence: [{ summary: "论文给出稳定性条件。", quote: "The paper states the stability condition.", terms: ["stability"] }]
    }
  });
  const externalPlan = planThinReadingInterpretation({
    context: { ...base, prompt: "比较论文外的后续研究" },
    prepared: {
      evidence: [{ summary: "论文给出稳定性条件。", quote: "The paper states the stability condition.", terms: ["stability"] }]
    }
  });

  expect(localPlan.externalKnowledgeNeeded).toBe(false);
  expect(localPlan.explanationDepth).toBe("mechanistic");
  expect(externalPlan.externalKnowledgeNeeded).toBe(true);
});

test("uses semantic partial answerability to preserve paper evidence and add traceable external support", async () => {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => semanticBoundaryExternalResponse(),
    ok: true,
    status: 200
  }));
  let bodyAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-partial": [{
        page: 3,
        paperId: "paper-semantic-partial",
        paperTitle: "Bounded Retrieval Mechanism",
        snippet: "The mechanism ranks token interactions inside the indexed collection.",
        summary: "论文解释了索引集合内的交互排序机制。",
        tags: ["mechanism", "ranking"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(prompt, "partial")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const answer = prompt.includes("来源结构目标：paper_and_external")
        ? {
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: "论文解释了索引集合内部的词元交互如何按相似度完成排序。" }],
            externalKnowledge: ["openalex:W424242"],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            recommendedFigures: [],
            summary: "论文解释了索引集合内部的词元交互如何按相似度完成排序。外部研究补充说明，具体部署约束决定这一机制保持有效的条件。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "论文解释了索引集合内部的词元交互如何按相似度完成排序。"
            }, {
              evidenceIds: [],
              externalKnowledge: ["openalex:W424242"],
              status: "weak",
              text: "外部研究补充说明，具体部署约束决定这一机制保持有效的条件。"
            }],
            withinPaperClosure: false
          }
        : paperInterpretationAnswer("论文解释了索引集合内部的词元交互如何按相似度完成排序。", evidenceId);
      return {
        json: async () => ({
          answer: JSON.stringify(answer),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么这一机制在不同部署条件下会有不同边界？",
    selectedPapers: [{ id: "paper-semantic-partial", title: "Bounded Retrieval Mechanism" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-partial",
      depth: 2,
      paperIds: ["paper-semantic-partial"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-partial",
      primaryPaperTitle: "Bounded Retrieval Mechanism",
      prompt: "为什么这一机制在不同部署条件下会有不同边界？",
      source: { excerpt: "交互排序机制", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  expect(bodyAttempts).toBe(2);
  expect(externalTransport).toHaveBeenCalled();
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "near_boundary",
    supportMode: "paper_and_external",
    withinPaperClosure: false
  });
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toHaveLength(1);
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([
    "openalex:W424242"
  ]);
  expect(
    result.thinReading?.rootSeed.evidence.generationAudit?.paperAnswerabilityTransition
  ).toMatchObject({ status: "partial", targetSupportMode: "paper_and_external" });
});

test("uses AI interpretation after malformed retrieval at a semantic paper boundary", async () => {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => ({
      provider: "openalex",
      query: "deployment boundary",
      sources: "malformed",
      status: "available"
    }),
    ok: true,
    status: 200
  }));
  const bodyPrompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-malformed": [{
        page: 3,
        paperId: "paper-semantic-malformed",
        paperTitle: "Bounded Retrieval Mechanism",
        snippet: "The mechanism ranks token interactions inside the indexed collection.",
        summary: "论文解释了索引集合内的交互排序机制。",
        tags: ["mechanism", "ranking"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(prompt, "partial")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句是明确披露的概念推理，没有伪造来源归因。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify(prompt.includes("AI 独立理解")
            ? aiInterpretationAnswer("一种可能的理解是，部署条件或许会改变交互排序机制的有效边界。")
            : paperInterpretationAnswer(
                "论文解释了索引集合内部的词元交互如何按相似度完成排序。",
                evidenceId
              )),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么这一机制在不同部署条件下会有不同边界？",
    selectedPapers: [{ id: "paper-semantic-malformed", title: "Bounded Retrieval Mechanism" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-malformed",
      depth: 2,
      paperIds: ["paper-semantic-malformed"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-malformed",
      primaryPaperTitle: "Bounded Retrieval Mechanism",
      prompt: "为什么这一机制在不同部署条件下会有不同边界？",
      source: { excerpt: "交互排序机制", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  const generated = await result;

  expect(generated.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(generated.thinReading?.rootSeed.evidence.generationAudit?.externalRetrieval?.routeOutcomes)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ failureKind: "invalid_response", status: "failed" })
    ]));
  expect(bodyPrompts).toHaveLength(2);
  expect(externalTransport).toHaveBeenCalledTimes(3);
  expect(bodyPrompts[0]).not.toContain("AI 独立理解");
  expect(bodyPrompts[1]).toContain("AI 独立理解");
});

test("returns to paper support when the post-retrieval semantic review finds the paper complete", async () => {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => semanticBoundaryExternalResponse(),
    ok: true,
    status: 200
  }));
  let bodyAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-reconsidered": [{
        page: 3,
        paperId: "paper-semantic-reconsidered",
        paperTitle: "Bounded Retrieval Mechanism",
        snippet: "The paper explains both token ranking and the conditions under which it remains effective.",
        summary: "论文同时解释了词元排序及其成立条件。",
        tags: ["mechanism", "boundary"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(
              prompt,
              reviewAttempts === 1 ? "partial" : "complete"
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const paperSentence = "论文解释了索引集合中的词元排序机制及其保持有效所需的条件。";
      const answer = prompt.includes("来源结构目标：paper_and_external")
        ? {
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: paperSentence }],
            externalKnowledge: ["openalex:W424242"],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            recommendedFigures: [],
            summary: `${paperSentence}外部研究还讨论了更一般的部署约束。`,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: paperSentence
            }, {
              evidenceIds: [],
              externalKnowledge: ["openalex:W424242"],
              status: "weak",
              text: "外部研究还讨论了更一般的部署约束。"
            }],
            withinPaperClosure: false
          }
        : paperInterpretationAnswer(paperSentence, evidenceId);
      return {
        json: async () => ({
          answer: JSON.stringify(answer),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么这一机制只在特定条件下保持有效？",
    selectedPapers: [{ id: "paper-semantic-reconsidered", title: "Bounded Retrieval Mechanism" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-reconsidered",
      depth: 2,
      paperIds: ["paper-semantic-reconsidered"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-reconsidered",
      primaryPaperTitle: "Bounded Retrieval Mechanism",
      prompt: "为什么这一机制只在特定条件下保持有效？",
      source: { excerpt: "词元排序及其成立条件", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  expect(bodyAttempts).toBe(3);
  expect(reviewAttempts).toBe(3);
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "inside_paper",
    supportMode: "paper",
    withinPaperClosure: true,
    evidence: {
      externalKnowledge: [],
      paperEvidence: [expect.stringMatching(/^evidence-/)]
    }
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty(
    "paperAnswerabilityTransition"
  );
  expect(result.thinReading?.qualityGate).toEqual({
    attempts: 3,
    repaired: false,
    repairReasons: []
  });
});

test("reclassifies a tentative partial boundary as external-only when the later semantic review finds no paper answer", async () => {
  const { bodyAttempts, externalTransport, result, reviewAttempts } = await runSemanticAnswerabilityCorrection({
    correctedStatus: "none",
    initialStatus: "partial"
  });

  expect(bodyAttempts).toBe(3);
  expect(reviewAttempts).toBe(3);
  expect(externalTransport).toHaveBeenCalled();
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "outside_paper",
    supportMode: "external_only",
    withinPaperClosure: false,
    evidence: {
      externalKnowledge: ["openalex:W424242"],
      paperEvidence: []
    }
  });
  expect(
    result.thinReading?.rootSeed.evidence.generationAudit?.paperAnswerabilityTransition
  ).toMatchObject({ status: "none", targetSupportMode: "external_only" });
});

test("can recover from a tentative none boundary because later review still sees the target-paper evidence", async () => {
  const { bodyAttempts, externalTransport, result, reviewAttempts } = await runSemanticAnswerabilityCorrection({
    correctedStatus: "partial",
    initialStatus: "none"
  });

  expect(bodyAttempts).toBe(3);
  expect(reviewAttempts).toBe(3);
  expect(externalTransport).toHaveBeenCalled();
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "near_boundary",
    supportMode: "paper_and_external",
    withinPaperClosure: false,
    evidence: {
      externalKnowledge: ["openalex:W424242"],
      paperEvidence: [expect.stringMatching(/^evidence-/)]
    }
  });
  expect(
    result.thinReading?.rootSeed.evidence.generationAudit?.paperAnswerabilityTransition
  ).toMatchObject({ status: "partial", targetSupportMode: "paper_and_external" });
});

test("uses semantic none answerability to regenerate from traceable external sources only", async () => {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => semanticBoundaryExternalResponse(),
    ok: true,
    status: 200
  }));
  let bodyAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-none": [{
        page: 2,
        paperId: "paper-semantic-none",
        paperTitle: "Token Interaction Definition",
        snippet: "The paper defines token interaction for a fixed benchmark.",
        summary: "论文只定义了固定基准中的词元交互。",
        tags: ["definition", "benchmark"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(prompt, "none")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const answer = prompt.includes("来源结构目标：external_only")
        ? {
            claims: [],
            externalKnowledge: ["openalex:W424242"],
            omittedSections: [],
            paperEvidence: [],
            paperType: "systems",
            recommendedFigures: [],
            summary: "外部研究表明，具体部署资源约束决定检索机制能够保持有效的条件。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: ["openalex:W424242"],
              status: "weak",
              text: "外部研究表明，具体部署资源约束决定检索机制能够保持有效的条件。"
            }],
            withinPaperClosure: false
          }
        : paperInterpretationAnswer("论文只定义了固定基准场景中的词元交互及其基本计算方式。", evidenceId);
      return {
        json: async () => ({
          answer: JSON.stringify(answer),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "工业部署时应采用哪些资源约束？",
    selectedPapers: [{ id: "paper-semantic-none", title: "Token Interaction Definition" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-none",
      depth: 1,
      paperIds: ["paper-semantic-none"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-none",
      primaryPaperTitle: "Token Interaction Definition",
      prompt: "工业部署时应采用哪些资源约束？",
      source: { excerpt: "词元交互", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  expect(bodyAttempts).toBe(2);
  expect(externalTransport).toHaveBeenCalled();
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "outside_paper",
    supportMode: "external_only",
    withinPaperClosure: false
  });
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([
    "openalex:W424242"
  ]);
  expect(
    result.thinReading?.rootSeed.evidence.generationAudit?.paperAnswerabilityTransition
  ).toMatchObject({ status: "none", targetSupportMode: "external_only" });
});

test("enters AI interpretation only after a semantic paper gap exhausts external retrieval", async () => {
  const store = createSettingsStore();
  const externalTransport = vi.fn(async () => ({
    json: async () => ({ provider: "openalex", query: "deployment boundary", sources: [], status: "empty" }),
    ok: true,
    status: 200
  }));
  let bodyAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-semantic-ai": [{
        page: 4,
        paperId: "paper-semantic-ai",
        paperTitle: "Bounded Retrieval Mechanism",
        snippet: "The paper explains ranking inside the indexed collection.",
        summary: "论文解释了索引集合内部的排序。",
        tags: ["ranking", "index"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "正文明确保持为无来源的可能性分析，没有伪造论文或外部资料支持。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(prompt, "partial")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const answer = prompt.includes("AI 独立理解")
        ? aiInterpretationAnswer("一种可能的理解是，部署边界同时受资源预算和数据分布变化影响，但当前没有可追溯来源可作确认。")
        : paperInterpretationAnswer("论文解释了索引集合内部的词元交互如何形成排序结果。", evidenceId);
      return {
        json: async () => ({
          answer: JSON.stringify(answer),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么这一机制在不同部署条件下会有不同边界？",
    selectedPapers: [{ id: "paper-semantic-ai", title: "Bounded Retrieval Mechanism" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-semantic-ai",
      depth: 2,
      paperIds: ["paper-semantic-ai"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-semantic-ai",
      primaryPaperTitle: "Bounded Retrieval Mechanism",
      prompt: "为什么这一机制在不同部署条件下会有不同边界？",
      source: { excerpt: "词元交互排序", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  expect(bodyAttempts).toBe(2);
  expect(externalTransport).toHaveBeenCalledTimes(3);
  expect(result.thinReading?.qualityGate.repaired).toBe(false);
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "outside_paper",
    supportMode: "ai_interpretation",
    withinPaperClosure: false,
    evidence: {
      externalKnowledge: [],
      paperEvidence: [],
      generationAudit: {
        externalFallback: {
          reason: "no_trusted_sources",
          trustedSourceCount: 0
        },
        paperAnswerabilityTransition: {
          status: "partial",
          targetSupportMode: "ai_interpretation"
        }
      }
    }
  });
});

test("gives experimental root overviews a conclusion-reasoning-field-position retention spine", () => {
  const plan = planThinReadingInterpretation({
    context: {
      artifactId: "artifact-experimental-retention",
      depth: 0,
      paperIds: ["paper-1"],
      primaryPaperTitle: "Ablation Study of a Robust Learning Method",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    prepared: {
      evidence: [{
        summary: "论文通过实验和消融报告核心性能结论，并与既有基线比较。",
        quote: "Experiments and ablations establish the central result against prior baselines.",
        terms: ["experiment", "ablation", "baseline", "result"]
      }]
    }
  });

  expect(plan.intent).toBe("mixed");
  expect(plan.paperTypeHint).toBe("experimental");
  expect(plan.explanationDepth).toBe("overview");
  expect(plan.retentionFocus?.join(" ")).toContain("核心结论");
  expect(plan.retentionFocus?.join(" ")).toContain("领域");
  expect(plan.discourseMoves.join(" ")).toContain("既有认知");
  expect(plan.discourseMoves.join(" ")).toContain("本文新增");
});

test("parses thin-reading structured output from a live model request", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  let externalRetrievalCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "薄读审计通过。",
          score: 0.92,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.9,
              kind: "method",
              searchQuery: "late interaction passage retrieval",
              summarySentenceIndex: 0,
              text: "MaxSim late interaction"
            }],
            externalKnowledge: [],
            claims: [
              {
                evidenceIds: [evidenceId],
                status: "grounded",
                text: "ColBERT 用 MaxSim late interaction 保留细粒度匹配信号。"
              }
            ],
            omittedSections: [{ label: "实验", sectionKey: "experiment" }],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [
              {
                compatibility: 0.8,
                note: "本地待同步的理解线索。",
                relationship: "方法与问题设定"
              }
            ],
            summary: "ColBERT 的核心贡献是用 contextualized token embeddings 和 MaxSim late interaction 保留细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的核心贡献是用 contextualized token embeddings 和 MaxSim late interaction 保留细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRetrievalCalls += 1;
      return {
        json: async () => ({
          sources: [{
            abstract: "This study evaluates late interaction for efficient passage retrieval with fine-grained token matching.",
            authors: ["Ada Scholar"],
            id: "openalex:W123",
            provider: "openalex",
            relation: "related",
            relevance: 0.83,
            retrievalQuery: "late interaction passage retrieval",
            sourceId: "W123",
            sourceRecordUrl: "https://openalex.org/W123",
            title: "Late Interaction Retrieval",
            url: "https://example.org/late-interaction"
          }]
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(JSON.parse(requests[0].body)).toMatchObject({
    outputFormat: {
      name: "liteasy_thin_reading",
      schema: expect.objectContaining({
        additionalProperties: false,
        type: "object"
      }),
      strict: true
    },
    provider: "openai",
    requireLive: true,
    source: "cloud_proxy"
  });
  expect(result.thinReading?.rootSeed).toMatchObject({
    evidence: {
      claims: [
        expect.objectContaining({
          status: "grounded",
          text: expect.stringContaining("MaxSim")
        })
      ],
      paperEvidenceSpans: [
        expect.objectContaining({
          page: 2,
          paperId: "demo-1",
          quote: expect.stringContaining("MaxSim")
        })
      ],
      anchors: [
        expect.objectContaining({
          externalSourceIds: ["openalex:W123"],
          quality: {
            citationProvenance: 0,
            evidenceAttention: 1,
            evidenceCoverage: 0.25,
            reason: "核心方法 · 1 条证据",
            score: 0.5775
          },
          text: "MaxSim late interaction"
        })
      ]
    },
    paperType: "experimental",
    summary: expect.stringContaining("MaxSim"),
    withinPaperClosure: true
  });
  expect(result.content).toContain("ColBERT 的核心贡献");
  expect(externalRetrievalCalls).toBe(1);
});

test("persists ranked anchor quality when every per-anchor search fails", async () => {
  const store = createSettingsStore();
  let externalRetrievalCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction for fine-grained retrieval.",
        summary: "ColBERT 使用 MaxSim late interaction。",
        tags: ["ColBERT", "MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "ColBERT 使用 MaxSim late interaction 保留细粒度匹配信号。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.8,
              kind: "concept",
              searchQuery: "MaxSim late interaction",
              summarySentenceIndex: 0,
              text: "MaxSim late interaction"
            }],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-anchor-search-failure",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRetrievalCalls += 1;
      return {
        json: async () => ({ message: "search unavailable" }),
        ok: false,
        status: 503
      };
    }
  });

  expect(externalRetrievalCalls).toBe(1);
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({
      externalSourceIds: [],
      quality: {
        citationProvenance: 0,
        evidenceAttention: 1,
        evidenceCoverage: 0.25,
        reason: "核心概念 · 1 条证据",
        score: expect.any(Number)
      }
    })
  ]);
  expect(result.thinReading?.rootSeed.evidence.anchors?.[0]?.quality?.score).toBeCloseTo(0.5425, 8);
});

test("runs thin-reading through the DeepSeek provider without downgrading to mock data", async () => {
  const store = createSettingsStore();
  const requests: Array<{ body: string; url: string }> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "DeepSeek 薄读审计通过。",
          score: 0.9,
          verdict: "pass"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            externalKnowledge: [],
            claims: [
              {
                evidenceIds: [evidenceId],
                status: "grounded",
                text: "ColBERT 通过 MaxSim late interaction 保留 token-level matching signals。"
              }
            ],
            omittedSections: [{ label: "消融", sectionKey: "ablation" }],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "ColBERT 的薄读核心是用 MaxSim late interaction 把 contextualized token embeddings 转化为细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的薄读核心是用 MaxSim late interaction 把 contextualized token embeddings 转化为细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "deepseek"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-deepseek",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(JSON.parse(requests[0].body)).toMatchObject({
    model: "deepseek-v4-flash",
    provider: "deepseek",
    requireLive: true,
    source: "cloud_proxy"
  });
  expect(result.executionTrace).toMatchObject({
    backend: "dev_cloud",
    mode: "live",
    provider: "deepseek"
  });
  expect(result.thinReading?.rootSeed).toMatchObject({
    paperType: "experimental",
    summary: expect.stringContaining("MaxSim"),
    withinPaperClosure: true
  });
});

test("rewrites a truthful but unfocused homepage after the root orientation audit", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT separately encodes query and document token embeddings, applies late interaction with MaxSim, and evaluates effectiveness and latency.",
        summary: "ColBERT 分别编码查询和文档词元，以 MaxSim 实现 late interaction，并同时评测效果与延迟。",
        tags: ["ColBERT", "late interaction", "MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        const rootOrientation = reviewAttempts === 1
          ? {
              conclusionSupport: {
                chains: [{
                  conclusionSentenceId: evidenceReviewPropositions(prompt)[0]?.sentenceId ?? "thin-reading-sentence-missing",
                  reason: "当前正文只给出方法名称，没有形成支持核心结论的充分过程。",
                  supportKinds: ["mechanism" as const],
                  supportSentenceIds: [evidenceReviewPropositions(prompt)[0]?.sentenceId ?? "thin-reading-sentence-missing"],
                  verdict: "partial" as const
                }],
                reason: "核心结论缺少机制与决定性评测的完整连接。",
                status: "partial" as const
              },
              coreIdea: "covered" as const,
              fieldPosition: "evidence_unavailable" as const,
              paperPanorama: "missing" as const,
              paperType: "experimental" as const,
              paperTypeVerdict: "supported" as const,
              reason: "正文命题都真实，但只给出方法名，没有建立问题、机制与决定性评测边界之间的关系。",
              retentionVerdict: "unfocused" as const,
              verdict: "fail" as const
            }
          : evidenceReviewRootOrientation(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个正文句均由其绑定证据直接支持。",
              rootOrientation,
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }

      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = generationPrompts.length === 1
        ? "ColBERT 提出 late interaction（后期交互）并使用 MaxSim。"
        : "ColBERT 分别编码查询与文档词元，再用 MaxSim 完成 late interaction（后期交互），从而把核心机制与效果、延迟两类评测边界连成完整主轴。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-root-orientation-repair",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("薄读首页方向质量门");
  expect(generationPrompts[1]).toContain("本轮属于首页方向质量门后的定向修复");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("薄读首页方向质量门未通过")]
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceReview?.rootOrientation).toMatchObject({
    conclusionSupport: { status: "complete" },
    coreIdea: "covered",
    paperPanorama: "covered",
    retentionVerdict: "focused",
    verdict: "pass"
  });
});

test("isolates an advisory revision sentence and re-reviews the remaining logic chain", async () => {
  const store = createSettingsStore();
  let bodyAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-content-isolation": [{
        page: 5,
        paperId: "paper-content-isolation",
        paperTitle: "Interaction Pipeline",
        snippet: "The pipeline preserves token-level signals through ordered interaction and reports a separate implementation detail.",
        summary: "流水线通过有序交互保留词元级信号，同时报告一项独立实现细节。",
        tags: ["pipeline", "interaction"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const propositions = evidenceReviewPropositions(prompt);
        const sentenceIds = propositions.map((item) => item.sentenceId);
        const shouldRevise = reviewAttempts <= 2 && sentenceIds.length > 1;
        return {
          json: async () => ({
            answer: JSON.stringify({
              contentQuality: shouldRevise
                ? {
                    depthFit: "appropriate",
                    focus: "diffuse",
                    intentAlignment: "diluted",
                    logicChain: "complete",
                    reason: "第二句虽有证据，但与当前机制问题无关，分散了主轴。",
                    revisionSentenceIds: [sentenceIds[1]],
                    severity: "advisory",
                    verdict: "revise"
                  }
                : {
                    depthFit: "appropriate",
                    focus: "focused",
                    intentAlignment: "aligned",
                    logicChain: "complete",
                    reason: "剩余句直接回答当前机制问题，逻辑链完整且聚焦。",
                    revisionSentenceIds: [],
                    severity: "none",
                    verdict: "pass"
                  },
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: propositions,
              reason: "每个正文句均由绑定论文证据直接支持。",
              rootOrientation: null,
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const sentences = [
        "该流水线让词元级信号沿有序交互过程逐步保留，从而形成可解释的处理主轴。",
        "论文还报告了一项与当前机制问题没有直接关系的独立实现细节。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            recommendedFigures: [],
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "这一交互流水线是怎样保留词元级信号的？",
    selectedPapers: [{ id: "paper-content-isolation", title: "Interaction Pipeline" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-content-isolation",
      depth: 2,
      paperIds: ["paper-content-isolation"],
      parentWithinPaperClosure: true,
      primaryPaperId: "paper-content-isolation",
      primaryPaperTitle: "Interaction Pipeline",
      prompt: "这一交互流水线是怎样保留词元级信号的？",
      source: { excerpt: "有序交互过程", kind: "selected_text" },
      targetLanguage: "zh-CN"
    }
  });

  expect(bodyAttempts).toBe(2);
  expect(reviewAttempts).toBe(3);
  expect(result.thinReading?.rootSeed.summary).toBe(
    "该流水线让词元级信号沿有序交互过程逐步保留，从而形成可解释的处理主轴。"
  );
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceReview?.contentQuality)
    .toMatchObject({ focus: "focused", verdict: "pass" });
  expect(result.thinReading?.qualityGate.repairReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("已隔离成文复核仍建议删除的非必要句")
  ]));
});

test("keeps a root overview only when its conclusion-support chain survives sentence isolation", async () => {
  const store = createSettingsStore();
  let bodyAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-root": [{
        page: 2,
        paperId: "demo-root",
        paperTitle: "Signal Retention",
        snippet: "The mechanism retains decisive signals and improves the target result under the evaluated setting.",
        summary: "该机制通过保留决定性信号改善目标结果。",
        tags: ["mechanism", "result"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = body.prompt;
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        reviewAttempts += 1;
        const unsupportedSentenceId = prompt.split("\n")
          .find((line) => line.includes("所有场景都绝对成立"))
          ?.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1];
        const unsupportedSentenceIds = unsupportedSentenceId ? [unsupportedSentenceId] : [];
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: unsupportedSentenceIds.length > 0
                ? "最后一句把论文范围扩张为无条件结论；前两句仍构成核心结论及其机制支持。"
                : "隔离范围扩张句后，核心结论及其最短支持链仍完整。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: unsupportedSentenceIds.length > 0 ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const sentences = [
        "论文的核心结论是，该机制能够改善目标结果。",
        "关键过程是机制保留决定性信号，从而产生这一改善。",
        "这一结论在所有场景都绝对成立。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendedFigures: [],
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读总述",
    selectedPapers: [{ id: "demo-root", title: "Signal Retention" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-root-sentence-isolation",
      depth: 0,
      paperIds: ["demo-root"],
      primaryPaperId: "demo-root",
      primaryPaperTitle: "Signal Retention",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(bodyAttempts).toBe(3);
  expect(reviewAttempts).toBe(4);
  expect(result.thinReading?.rootSeed.summary).not.toContain("所有场景都绝对成立");
  expect(result.thinReading?.rootSeed.evidence.summarySentences).toHaveLength(2);
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceReview?.rootOrientation)
    .toMatchObject({ conclusionSupport: { status: "complete" }, verdict: "pass" });
  expect(result.thinReading?.qualityGate.repairReasons.join(" "))
    .toContain("已隔离证据复核仍未通过的正文句");
});

test.each([
  {
    caseName: "homepage",
    depth: 0,
    source: { kind: "root_overview" as const }
  },
  {
    caseName: "drill-down",
    depth: 1,
    source: { excerpt: "MaxSim late interaction", kind: "selected_text" as const }
  }
])("allows a third $caseName generation only for a sentence-targeted evidence repair", async ({
  caseName,
  depth,
  source
}) => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  const generationPrompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT separately encodes query and document embeddings and applies MaxSim late interaction.",
        summary: "ColBERT 分别编码查询和文档向量，并应用 MaxSim late interaction。",
        tags: ["ColBERT", "MaxSim", "late interaction"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        const sentenceId = prompt.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? "";
        const unsupportedSentenceIds = reviewAttempts < 3 ? [sentenceId] : [];
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: reviewAttempts < 3
                ? "该句仍加入了绑定证据没有明示的离线预编码能力，必须继续收窄。"
                : "第三轮正文已收窄为绑定证据直接支持的机制。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: reviewAttempts < 3 ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }

      generationAttempts += 1;
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = generationAttempts < 3
        ? "ColBERT 通过文档离线预编码和 MaxSim late interaction 提升检索效率。"
        : "ColBERT 分别编码查询和文档向量，再应用 MaxSim late interaction 完成相关性计算。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: `artifact-third-${caseName}-evidence-repair`,
      depth,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source,
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(3);
  expect(reviewAttempts).toBe(3);
  expect(generationPrompts[2]).toContain("必须原样保留的已通过句");
  expect(generationPrompts[2]).toContain("失败句绑定的论文原文证据");
  expect(result.thinReading?.rootSeed.summary).not.toContain("离线预编码");
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 3, repaired: true });
});

test("uses a live evidence plan to narrow a large thin-reading evidence matrix", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  let plannedEvidenceIds: string[] = [];
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Planning Paper",
        snippet: `Evidence passage ${index + 1} describes the method and result.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method", `signal-${index + 1}`]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      if (prompt.includes("证据规划 Agent")) {
        plannedEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)].slice(0, 3).map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({ focus: ["核心机制", "主要结果"], selectedEvidenceIds: plannedEvidenceIds }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮观察已覆盖核心机制、主要结果与必要限定。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        const isFormatRetry = prompt.includes("上一轮证据复核输出未通过结构校验");
        if (!isFormatRetry) {
          reviewAttempts += 1;
        }
        const sentenceId = prompt.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(isFormatRetry
              ? {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
                  reason: "该句将三段证据共同支撑的范围表述得过强，需要压缩为可直接验证的判断。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : reviewAttempts === 1
                ? {
                    reason: "首次复核故意遗漏逐句命题判定，用于验证结构重试。",
                    unsupportedSentenceIds: [sentenceId],
                    verdict: "fail"
                  }
                : {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "通过",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "该方法的核心机制由三段关键证据共同支撑，并给出主要结果。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [plannedEvidenceIds[0]], status: "grounded", text: "核心机制得到关键证据支持。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: plannedEvidenceIds,
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{ evidenceIds: [plannedEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-evidence-plan",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Planning Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(7);
  expect(prompts[1]).toContain("证据观察 Agent");
  expect(prompts[2]).not.toContain("Evidence summary 8");
  expect(prompts[3]).toContain("证据复核 Agent");
  expect(prompts[4]).toContain("上一轮证据复核输出未通过结构校验");
  expect(prompts[4]).toContain("propositionVerdicts 必须覆盖每个实际 sentence ID");
  expect(prompts[4]).toContain("unsupportedSentenceIds 为空时 verdict=pass");
  expect(prompts[4]).not.toContain("reason 必须是 8-420");
  expect(prompts[5]).toContain("薄读证据复核未通过");
  expect(prompts[5]).toContain("只允许修改这些失败句及依赖它们的 claims");
  expect(prompts[5]).toContain("改写为绑定 evidence 直接蕴含的最小命题");
  expect(prompts[5]).toContain("Evidence passage 1 describes the method and result");
  expect(prompts[5]).toContain("必须原样保留的已通过句");
  expect(prompts[5]).toContain("最终修复检查清单");
  expect(prompts[5]).toContain("不得使用其他句子或相邻段落的未绑定证据");
  expect(prompts[5]).toContain("同步重建 summary、summarySentences 与相关 claims");
  expect(prompts[5].lastIndexOf("最终修复检查清单")).toBeGreaterThan(prompts[5].lastIndexOf("</invalid_output>"));
  expect(prompts[6]).toContain("证据复核 Agent");
  expect(result.thinReading?.evidencePlan).toMatchObject({ selectedEvidenceIds: plannedEvidenceIds });
  expect(result.thinReading?.evidenceLoop).toMatchObject({
    rounds: [expect.objectContaining({ round: 1 })],
    stopReason: "observation_sufficient"
  });
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual(plannedEvidenceIds);
});

test("uses reviewer-only retries when evidence review formatting remains invalid", async () => {
  const store = createSettingsStore();
  let bodyCalls = 0;
  let reviewCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const generation = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-review-format": [{
        page: 1,
        paperId: "paper-review-format",
        paperTitle: "Review Format",
        snippet: "The mechanism preserves the decisive signal.",
        summary: "该机制保留决定性信号。",
        tags: ["mechanism"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        reviewCalls += 1;
        return {
          json: async () => ({
            answer: "not-json",
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyCalls += 1;
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "该机制通过保留决定性信号来稳定后续判断，并避免关键信息在处理中丢失。";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer(summary, evidenceId)),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "这一机制是什么？",
    selectedPapers: [{ id: "paper-review-format", title: "Review Format" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-review-format-budget",
      depth: 1,
      paperIds: ["paper-review-format"],
      primaryPaperId: "paper-review-format",
      primaryPaperTitle: "Review Format",
      source: { excerpt: "decisive signal", kind: "selected_text" },
      targetLanguage: "zh-CN"
    }
  });

  await expect(generation).rejects.toThrow("薄读证据复核返回格式无效");
  await expect(generation).rejects.not.toThrow("薄读 Agent 结构质量门连续失败");
  expect(bodyCalls).toBe(1);
  expect(reviewCalls).toBe(3);
});

test("recovers transient evidence review transport failures without regenerating the body", async () => {
  const reviewError = new Error("evidence review transport temporarily unavailable");
  const run = generateEvidenceReviewTransportBoundaryForTest({
    failuresBeforeSuccess: 2,
    reviewError
  });

  const result = await run.result;

  expect(result.thinReading?.rootSeed.supportMode).toBe("paper");
  expect(run.bodyCallCount()).toBe(1);
  expect(run.reviewCallCount()).toBe(3);
});

test("fails after three evidence review transport attempts without regenerating the body", async () => {
  const reviewError = new Error("evidence review transport remains unavailable");
  const run = generateEvidenceReviewTransportBoundaryForTest({
    failuresBeforeSuccess: 3,
    reviewError
  });

  await expect(run.result).rejects.toBe(reviewError);
  expect(run.bodyCallCount()).toBe(1);
  expect(run.reviewCallCount()).toBe(3);
});

test("recovers unplanned paper evidence before crossing the semantic source boundary", async () => {
  const store = createSettingsStore();
  const bodyPrompts: string[] = [];
  let reviewAttempts = 0;
  const externalTransport = vi.fn(async () => ({
    json: async () => semanticBoundaryExternalResponse(),
    ok: true,
    status: 200
  }));
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-local-recovery": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "paper-local-recovery",
        paperTitle: "Freezing Boundary Paper",
        snippet: index === 19
          ? "The freeze point is the necessary boundary condition that keeps variable registration stable."
          : index === 0
            ? "The architecture contains a variable registry and a named freeze point."
            : `Background passage ${index + 1} describes a neighboring implementation detail.`,
        summary: index === 19
          ? "冻结点是维持变量注册稳定性的必要边界条件。"
          : index === 0
            ? "架构包含变量注册表与 freeze point（冻结点）。"
            : `背景材料 ${index + 1}。`,
        tags: index === 19
          ? ["freeze point", "boundary condition", "variable registry"]
          : index === 0
            ? ["freeze point", "variable registry"]
            : ["background"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        const firstEvidenceId = prompt.match(/\[(evidence-[^\]]+)\] p\.1/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["变量注册机制"],
              pageRequests: [1],
              searchQueries: [],
              selectedEvidenceIds: [firstEvidenceId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_observation") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮证据已经解释变量注册的基本机制。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        reviewAttempts += 1;
        const propositions = evidenceReviewPropositions(prompt);
        const sentenceIds = propositions.map((item) => item.sentenceId);
        const paperEvidenceIds = [...new Set(
          [...prompt.matchAll(/^- id=(evidence-[^;\s]+);/gm)].map((match) => match[1])
        )];
        const complete = prompt.includes("freeze point is the necessary boundary condition");
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: {
                answerObligations: [{
                  obligation: "解释 freeze point（冻结点）为何是变量注册稳定性的必要边界条件",
                  paperCoverage: complete ? "complete" : "partial",
                  paperEvidenceIds: paperEvidenceIds.slice(0, 8),
                  reason: complete
                    ? "补读证据直接给出了冻结点与变量注册稳定性之间的必要条件关系。"
                    : "当前规划证据只解释变量注册，没有覆盖冻结点这一必要边界条件。"
                }],
                paperSupportedSentenceIds: sentenceIds,
                reason: complete
                  ? "目标论文证据可以完整回答当前问题。"
                  : "目标论文当前可见证据只回答了机制的一部分。",
                status: complete ? "complete" : "partial"
              },
              propositionVerdicts: propositions,
              reason: "当前正文句均由其绑定证据直接支持。",
              rootOrientation: null,
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }

      bodyPrompts.push(prompt);
      const recoveredEvidenceId = prompt.match(/\[(evidence-[^\]]+)\] p\.20/)?.[1];
      const evidenceId = recoveredEvidenceId ?? prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "";
      const summary = recoveredEvidenceId
        ? "freeze point（冻结点）通过固定变量注册完成后的边界，使后续执行阶段保持注册状态稳定。"
        : "该架构同时包含变量注册表与 freeze point（冻结点），但当前证据尚未解释两者为何共同维持执行状态稳定。";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer(summary, evidenceId)),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么 freeze point（冻结点）能保证变量注册稳定？",
    selectedPapers: [{ id: "paper-local-recovery", title: "Freezing Boundary Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-local-paper-recovery",
      depth: 2,
      paperIds: ["paper-local-recovery"],
      primaryPaperId: "paper-local-recovery",
      primaryPaperTitle: "Freezing Boundary Paper",
      prompt: "为什么 freeze point（冻结点）能保证变量注册稳定？",
      source: { excerpt: "freeze point（冻结点）", kind: "selected_text" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: externalTransport
  });

  expect(bodyPrompts).toHaveLength(2);
  expect(bodyPrompts[0]).not.toContain("freeze point is the necessary boundary condition");
  expect(bodyPrompts[1]).toContain("freeze point is the necessary boundary condition");
  expect(reviewAttempts).toBe(2);
  expect(externalTransport).not.toHaveBeenCalled();
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "inside_paper",
    supportMode: "paper",
    withinPaperClosure: true
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.paperEvidenceRecovery).toMatchObject({
    finalAnswerability: "complete",
    status: "resolved"
  });
});

test("normalizes planner overflow and audits an unavailable observer without failing generation", async () => {
  const store = createSettingsStore();
  let planningCalls = 0;
  let selectedEvidenceId = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Planner Overflow Paper",
        snippet: `Evidence passage ${index + 1} describes the method.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        planningCalls += 1;
        selectedEvidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["核心机制"],
              pageRequests: [1, 2, 3, 4],
              searchQueries: [],
              selectedEvidenceIds: [selectedEvidenceId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_observation") {
        return {
          json: async () => ({ error: "observer temporarily unavailable" }),
          ok: false,
          status: 503
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "该论文的核心机制由本轮限定证据直接支持，并明确说明了结论成立的适用边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: [{ evidenceIds: [selectedEvidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [selectedEvidenceId],
            paperType: "experimental",
            summary,
            summarySentences: [{
              evidenceIds: [selectedEvidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Planner Overflow Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-planner-overflow-normalized",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Planner Overflow Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(planningCalls).toBe(1);
  expect(result.thinReading?.evidencePlan?.pageRequests).toEqual([1, 2, 3]);
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidencePlanning).toMatchObject({
    mode: "model",
    normalization: {
      truncated: { pageRequests: 1 }
    },
    repairApplied: false
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceLoop).toMatchObject({
    fallback: "deterministic_first_round",
    rounds: [expect.objectContaining({ round: 1 })],
    stopReason: "observer_unavailable"
  });
});

test("continues thin reading with a bounded deterministic evidence scope when planning API fails", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const generationPrompts: string[] = [];
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 40 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Resilient Planning Paper",
        snippet: index === 39
          ? "Conclusion: We demonstrate the paper's decisive late-stage result."
          : `Evidence passage ${index + 1} describes the method.`,
        summary: index === 39
          ? "Late conclusion summary preserves the paper's decisive result."
          : `Evidence summary ${index + 1}.`,
        tags: ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        throw new Error("fetch failed");
      }
      const prompt = String(body.prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "";
      const summary = "该论文的方法由确定性范围内的证据直接支持，并清楚界定了核心机制与结论边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Resilient Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-planning-fallback",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Resilient Planning Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.thinReading?.evidencePlan).toBeUndefined();
  expect(result.thinReading?.rootSeed.summary).toContain("确定性范围");
  expect(generationPrompts[0]).toContain("Late conclusion summary preserves the paper's decisive result.");
  const evidencePlanning = result.thinReading?.rootSeed.evidence.generationAudit?.evidencePlanning;
  expect(evidencePlanning).toEqual({
    mode: "deterministic_fallback",
    reason: "transport_unavailable",
    repairApplied: false,
    selectedEvidenceIds: expect.arrayContaining([expect.stringMatching(/^evidence-/)])
  });
  expect(evidencePlanning?.selectedEvidenceIds).toHaveLength(18);
  const promptEvidenceIds = [...new Set(
    [...generationPrompts[0].matchAll(/\[(evidence-[^\]]+)\] p\.\d+/g)].map((match) => match[1])
  )];
  expect(promptEvidenceIds).toEqual(evidencePlanning?.selectedEvidenceIds);
});

test("continues thin reading deterministically when evidence-plan repair remains invalid", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const generationPrompts: string[] = [];
  let planningAttempts = 0;
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 24 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Invalid Planner Paper",
        snippet: `Evidence passage ${index + 1} describes the method.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        planningAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify({ focus: "核心机制", selectedEvidenceIds: [] }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const prompt = String(body.prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "";
      const summary = "该论文的方法由确定性证据范围直接支持，并保留了核心机制与结论边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Invalid Planner Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-invalid-planning-fallback",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Invalid Planner Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(planningAttempts).toBe(2);
  expect(result.thinReading?.evidencePlan).toBeUndefined();
  expect(result.thinReading?.rootSeed.summary).toContain("确定性证据范围");
  expect(generationPrompts[0]).toContain("Evidence summary 18");
  expect(generationPrompts[0]).not.toContain("Evidence summary 19");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidencePlanning).toMatchObject({
    mode: "deterministic_fallback",
    reason: "format_invalid",
    repairApplied: true
  });
});

test("does not disguise planner authentication failures as deterministic fallback", async () => {
  const store = createSettingsStore();
  let nonPlanningCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 24 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Authentication Boundary Paper",
        snippet: `Evidence passage ${index + 1}.`,
        summary: `Evidence summary ${index + 1}.`,
        tags: ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_plan") {
        return {
          json: async () => ({ error: "authentication failed" }),
          ok: false,
          status: 401
        };
      }
      nonPlanningCalls += 1;
      throw new Error("正文生成不应在认证失败后继续");
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Authentication Boundary Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-planner-auth-boundary",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Authentication Boundary Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  })).rejects.toThrow("cloud_proxy 401");

  expect(nonPlanningCalls).toBe(0);
});

test("retries a cross-layer evidence ID with the current planning allowlist", async () => {
  const store = createSettingsStore();
  const planningPrompts: string[] = [];
  let planningAttempts = 0;
  let currentEvidenceIds: string[] = [];
  const staleEvidenceId = "evidence-previous-layer-7f2e";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Branch Planning Paper",
        snippet: `Branch evidence passage ${index + 1} describes the method mechanism.`,
        summary: `Branch evidence summary ${index + 1} explains the method mechanism.`,
        tags: ["branch", `signal-${index + 1}`]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据规划 Agent")) {
        planningPrompts.push(prompt);
        planningAttempts += 1;
        currentEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\] p\.\d+/g)]
          .slice(0, 2)
          .map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["核心机制"],
              selectedEvidenceIds: planningAttempts === 1 ? [staleEvidenceId] : currentEvidenceIds
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮观察已覆盖本次下钻所需的直接证据。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个句子均由本轮指定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "该段方法的核心机制由本轮多条直接论文证据共同支持。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [currentEvidenceIds[0]], status: "grounded", text: "该段方法由直接证据支持。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: currentEvidenceIds,
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{ evidenceIds: [currentEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "解释选中段落的机制",
    selectedPapers: [{ id: "demo-1", title: "Branch Planning Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-stale-evidence-plan",
      depth: 1,
      paperIds: ["demo-1"],
      parentClaims: [{
        evidenceIds: [staleEvidenceId],
        id: "thin-reading-claim-previous-layer",
        status: "grounded",
        text: "上一层给出了待细化的机制判断。"
      }],
      parentEvidenceSpans: [{
        chunkId: "demo-1:previous-layer:chunk-1",
        confidence: 0.9,
        id: staleEvidenceId,
        page: 2,
        paperId: "demo-1",
        quote: "Previous-layer evidence quote."
      }],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "Branch Planning Paper",
      source: {
        evidenceIds: [staleEvidenceId],
        excerpt: "待细化的机制判断",
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    }
  });

  expect(planningAttempts).toBe(2);
  expect(planningPrompts).toHaveLength(2);
  expect(planningPrompts[0]).not.toContain(staleEvidenceId);
  expect(planningPrompts[0]).not.toContain("thin-reading-claim-previous-layer");
  expect(planningPrompts[0]).not.toContain("demo-1:previous-layer:chunk-1");
  expect(planningPrompts[1]).toContain("上一轮证据规划返回了本轮目录之外的 evidence ID");
  expect(planningPrompts[1]).toContain("本轮唯一允许的 evidence ID");
  expect(planningPrompts[1]).not.toContain(staleEvidenceId);
  expect(result.thinReading?.evidencePlan?.selectedEvidenceIds).toEqual(currentEvidenceIds);
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual(currentEvidenceIds);
});

test("executes a bounded second evidence-tool round after observing a concrete gap", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  store.apply({ intent: "update_setting", target: "models.cloud_proxy_endpoint", value: "https://liteasy.example.com/model-proxy" });
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({ json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }), ok: true, status: 200 }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "Tool Loop Paper",
        snippet: index === 5 ? "Page six contains the MaxSim limitation." : `Page ${index + 1} contains method context.`,
        summary: index === 5 ? "MaxSim limitation." : `Method context ${index + 1}.`,
        tags: index === 5 ? ["MaxSim", "limitation"] : ["method"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据规划 Agent")) {
        const firstPageId = prompt.match(/\[(evidence-[^\]]+)\] p\.1/)?.[1] ?? "";
        return {
          json: async () => ({ answer: JSON.stringify({ focus: ["核心机制"], pageRequests: [], searchQueries: [], selectedEvidenceIds: [firstPageId] }), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true, status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        const pageSixId = prompt.match(/\[(evidence-[^\]]+)\] p\.6/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "continue",
              focus: ["MaxSim 限制"],
              pageRequests: [6],
              reason: "首轮只覆盖核心机制，缺少会改变结论边界的 MaxSim 限制证据。",
              searchQueries: ["MaxSim limitation"],
              selectedEvidenceIds: [pageSixId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify({ paperAnswerability: paperAnswerabilityForPrompt(prompt), propositionVerdicts: evidenceReviewPropositions(prompt), reason: "每句均有直接证据。", rootOrientation: evidenceReviewRootOrientation(prompt), unsupportedSentenceIds: [], verdict: "pass" }), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true, status: 200
        };
      }
      generationPrompts.push(prompt);
      const ids = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)].map((match) => match[1]);
      const selectedId = ids.at(-1) ?? ids[0];
      const summary = "该方法的限制需要结合第六页的 MaxSim evidence 阅读。";
      return {
        json: async () => ({
          answer: JSON.stringify({ claims: [{ evidenceIds: [selectedId], status: "grounded", text: "第六页给出 MaxSim limitation。" }], externalKnowledge: [], omittedSections: [], paperEvidence: [selectedId], paperType: "experimental", recommendations: [], summary, summarySentences: [{ evidenceIds: [selectedId], externalKnowledge: [], status: "grounded", text: summary }], withinPaperClosure: true }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }), ok: true, status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "Tool Loop Paper" }],
    settings: store.getState(),
    thinReadingContext: { artifactId: "artifact-tool-loop", depth: 0, paperIds: ["demo-1"], primaryPaperId: "demo-1", primaryPaperTitle: "Tool Loop Paper", source: { kind: "root_overview" }, targetLanguage: "zh-CN" }
  });

  expect(generationPrompts).toHaveLength(1);
  expect(generationPrompts[0]).toContain("Page six contains the MaxSim limitation.");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.evidenceToolCalls).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "search", query: "MaxSim limitation" }),
    expect.objectContaining({ kind: "view", pages: [6] })
  ]));
  expect(result.thinReading?.evidenceLoop).toMatchObject({
    rounds: [
      expect.objectContaining({ round: 1 }),
      expect.objectContaining({ round: 2, searchQueries: ["MaxSim limitation"] })
    ],
    stopReason: "maximum_rounds_reached"
  });
});

test("repairs an incomplete live thin-reading trace exactly once", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      prompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "ColBERT 用 MaxSim late interaction 保留细粒度匹配信号，并降低文档编码的在线成本。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{
              evidenceIds: [evidenceId],
              status: "grounded",
              text: "MaxSim 是核心机制。"
            }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            ...(prompts.length === 1 ? {} : {
              summarySentences: [{
                evidenceIds: [evidenceId],
                externalKnowledge: [],
                status: "grounded",
                text: summary
              }]
            }),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-repair",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("确定性结构质量门");
  expect(prompts[1]).toContain("只有该条目中的全部 source relation 都是 cited_by_target 或 cites_target");
  expect(prompts[1]).toContain("<invalid_output>");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("summarySentences 必须显式覆盖正文")]
  });
});

test("accepts a DeepSeek mechanism anchor without entering structured-output repair", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  const outputSchemas: Array<Record<string, unknown>> = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "DeepDendrite",
        snippet: "Dendritic hierarchical scheduling accelerates parallel Hines solves on GPUs.",
        summary: "DHS 加速 GPU 上的并行 Hines 求解。",
        tags: ["DHS", "Hines"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as {
        model?: string;
        outputFormat?: { schema?: Record<string, unknown> };
        prompt: string;
        provider?: string;
      };
      if (body.prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(body.prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
      expect(body).toMatchObject({ model: "deepseek-v4-flash", provider: "deepseek" });
      prompts.push(String(body.prompt));
      if (body.outputFormat?.schema) {
        outputSchemas.push(body.outputFormat.schema);
      }
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "dendritic hierarchical scheduling（树突分层调度）通过分层组织并行 Hines 求解来提高 GPU 利用率。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.95,
              kind: "mechanism",
              searchQuery: "dendritic hierarchical scheduling parallel Hines solve",
              summarySentenceIndex: 0,
              text: "dendritic hierarchical scheduling（树突分层调度）"
            }],
            claims: [{
              evidenceIds: [evidenceId],
              status: "grounded",
              text: "DHS 通过分层调度加速并行 Hines 求解。"
            }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "DeepDendrite" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-deepseek-mechanism",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "DeepDendrite",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(1);
  expect(outputSchemas).toHaveLength(1);
  expect(JSON.stringify(outputSchemas[0])).toContain("mechanism");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 1,
    repaired: false,
    repairReasons: []
  });
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({
      kind: "mechanism",
      text: "dendritic hierarchical scheduling（树突分层调度）"
    })
  ]);
  expect(result.thinReading?.rootSeed.evidence.anchors?.[0]).not.toHaveProperty("label");
});

test("repairs only invalid anchor spans and quarantines a repeated failure without losing the body", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: "deepseek"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: "CoreNEURON removes general data structures such as Node, Section, and Object to reduce memory use.",
        summary: "CoreNEURON 去除通用数据结构以降低内存使用。",
        tags: ["CoreNEURON", "data structures"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { prompt: string };
      if (body.prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(body.prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" } }),
          ok: true,
          status: 200
        };
      }
      prompts.push(body.prompt);
      const evidenceId = body.prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = "CoreNEURON 是面向神经元仿真的计算库。它支持在线和离线两种执行工作流。测试报告了内存与时间开销下降。内存改进源于去除 NEURON 的通用数据结构，如 Node、Section、Object。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.95,
              kind: "concept",
              searchQuery: "CoreNEURON library design",
              summarySentenceIndex: 0,
              text: "CoreNEURON"
            }, {
              importance: 0.8,
              kind: "mechanism",
              searchQuery: "CoreNEURON online offline mode",
              summarySentenceIndex: 1,
              text: "在线和离线两种执行工作流"
            }, {
              importance: 0.9,
              kind: "result",
              searchQuery: "CoreNEURON memory time reduction",
              summarySentenceIndex: 2,
              text: "内存与时间开销下降"
            }, {
              importance: 0.75,
              kind: "mechanism",
              searchQuery: "CoreNEURON data structure optimization",
              summarySentenceIndex: 3,
              text: "数据结构优化"
            }],
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: "CoreNEURON 去除通用数据结构以降低内存开销。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary,
            summarySentences: summary.match(/[^。]+。/g)?.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-anchor-quarantine",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(1);
  expect(result.thinReading?.rootSeed.summary).toContain("通用数据结构");
  expect(result.thinReading?.rootSeed.evidence.anchors).toHaveLength(3);
  expect(result.thinReading?.rootSeed.evidence.anchors?.some((anchor) => (
    anchor.text === "数据结构优化"
  ))).toBe(false);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 1, repaired: true });
  expect(result.thinReading?.qualityGate.repairReasons.join(" ")).toContain("薄读锚点必须逐字对应");
  expect(result.thinReading?.qualityGate.repairReasons.join(" ")).toContain("已隔离无效薄读锚点");
});

test("repairs a selected Chinese branch that omits an explicitly requested terminology pair", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "BERT",
        snippet: "The MLM objective enables a deep bidirectional Transformer.",
        summary: "MLM 让模型融合左右上下文。",
        tags: ["masked language modeling"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      prompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const summary = prompts.length === 1
        ? "掩码预测让模型融合左右上下文，因而可以预训练深度双向 Transformer。"
        : "masked language modeling（掩码语言建模）让模型融合左右上下文，因而可以预训练深度双向 Transformer。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: summary
            }],
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "解释 masked language modeling（掩码语言建模）如何支持双向预训练",
    selectedPapers: [{ id: "demo-1", title: "BERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-terminology-repair",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "BERT",
      source: {
        kind: "selected_text",
        excerpt: "masked language modeling（掩码语言建模）让模型融合左右上下文。"
      },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("中文选区明确要求保留“masked language modeling（掩码语言建模）”");
  expect(result.thinReading?.qualityGate).toMatchObject({
    attempts: 2,
    repaired: true,
    repairReasons: [expect.stringContaining("中文选区明确要求保留")]
  });
});

test("repairs only the failed numeric sentence with bounded source context", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "HelioX",
        snippet: "HelioX uses a GPU-native execution path. With 1000 neurons and batch size 4, inference speedup over JAXLEY is 4.33x; raw times include 60.41 ms and 5.06 ms.",
        summary: "HelioX 使用 GPU 原生执行路径；同一实验还报告了配置、原始时间与相对 JAXLEY 的 4.33 倍推理加速比。",
        tags: ["HelioX", "GPU-native", "inference speedup"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "修复后的两句均由绑定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const mechanism = generationAttempts === 1
        ? "HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。"
        : "HelioX 的实现经过修复轮次后改写了本来已经通过的机制句。";
      const numeric = generationAttempts === 1
        ? "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.50×。"
        : "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.33×。";
      const sentences = [mechanism, numeric];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "HelioX" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-numeric-repair",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "HelioX",
      source: { kind: "selected_text", excerpt: "HelioX 的执行机制与推理性能" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(1);
  expect(generationPrompts[1]).toContain("本轮属于数值命题门后的定向修复");
  expect(generationPrompts[1]).toContain("summarySentences 的这些索引及依赖它们的 claims：1");
  expect(generationPrompts[1]).toContain("其他 summarySentences 的 text、evidenceIds、externalKnowledge、status 必须逐字保持不变");
  expect(generationPrompts[1]).toContain("未直接支持的数值");
  expect(generationPrompts[1]).toContain("失败句绑定的最小来源");
  expect(generationPrompts[1]).toContain("inference speedup over JAXLEY is 4.33x");
  expect(result.thinReading?.rootSeed.summary).toContain("HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。");
  expect(result.thinReading?.rootSeed.summary).not.toContain("修复轮次后改写了本来已经通过的机制句");
  expect(result.thinReading?.rootSeed.summary).toContain("4.33×");
  expect(result.thinReading?.rootSeed.summary).not.toContain("4.50×");
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
});

test("isolates a nonessential numeric sentence after its bounded repair remains invalid", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "HelioX",
        snippet: "HelioX uses a GPU-native execution path. The measured inference speedup over JAXLEY is 4.33x.",
        summary: "HelioX 使用 GPU 原生执行路径，测得的相对 JAXLEY 推理加速比为 4.33 倍。",
        tags: ["HelioX", "GPU-native", "inference speedup"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "隔离后保留的机制句由绑定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const sentences = [
        "HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。",
        "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.50×。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "HelioX" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-numeric-isolation",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "HelioX",
      source: { kind: "selected_text", excerpt: "HelioX 的 GPU 原生执行机制" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(1);
  expect(result.thinReading?.rootSeed.summary).toBe("HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。");
  expect(result.thinReading?.rootSeed.evidence.summarySentences).toHaveLength(1);
  expect(result.thinReading?.rootSeed.evidence.claims).toHaveLength(1);
  expect(result.thinReading?.qualityGate.repairReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("已隔离数值命题门定向修复后仍未通过的正文句")
  ]));
});

test("freezes passed sentences before isolating a second failed numeric repair", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "HelioX",
        snippet: "HelioX uses a GPU-native execution path. The measured inference speedup over JAXLEY is 4.33x.",
        summary: "HelioX 使用 GPU 原生执行路径，测得的相对 JAXLEY 推理加速比为 4.33 倍。",
        tags: ["HelioX", "GPU-native", "inference speedup"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "隔离后保留的机制句由绑定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const mechanism = generationAttempts === 1
        ? "HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。"
        : "修复轮次错误地改写了已经通过的 GPU 机制句。";
      const numeric = generationAttempts === 1
        ? "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.50×。"
        : "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.60×。";
      const sentences = [mechanism, numeric];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "HelioX" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-numeric-second-failure",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "HelioX",
      source: { kind: "selected_text", excerpt: "HelioX 的 GPU 原生执行机制" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(1);
  expect(result.thinReading?.rootSeed.summary).toContain(
    "HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。"
  );
  expect(result.thinReading?.rootSeed.summary).not.toContain("修复轮次错误地改写了已经通过的 GPU 机制句");
  expect(result.thinReading?.rootSeed.summary).not.toContain("4.50×");
  expect(result.thinReading?.rootSeed.summary).not.toContain("4.60×");
});

test("does not isolate the only numeric answer for an explicit exact-value task", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "HelioX",
        snippet: "HelioX uses a GPU-native execution path. The measured inference speedup over JAXLEY is 4.33x.",
        summary: "HelioX 使用 GPU 原生执行路径，测得的相对 JAXLEY 推理加速比为 4.33 倍。",
        tags: ["HelioX", "GPU-native", "inference speedup"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        reviewAttempts += 1;
      }
      generationAttempts += 1;
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const sentences = [
        "HelioX 使用 GPU 原生执行路径来组织该基准中的模型计算。",
        "在同一实验设置下，HelioX 相对 JAXLEY 的推理加速比为 4.50×。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join(""),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "推理加速比具体是多少？",
    selectedPapers: [{ id: "demo-1", title: "HelioX" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-required-numeric-answer",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "HelioX",
      source: {
        kind: "selected_text",
        excerpt: "HelioX 相对 JAXLEY 的推理性能",
        prompt: "推理加速比具体是多少？"
      },
      targetLanguage: "zh-CN"
    }
  })).rejects.toThrow("未直接支持的数值“4.50”");

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(0);
});

test("quarantines paper sentences that remain partially supported after targeted repair", async () => {
  const store = createSettingsStore();
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: `CoreNEURON directly accesses models built by NEURON. Tests report four-fold lower memory use. Evidence passage ${index + 1}.`,
        summary: `CoreNEURON 接收 NEURON 模型，测试报告内存减少 4 倍；证据片段 ${index + 1}。`,
        tags: ["CoreNEURON", "memory"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      if (prompt.includes("证据规划 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["CoreNEURON 机制与结果"],
              selectedEvidenceIds: [evidenceId]
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "当前证据已覆盖机制与结果。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("你是 Liteasy 薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const unsupportedSentenceIds = [
          "这种优化提升性能",
          "重新组织内存布局和代码生成",
          "显著优于 NEURON"
        ].map((text) => (
          prompt.split("\n").find((line) => line.includes(text))
            ?.match(/id=(thin-reading-sentence-[^;\s]+)/)?.[1] ?? ""
        )).filter(Boolean);
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: unsupportedSentenceIds.length > 0
                ? "三处命题分别扩张了性能因果、实现细节和统计显著性；其余句子有直接支持。"
                : "隔离失败句后，剩余正文句均有直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: unsupportedSentenceIds.length > 0 ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      const sentences = [
        "CoreNEURON 通过直接内存访问接收 NEURON 构建的模型。",
        "这种优化提升性能。",
        "测试报告内存减少 4 倍。",
        "系统重新组织内存布局和代码生成。",
        "结果显著优于 NEURON。"
      ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            anchors: [{
              importance: 0.9,
              kind: "concept",
              searchQuery: "CoreNEURON",
              summarySentenceIndex: 0,
              text: "CoreNEURON"
            }, {
              importance: 0.7,
              kind: "result",
              searchQuery: "CoreNEURON performance",
              summarySentenceIndex: 1,
              text: "提升性能"
            }],
            claims: sentences.map((text) => ({ evidenceIds: [evidenceId], status: "grounded", text })),
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "systems",
            summary: sentences.join("").replace("这种优化提升性能。", "这种优化提升性能；"),
            summarySentences: sentences.map((text) => ({
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text
            })),
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "deepseek" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-partial-quarantine",
      depth: 1,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "selected_text", excerpt: "CoreNEURON 的机制与性能结果" },
      targetLanguage: "zh-CN"
    }
  });

  expect(generationAttempts).toBe(2);
  expect(reviewAttempts).toBe(2);
  expect(result.thinReading?.rootSeed.summary).not.toContain("提升性能");
  expect(result.thinReading?.rootSeed.summary).not.toContain("代码生成");
  expect(result.thinReading?.rootSeed.summary).not.toContain("显著优于");
  expect(result.thinReading?.rootSeed.evidence.summarySentences).toHaveLength(2);
  expect(result.thinReading?.rootSeed.evidence.claims).toHaveLength(2);
  expect(result.thinReading?.rootSeed.evidence.anchors).toEqual([
    expect.objectContaining({ text: "CoreNEURON" })
  ]);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
  expect(result.thinReading?.qualityGate.repairReasons).toEqual(expect.arrayContaining([
    expect.stringContaining("已隔离证据复核仍未通过的正文句")
  ]));
});

test("stops after one failed trace repair without creating a local fallback", async () => {
  const store = createSettingsStore();
  let modelCalls = 0;
  const phases: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      modelCalls += 1;
      const prompt = String(JSON.parse(request.body).prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "这份输出始终缺少显式句级映射，因此不应被保存为看似成功的薄读结果。",
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    onProgress: (progress) => phases.push(progress.phase),
    question: "生成薄读",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-repair-failure",
      depth: 0,
      paperIds: ["demo-1"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  })).rejects.toThrow("结构质量门连续失败");

  expect(modelCalls).toBe(2);
  expect(phases).toContain("repairing_structured_output");
});

test("restricts a direct thin-reading request to its primary paper", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({
        audit: {
          model: "gpt-5-mini-auditor",
          rationale: "薄读审计通过，但检索覆盖不足。",
          score: 0.82,
          verdict: "review"
        }
      }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [
        {
          page: 2,
          paperId: "demo-1",
          paperTitle: "ColBERT",
          snippet: "ColBERT uses contextualized token embeddings and MaxSim late interaction.",
          summary: "ColBERT 用 MaxSim 进行 late interaction。",
          tags: ["ColBERT", "MaxSim"]
        }
      ]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("证据复核 Agent")) {
        return {
          json: async () => ({ answer: JSON.stringify(passingEvidenceReview(prompt)), execution: { backend: "dev_cloud", mode: "live", provider: "openai" } }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify({
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "experimental",
            recommendations: [],
            summary: "ColBERT 的核心贡献是用 MaxSim late interaction 保留细粒度匹配信号。",
            summarySentences: [{
              evidenceIds: [evidenceId],
              externalKnowledge: [],
              status: "grounded",
              text: "ColBERT 的核心贡献是用 MaxSim late interaction 保留细粒度匹配信号。"
            }],
            withinPaperClosure: true
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [
      { id: "demo-1", title: "ColBERT" },
      { id: "demo-2", title: "Missing Paper" }
    ],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-gap",
      depth: 0,
      paperIds: ["demo-1", "demo-2"],
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.analysis?.run.coverage.selectedPaperIds).toEqual(["demo-1"]);
  expect(result.analysis?.run.coverage.missingPaperIds).toEqual([]);
  expect(result.thinReading?.context.paperIds).toEqual(["demo-1"]);
  expect(result.thinReading?.context.primaryPaperId).toBe("demo-1");
  expect(result.thinReading?.rootSeed?.withinPaperClosure).toBe(true);
});

test("uses traceable external sources when a deep branch explicitly asks for follow-up research", async () => {
  const store = createSettingsStore();
  const externalRequests: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const progressSummaries: string[] = [];
  let modelRequestBody = "";
  let modelPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    onProgress: (progress) => progressSummaries.push(progress.summary),
    modelTransport: async (request) => {
      modelRequestBody = request.body;
      modelPrompt = String(JSON.parse(request.body).prompt);
      if (modelPrompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(modelPrompt),
              propositionVerdicts: evidenceReviewPropositions(modelPrompt),
              reason: "外部句由绑定来源摘要直接支持。",
              rootOrientation: evidenceReviewRootOrientation(modelPrompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: ["openalex:W42"],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "后续研究把 late interaction 扩展到更高效的多向量检索。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: ["openalex:W42"],
              status: "weak",
              text: "后续研究把 late interaction 扩展到更高效的多向量检索。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "比较论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-external",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      prompt: "比较论文外的后续研究",
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "MaxSim late interaction 的 token-level matching 细节" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async (request) => {
      externalRequests.push({ body: request.body, headers: request.headers, url: request.url });
      return {
        json: async () => ({
          provider: "openalex",
          query: "ColBERT 后续研究",
          retrieval: {
            attempts: 2,
            id: "artifact-thin-external:cached-query",
            reused: true,
            status: "completed"
          },
          sources: [{
            abstract: "An efficient multi-vector retrieval method.",
            authors: ["A. Author"],
            doi: "https://doi.org/10.1000/follow-up",
            id: "openalex:W42",
            provider: "openalex",
            relation: "topic_search",
            relevance: 0.86,
            retrievalQuery: "ColBERT 后续研究",
            sourceRecordUrl: "https://openalex.org/W42",
            sourceId: "W42",
            title: "Efficient Multi-vector Retrieval",
            url: "https://openalex.org/W42",
            year: 2025
          }],
          status: "available"
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toHaveLength(3);
  expect(progressSummaries).toContain("正在复用已验证的外部文献来源");
  const externalBodies = externalRequests.map((request) => JSON.parse(request.body));
  expect(externalBodies[0]).toMatchObject({
    limit: 32,
    targetPaperIdentity: {
      kind: "local_paper_id",
      value: "demo-1"
    }
  });
  expect(externalBodies.slice(1).map((body) => body.limit)).toEqual([12, 12]);
  expect(externalBodies.map((body) => body.includeArxiv)).toEqual([true, false, false]);
  expect(externalBodies.map((body) => body.query)).toEqual(expect.arrayContaining([
    expect.stringContaining("conflicting results"),
    expect.stringContaining("follow-up research")
  ]));
  expect(externalRequests.every((request) => request.url.includes("/v1/research/external-knowledge"))).toBe(true);
  expect(externalRequests.every((request) => request.headers["Content-Type"] === "application/json")).toBe(true);
  expect(externalRequests.every((request) => !request.body.includes("api_key"))).toBe(true);
  expect(modelRequestBody).not.toContain("api_key");
  expect(modelPrompt).toContain("openalex:W42");
  expect(modelPrompt).toContain("Efficient Multi-vector Retrieval");
  expect(result.thinReading?.rootSeed.evidence.externalSources?.[0]).toMatchObject({
    evidenceBasis: "abstract",
    id: "openalex:W42",
    retrievalIntents: ["support", "challenge", "context"],
    url: "https://openalex.org/W42"
  });
  expect(result.thinReading?.rootSeed.supportMode).toBe("external_only");
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
});

test("drops an unsupported external-only sentence when external expansion was explicitly requested", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "CoreNEURON",
        snippet: "CoreNEURON accelerates the Cortex model by two to four times.",
        summary: "CoreNEURON 将 Cortex 模型加速 2-4 倍。",
        tags: ["CoreNEURON", "Cortex"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const externalSentenceLine = prompt.split("\n").find((line) => line.includes("external=openalex:W42"));
        const unsupportedSentenceId = externalSentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewAttempts === 1
              ? {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt, [unsupportedSentenceId]),
                  reason: "外部来源摘要没有提及可塑性，不能支持该句。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [unsupportedSentenceId],
                  verdict: "fail"
                }
              : {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "删除无支持的外部句后，其余句均由论文证据直接支持。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
      const paperSentence = "论文证据显示，CoreNEURON 将 Cortex 模型加速 2-4 倍。";
      const externalSentence = "主题检索提示可塑性与学习理论相关，但本文不深入探讨。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [evidenceId], status: "grounded", text: paperSentence }],
            externalKnowledge: ["openalex:W42"],
            omittedSections: [],
            paperEvidence: [evidenceId],
            paperType: "benchmark",
            recommendations: [],
            summary: `${paperSentence}${externalSentence}`,
            summarySentences: [
              { evidenceIds: [evidenceId], externalKnowledge: [], status: "grounded", text: paperSentence },
              { evidenceIds: [], externalKnowledge: ["openalex:W42"], status: "weak", text: externalSentence }
            ],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "补充论文外相关理论",
    selectedPapers: [{ id: "demo-1", title: "CoreNEURON" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-fallback",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      prompt: "补充论文外相关理论",
      primaryPaperId: "demo-1",
      primaryPaperTitle: "CoreNEURON",
      source: { kind: "selected_text", excerpt: "Cortex 模型性能" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({
        provider: "openalex",
        query: "CoreNEURON Cortex 模型性能",
        sources: [{
          abstract: "A general theory of efficient learning systems.",
          authors: ["A. Author"],
          id: "openalex:W42",
          provider: "openalex",
          relation: "topic_search",
          relevance: 0.61,
          retrievalQuery: "CoreNEURON Cortex 模型性能",
          sourceRecordUrl: "https://openalex.org/W42",
          sourceId: "W42",
          title: "Efficient Learning Systems",
          url: "https://openalex.org/W42",
          year: 2024
        }],
        status: "available"
      }),
      ok: true,
      status: 200
    })
  });

  expect(generationPrompts).toHaveLength(1);
  expect(reviewAttempts).toBe(2);
  expect(result.thinReading?.rootSeed.summary).not.toContain("可塑性");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([]);
  expect(result.thinReading?.rootSeed.supportMode).toBe("paper");
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(true);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 1, repaired: true });
});

test("replaces one unsupported required external source with a focused retrieval", async () => {
  const store = createSettingsStore();
  const externalQueries: string[] = [];
  const generationPrompts: string[] = [];
  let generationAttempts = 0;
  let reviewAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const externalSource = (id: string, title: string, abstract: string) => ({
    abstract,
    authors: ["A. Author"],
    id: `openalex:${id}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: `https://openalex.org/${id}`,
    sourceId: id,
    title,
    url: `https://openalex.org/${id}`,
    year: 2025
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      if (prompt.includes("薄读的证据复核 Agent")) {
        reviewAttempts += 1;
        const sourceId = reviewAttempts === 1 ? "openalex:W1" : "openalex:W2";
        const sentenceLine = prompt.split("\n").find((line) => line.includes(`external=${sourceId}`));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewAttempts === 1
              ? {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
                  reason: "初始外部来源只涉及相邻主题，不能支持后续研究的具体命题。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : {
                  paperAnswerability: paperAnswerabilityForPrompt(prompt),
                  propositionVerdicts: evidenceReviewPropositions(prompt),
                  reason: "替代来源摘要直接支持该外部句。",
                  rootOrientation: evidenceReviewRootOrientation(prompt),
                  unsupportedSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      generationPrompts.push(prompt);
      const sourceId = generationAttempts === 1 ? "openalex:W1" : "openalex:W2";
      const text = generationAttempts === 1
        ? "初始线索讨论相邻主题，但不能据此断言后续研究的具体改进。"
        : "后续研究将 late interaction 扩展为更高效的多向量检索。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [sourceId],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: text,
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [sourceId],
              status: "weak",
              text
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-recovery",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async (request) => {
      externalQueries.push(JSON.parse(request.body).query);
      const source = externalQueries.length <= 3
        ? externalSource("W1", "Adjacent Retrieval Topic", "A study about a neighboring retrieval topic.")
        : externalSource("W2", "Efficient Multi-vector Retrieval", "This follow-up study extends late interaction with a more efficient multi-vector retrieval method.");
      return {
        json: async () => ({ provider: "openalex", query: "external", sources: [source], status: "available" }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalQueries).toHaveLength(4);
  expect(externalQueries[3]).toContain("direct evidence for the requested claim");
  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("openalex:W2");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual(["openalex:W2"]);
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
});

test("regenerates unsupported required external claims as disclosed AI interpretation after recovery is exhausted", async () => {
  const store = createSettingsStore();
  let aiInterpretationPrompt = "";
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const unsupportedSource = {
    abstract: "A study about a neighboring retrieval topic.",
    authors: ["A. Author"],
    id: "openalex:W1",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: "https://openalex.org/W1",
    sourceId: "W1",
    title: "Adjacent Retrieval Topic",
    url: "https://openalex.org/W1",
    year: 2025
  };

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        const sentenceLine = prompt.split("\n").find((line) => line.includes("external=openalex:W1"));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
              reason: "该来源只涉及相邻主题，不能直接支持所问外部命题。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [sentenceId],
              verdict: "fail"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句明确标记为一种可能的概念解释，未声称来自文献或研究。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiInterpretationPrompt = prompt;
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer(
              "一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。"
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: ["openalex:W1"],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: ["openalex:W1"],
              status: "weak",
              text: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-boundary",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      return {
        json: async () => externalRequests === 4
          ? ({ provider: "openalex", query: "external", sources: [], status: "empty" })
          : ({ provider: "openalex", query: "external", sources: [unsupportedSource], status: "available" }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(4);
  expect(aiInterpretationPrompt).toContain("AI 独立理解");
  expect(aiInterpretationPrompt).not.toContain("初始外部线索");
  expect(aiInterpretationPrompt).not.toContain("该来源只涉及相邻主题");
  expect(aiInterpretationPrompt).not.toContain("openalex:W1");
  expect(aiInterpretationPrompt).not.toContain("Adjacent Retrieval Topic");
  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
  expect(result.thinReading?.rootSeed.closureState).toBe("outside_paper");
  expect(result.thinReading?.rootSeed.summary).not.toContain("初始外部线索");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalFallback).toEqual({
    attemptedRoutes: ["support"],
    carriedSourceCount: 1,
    completedRoutes: ["support"],
    reason: "verification_exhausted",
    trustedSourceCount: 0
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.aiInterpretationReview).toEqual({
    reason: "该句明确标记为一种可能的概念解释，未声称来自文献或研究。",
    unsafeSentenceIds: [],
    verdict: "pass"
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceLoop");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidencePlan");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceReview");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceToolCalls");
});

test("limits AI interpretation repair to two body attempts after later verification exhaustion", async () => {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  let normalBodyCalls = 0;
  let aiReviewCalls = 0;
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const unsupportedSource = {
    abstract: "A study about a neighboring retrieval topic.",
    authors: ["A. Author"],
    id: "openalex:W1",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: "https://openalex.org/W1",
    sourceId: "W1",
    title: "Adjacent Retrieval Topic",
    url: "https://openalex.org/W1",
    year: 2025
  };

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        const sentenceLine = prompt.split("\n").find((line) => line.includes(`external=${unsupportedSource.id}`));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
              reason: "该来源只涉及相邻主题，不能直接支持所问外部命题。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [sentenceId],
              verdict: "fail"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        aiReviewCalls += 1;
        const sentenceId = prompt.match(/<sentence id="([^"]+)">/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(aiReviewCalls === 1
              ? {
                  reason: "该句需要更明确地标记为概念假设。",
                  unsafeSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : {
                  reason: "修复后只保留明确标记的可能性推理。",
                  unsafeSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer(
              aiBodyPrompts.length === 1
                ? "可以设想，另一种交互机制可能会改变检索效率与表达能力之间的权衡。"
                : "一种可能的理解是，另一种交互机制或许会改变检索效率与表达能力的权衡。"
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      normalBodyCalls += 1;
      if (normalBodyCalls === 1) {
        return {
          json: async () => ({
            answer: "not-json",
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [unsupportedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [unsupportedSource.id],
              status: "weak",
              text: "初始外部线索只涉及相邻主题，不足以直接支持这个论文外命题。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-ai-later-verification-exhaustion",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      return {
        json: async () => externalRequests === 4
          ? ({ provider: "openalex", query: "external", sources: [], status: "empty" })
          : ({ provider: "openalex", query: "external", sources: [unsupportedSource], status: "available" }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(4);
  expect(normalBodyCalls).toBe(2);
  expect(aiReviewCalls).toBe(2);
  expect(aiBodyPrompts).toHaveLength(2);
  expect(aiBodyPrompts.join("\n")).not.toContain("初始外部线索");
  expect(aiBodyPrompts.join("\n")).not.toContain("openalex:W1");
  expect(aiBodyPrompts.join("\n")).not.toContain("Adjacent Retrieval Topic");
  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(result.thinReading?.rootSeed.summary).not.toContain("初始外部线索");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalFallback).toMatchObject({
    attemptedRoutes: ["support"],
    reason: "verification_exhausted",
    trustedSourceCount: 0
  });
});

test.each(["malformed", "transport_unavailable", "http_unavailable", "unknown"] as const)(
  "authorizes verification exhaustion for focused recovery %s without retaining error text",
  async (focusedResult) => {
    const run = generateFocusedRecoveryBoundaryForTest(focusedResult);
    const result = await run.result;
    const fallbackAudit = result.thinReading?.rootSeed.evidence.generationAudit?.externalFallback;

    expect(run.externalRequestCount()).toBe(4);
    expect(run.aiBodyPrompts).toHaveLength(1);
    expect(fallbackAudit).toEqual({
      attemptedRoutes: ["support"],
      carriedSourceCount: 1,
      completedRoutes: [],
      reason: "verification_exhausted",
      trustedSourceCount: 0
    });
    expect(JSON.stringify(fallbackAudit)).not.toContain("focused recovery transport outage");
    expect(JSON.stringify(fallbackAudit)).not.toContain("focused recovery response reader failed");
    expect(JSON.stringify(fallbackAudit)).not.toContain("外部文献检索返回格式无效");
  }
);

test("propagates focused recovery cancellation by identity without authorizing AI interpretation", async () => {
  const run = generateFocusedRecoveryBoundaryForTest("abort");

  await expect(run.result).rejects.toBe(run.abortError);
  expect(run.externalRequestCount()).toBe(4);
  expect(run.aiBodyPrompts).toEqual([]);
});

test("regenerates as AI interpretation when focused recovery candidates are all untrusted", async () => {
  const run = generateFocusedRecoveryBoundaryForTest("untrusted");
  const result = await run.result;

  expect(run.externalRequestCount()).toBe(4);
  expect(run.aiBodyPrompts).toHaveLength(1);
  expect(result.thinReading?.rootSeed).toMatchObject({
    closureState: "outside_paper",
    supportMode: "ai_interpretation",
    evidence: {
      externalKnowledge: [],
      externalSources: [],
      generationAudit: {
        externalFallback: {
          attemptedRoutes: ["support"],
          completedRoutes: ["support"],
          reason: "verification_exhausted",
          trustedSourceCount: 0
        }
      }
    }
  });
});

test("keeps a surviving trustworthy external source without an unnecessary recovery request", async () => {
  const store = createSettingsStore();
  let externalRequests = 0;
  let generationAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const externalSource = (id: string, title: string, abstract: string) => ({
    abstract,
    authors: ["A. Author"],
    id: `openalex:${id}`,
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.8,
    retrievalQuery: "follow-up retrieval",
    sourceRecordUrl: `https://openalex.org/${id}`,
    sourceId: id,
    title,
    url: `https://openalex.org/${id}`,
    year: 2025
  });
  const rejectedSource = externalSource(
    "W1",
    "Adjacent Retrieval Topic",
    "A study about a neighboring retrieval topic."
  );
  const survivingSource = externalSource(
    "W2",
    "Efficient Multi-vector Retrieval",
    "This follow-up study directly supports a more efficient multi-vector retrieval method."
  );

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        const rejectedLine = prompt.split("\n").find((line) => line.includes("external=openalex:W1"));
        const rejectedSentenceId = rejectedLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        const unsupportedSentenceIds = rejectedSentenceId ? [rejectedSentenceId] : [];
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, unsupportedSentenceIds),
              reason: rejectedSentenceId
                ? "W1 只涉及相邻主题；W2 的摘要直接支持其绑定句。"
                : "移除 W1 句后，W2 的摘要直接支持剩余正文。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds,
              verdict: rejectedSentenceId ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [rejectedSource.id, survivingSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "相邻主题线索不足以支持具体改进。后续研究直接支持更高效的多向量检索。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [rejectedSource.id],
              status: "weak",
              text: "相邻主题线索不足以支持具体改进。"
            }, {
              evidenceIds: [],
              externalKnowledge: [survivingSource.id],
              status: "weak",
              text: "后续研究直接支持更高效的多向量检索。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-external-surviving-source",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "selected_text", excerpt: "论文外的后续研究" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      return {
        json: async () => externalRequests === 4
          ? ({ provider: "openalex", query: "external", sources: [], status: "empty" })
          : ({
              provider: "openalex",
              query: "external",
              sources: [rejectedSource, survivingSource],
              status: "available"
            }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(3);
  expect(generationAttempts).toBe(1);
  expect(result.thinReading?.rootSeed.supportMode).toBe("external_only");
  expect(result.thinReading?.rootSeed.summary).toBe("后续研究直接支持更高效的多向量检索。");
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([survivingSource.id]);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([
    expect.objectContaining({ id: survivingSource.id })
  ]);
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("externalFallback");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("aiInterpretationReview");
});

test("keeps a selected canonical external source available when a follow-up lookup is empty", async () => {
  const store = createSettingsStore();
  let modelPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const selectedSource = {
    abstract: "An already verified follow-up study.",
    authors: ["A. Author"],
    id: "openalex:W42",
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.86,
    retrievalQuery: "ColBERT follow-up",
    sourceRecordUrl: "https://openalex.org/W42",
    sourceId: "W42",
    title: "Efficient Multi-vector Retrieval",
    url: "https://openalex.org/W42",
    year: 2025
  };

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT uses MaxSim.",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      modelPrompt = String(JSON.parse(request.body).prompt);
      if (modelPrompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(modelPrompt),
              propositionVerdicts: evidenceReviewPropositions(modelPrompt),
              reason: "外部句由绑定来源摘要直接支持。",
              rootOrientation: evidenceReviewRootOrientation(modelPrompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [selectedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "这条已验证的后续研究线索聚焦更高效的多向量检索，并延续了当前阅读路径。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [selectedSource.id],
              status: "weak",
              text: "这条已验证的后续研究线索聚焦更高效的多向量检索，并延续了当前阅读路径。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-selected-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      selectedExternalSources: [selectedSource],
      source: {
        externalSourceIds: [selectedSource.id],
        excerpt: selectedSource.title,
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "ColBERT follow-up", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  expect(modelPrompt).toContain(selectedSource.id);
  expect(modelPrompt).toContain(selectedSource.title);
  expect(result.thinReading?.rootSeed.evidence.externalSources).toEqual([selectedSource]);
  expect(result.thinReading?.rootSeed.supportMode).toBe("external_only");
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
});

test("does not authorize verification exhaustion when an explicitly selected external source fails review", async () => {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  let externalRequests = 0;
  let generationAttempts = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const selectedSource = {
    abstract: "An already verified follow-up study.",
    authors: ["A. Author"],
    id: "openalex:W42",
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.86,
    retrievalQuery: "ColBERT follow-up",
    sourceRecordUrl: "https://openalex.org/W42",
    sourceId: "W42",
    title: "Efficient Multi-vector Retrieval",
    url: "https://openalex.org/W42",
    year: 2025
  };

  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    auditTransport: async () => ({
      json: async () => ({ audit: { model: "auditor", rationale: "pass", score: 0.9, verdict: "pass" } }),
      ok: true,
      status: 200
    }),
    importedChunksByPaperId: {
      "demo-1": [{
        page: 2,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT uses MaxSim.",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        const sentenceLine = prompt.split("\n").find((line) => line.includes(`external=${selectedSource.id}`));
        const sentenceId = sentenceLine?.match(/id=(thin-reading-sentence-[^;]+)/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt, [sentenceId]),
              reason: "显式选择来源的摘要不能直接支持该句。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [sentenceId],
              verdict: "fail"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句保持明确披露的概念推理边界。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer(
              "一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。"
            )),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationAttempts += 1;
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [selectedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary: "这条显式选择的后续研究线索不能直接支持当前具体命题。",
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [selectedSource.id],
              status: "weak",
              text: "这条显式选择的后续研究线索不能直接支持当前具体命题。"
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-selected-external-review-fail",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      selectedExternalSources: [selectedSource],
      source: {
        externalSourceIds: [selectedSource.id],
        excerpt: selectedSource.title,
        kind: "selected_text"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      return {
        json: async () => ({ provider: "openalex", query: "ColBERT follow-up", sources: [], status: "empty" }),
        ok: true,
        status: 200
      };
    }
  });

  await expect(result).rejects.toThrow("薄读 Agent 结构质量门连续失败");
  expect(externalRequests).toBe(3);
  expect(generationAttempts).toBe(2);
  expect(aiBodyPrompts).toEqual([]);
});

test("does not enter AI interpretation when a traceable-only external request exhausts retrieval", async () => {
  const store = createSettingsStore();
  let modelCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async () => {
      modelCalls += 1;
      throw new Error("traceable-only request must not generate an AI interpretation body");
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-traceable-only-empty-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: {
        excerpt: "论文外的后续研究",
        kind: "selected_text",
        prompt: "只使用可追溯文献，不要 AI 独立理解。"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  await expect(result).rejects.toThrow("当前任务禁止 AI 独立理解");
  expect(modelCalls).toBe(0);
});

test("generates AI interpretation when external retrieval returns no sources", async () => {
  const store = createSettingsStore();
  let generationPrompt = "";
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句保持为明确的可能性推理，没有伪造来源或精确经验数据。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompt = prompt;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，后续研究可以检验更细粒度的交互机制。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-empty-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  expect(result.thinReading?.rootSeed).toMatchObject({
    supportMode: "ai_interpretation",
    withinPaperClosure: false,
    evidence: {
      claims: [],
      externalKnowledge: [],
      externalSources: [],
      generationAudit: {
        aiInterpretationReview: {
          reason: "该句保持为明确的可能性推理，没有伪造来源或精确经验数据。",
          unsafeSentenceIds: [],
          verdict: "pass"
        },
        externalFallback: {
          reason: "no_trusted_sources",
          trustedSourceCount: 0
        }
      },
      paperEvidence: [],
      summarySentences: [expect.objectContaining({
        evidenceIds: [],
        externalKnowledge: [],
        status: "unsupported",
        supportMode: "ai_interpretation"
      })]
    }
  });
  expect(generationPrompt).toContain("AI 独立理解");
  expect(generationPrompt).not.toContain("ColBERT uses MaxSim.");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceLoop");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidencePlan");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceReview");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("evidenceToolCalls");
});

test("keeps the selected focus as task scope after external exhaustion enters AI interpretation", async () => {
  let generationPrompt = "";
  const selectedFocus = "论文外的替代交互机制为什么可能改变信息保留方式";

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "正文只围绕选区进行概念推理，没有把选区伪装成来源。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompt = body.prompt;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer(
            "一种可能的理解是，替代交互机制会先改变信息保留路径，因此可能影响后续结果。"
          )),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    thinReadingContext: {
      artifactId: "artifact-thin-ai-selected-focus",
      depth: 2,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { excerpt: selectedFocus, kind: "selected_text" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(generationPrompt).toContain(selectedFocus);
  expect(generationPrompt).toContain("只用于限定本轮问题范围");
  expect(generationPrompt).not.toContain("ColBERT uses MaxSim.");
});

test("generates AI interpretation when all three external routes fail", async () => {
  const store = createSettingsStore();
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      return {
        json: async () => ({
          answer: JSON.stringify(prompt.includes("AI 独立理解质量审阅 Agent")
            ? {
                reason: "该句是明确标记的概念推理。",
                unsafeSentenceIds: [],
                verdict: "pass"
              }
            : aiInterpretationAnswer("一种可能性是，替代交互形式会改变检索效率与表达能力的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-failed-external",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      throw new TypeError("Failed to fetch");
    }
  });

  expect(externalRequests).toBe(3);
  const fallbackAudit = result.thinReading?.rootSeed.evidence.generationAudit?.externalFallback;
  expect(fallbackAudit).toEqual({
    attemptedRoutes: ["support", "challenge", "context"],
    carriedSourceCount: 0,
    completedRoutes: [],
    reason: "all_routes_failed",
    trustedSourceCount: 0
  });
  expect(JSON.stringify(fallbackAudit)).not.toContain("temporary external outage");
  expect(result.thinReading?.rootSeed).toMatchObject({
    supportMode: "ai_interpretation",
    evidence: {
      generationAudit: {
        externalFallback: {
          attemptedRoutes: expect.arrayContaining(["support", "challenge", "context"]),
          reason: "all_routes_failed",
          trustedSourceCount: 0
        }
      }
    }
  });
});

test("keeps paper-internal gaps off the AI interpretation path when external retrieval is unavailable", async () => {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句保持为明确的可能性推理，没有伪造来源或精确经验数据。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，细粒度交互机制决定了检索权衡。")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/可用 evidence ID：([^\n]+)/)?.[1]?.split(",")[0]?.trim() ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer("ColBERT 使用 MaxSim 来保留细粒度匹配信号。", evidenceId)),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么需要这样做？",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-internal-gap",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      prompt: "为什么需要这样做？",
      source: { kind: "omitted_section", label: "动机", sectionKey: "motivation" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      throw new TypeError("Failed to fetch");
    }
  });

  expect(aiBodyPrompts).toEqual([]);
  expect(externalRequests).toBe(0);
  expect(result.thinReading?.rootSeed.supportMode).toBe("paper");
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("externalFallback");
});

test("does not cross the semantic paper boundary when the user requires paper-only evidence", async () => {
  const store = createSettingsStore();
  let externalRequests = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(semanticAnswerabilityReview(prompt, "partial")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/可用 evidence ID：([^\n]+)/)?.[1]?.split(",")[0]?.trim() ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer(
            "论文证据说明 MaxSim 保留了细粒度匹配信号。",
            evidenceId
          )),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "只依据目标论文解释这一机制，不要使用论文外材料。",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-paper-only-boundary",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: true,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: {
        excerpt: "MaxSim 的适用边界",
        kind: "selected_text",
        prompt: "只依据目标论文解释这一机制，不要使用论文外材料。"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      externalRequests += 1;
      throw new Error("paper-only requests must not retrieve external sources");
    }
  });

  await expect(result).rejects.toThrow("用户要求只依据目标论文");
  expect(externalRequests).toBe(0);
});

test("falls back to AI interpretation after non-cancellation external transport failures", async () => {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  const transportError = new Error("programming bug in external transport");
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句明确标记为一种概念可能性，没有来源归因。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const evidenceId = prompt.match(/可用 evidence ID：([^\n]+)/)?.[1]?.split(",")[0]?.trim() ?? "evidence-1";
      return {
        json: async () => ({
          answer: JSON.stringify(paperInterpretationAnswer("ColBERT 使用 MaxSim 来保留细粒度匹配信号。", evidenceId)),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-external-transport-bug",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      throw transportError;
    }
  });

  expect(aiBodyPrompts).toHaveLength(1);
  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalRetrieval?.routeOutcomes)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ failureKind: "unexpected", status: "failed" })
    ]));
  expect(JSON.stringify(result.thinReading?.rootSeed.evidence.generationAudit))
    .not.toContain(transportError.message);
});

test("falls back to AI interpretation after external knowledge client construction failures", async () => {
  const store = createSettingsStore();
  const aiBodyPrompts: string[] = [];
  const constructionError = new Error("external knowledge client construction bug");
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  thinReadingExternalKnowledgeClientConstructionError = constructionError;

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim late interaction.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句保持为明确的概念可能性，没有伪造来源或精确经验数据。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("AI 独立理解")) {
        aiBodyPrompts.push(prompt);
        return {
          json: async () => ({
            answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。")),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，后续工作可以探索更高效的细粒度交互机制。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续了解论文外的后续研究",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-external-construction-bug",
      depth: 3,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      primaryPaperTitle: "ColBERT",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    }
  });

  expect(aiBodyPrompts).toHaveLength(1);
  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalRetrieval?.routeOutcomes)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ failureKind: "unexpected", status: "failed" })
    ]));
  expect(JSON.stringify(result.thinReading?.rootSeed.evidence.generationAudit))
    .not.toContain(constructionError.message);
});

test("keeps a trusted fulfilled source when another external route returns malformed schema", async () => {
  const trustedSource = {
    abstract: "A traceable study of efficient multi-vector retrieval with reviewable details.",
    authors: ["A. Author"],
    id: "openalex:W71",
    provider: "openalex" as const,
    relation: "topic_search" as const,
    relevance: 0.88,
    retrievalQuery: "multi-vector retrieval",
    sourceId: "W71",
    sourceRecordUrl: "https://openalex.org/W71",
    title: "Efficient Multi-vector Retrieval Study",
    url: "https://openalex.org/W71",
    year: 2025
  };
  let externalRequests = 0;
  let generationPrompt = "";

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(body.prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompt = body.prompt;
      const summary = "这项可信研究探讨更高效的多向量检索，并为继续分析交互机制提供可追溯线索。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [trustedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [trustedSource.id],
              status: "weak",
              text: summary
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    thinReadingExternalKnowledgeTransport: async () => {
      const requestNumber = ++externalRequests;
      if (requestNumber === 1) {
        return {
          json: async () => ({ provider: "openalex", sources: "malformed", status: "available" }),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({
          provider: "openalex",
          query: "multi-vector retrieval",
          sources: requestNumber === 2 ? [trustedSource] : [],
          status: requestNumber === 2 ? "available" : "empty"
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(3);
  expect(generationPrompt).not.toContain("本轮已由编排器授权为 AI 独立理解");
  expect(result.thinReading?.rootSeed).toMatchObject({
    supportMode: "external_only",
    evidence: {
      externalSources: [expect.objectContaining({ id: trustedSource.id })]
    }
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("externalFallback");
});

test("keeps a trusted carried source when another external route returns malformed schema", async () => {
  const carriedSource = {
    abstract: "An already verified follow-up study with reviewable multi-vector retrieval details.",
    authors: ["B. Author"],
    id: "openalex:W72",
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.9,
    retrievalQuery: "ColBERT follow-up",
    sourceId: "W72",
    sourceRecordUrl: "https://openalex.org/W72",
    title: "Verified Multi-vector Retrieval Follow-up",
    url: "https://openalex.org/W72",
    year: 2025
  };
  let externalRequests = 0;

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_evidence_review") {
        return {
          json: async () => ({
            answer: JSON.stringify(passingEvidenceReview(body.prompt)),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "这条已验证的后续研究线索聚焦多向量检索，并为继续分析交互机制提供可追溯依据。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [],
            externalKnowledge: [carriedSource.id],
            omittedSections: [],
            paperEvidence: [],
            paperType: "experimental",
            recommendations: [],
            summary,
            summarySentences: [{
              evidenceIds: [],
              externalKnowledge: [carriedSource.id],
              status: "weak",
              text: summary
            }],
            withinPaperClosure: false
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    thinReadingContext: {
      artifactId: "artifact-thin-carried-malformed-route",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      selectedExternalSources: [carriedSource],
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      const requestNumber = ++externalRequests;
      return {
        json: async () => requestNumber === 1
          ? { provider: "openalex", sources: "malformed", status: "available" }
          : { provider: "openalex", query: "follow-up", sources: [], status: "empty" },
        ok: true,
        status: 200
      };
    }
  });

  expect(externalRequests).toBe(3);
  expect(result.thinReading?.rootSeed).toMatchObject({
    supportMode: "external_only",
    evidence: {
      externalSources: [expect.objectContaining({ id: carriedSource.id })]
    }
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit).not.toHaveProperty("externalFallback");
});

test("falls back to AI interpretation after every external route returns malformed data", async () => {
  const modelTransport = vi.fn(async (request: ModelTransportRequest) => {
    const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
    const isReview = body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review";
    return {
      json: async () => ({
        answer: JSON.stringify(isReview
          ? {
              reason: "该句只表达明确标记的概念可能性。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }
          : aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索权衡。")),
        execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
      }),
      ok: true,
      status: 200
    };
  });

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport,
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: "malformed", status: "available" }),
      ok: true,
      status: 200
    })
  });

  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalRetrieval?.routeOutcomes)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ failureKind: "invalid_response", status: "failed" })
    ]));
  expect(JSON.stringify(result.thinReading?.rootSeed.evidence.generationAudit))
    .not.toContain("外部文献检索返回格式无效");
});

test("allows AI interpretation when an untrusted carried source is filtered out", async () => {
  const retractedSource = {
    abstract: "A retracted source that must never be treated as trusted evidence.",
    authors: ["A. Author"],
    id: "openalex:W99",
    isRetracted: true,
    provider: "openalex" as const,
    relation: "related" as const,
    relevance: 0.91,
    retrievalQuery: "ColBERT follow-up",
    sourceId: "W99",
    sourceRecordUrl: "https://openalex.org/W99",
    title: "Retracted Multi-vector Retrieval Study",
    url: "https://openalex.org/W99",
    year: 2024
  };
  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      return {
        json: async () => ({
          answer: JSON.stringify(body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review"
            ? {
                reason: "该句只表达明确标记的概念可能性。",
                unsafeSentenceIds: [],
                verdict: "pass"
              }
            : aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    thinReadingContext: {
      artifactId: "artifact-thin-retracted-carried",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      selectedExternalSources: [retractedSource],
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.thinReading?.rootSeed).toMatchObject({
    supportMode: "ai_interpretation",
    evidence: {
      externalSources: [],
      generationAudit: {
        externalFallback: {
          carriedSourceCount: 1,
          reason: "no_trusted_sources",
          trustedSourceCount: 0
        }
      }
    }
  });
});

test("recovers AI interpretation review transport failures without regenerating the body", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;
  const reviewError = new Error("AI interpretation review transport failed");

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        if (reviewCalls <= 2) throw reviewError;
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: "该句只表达明确标记的概念可能性。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationCalls += 1;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
  expect(generationCalls).toBe(1);
  expect(reviewCalls).toBe(3);
});

test("fails after three AI interpretation review transport attempts without regenerating the body", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;
  const reviewError = new Error("AI interpretation review transport remains unavailable");

  const result = generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        throw reviewError;
      }
      generationCalls += 1;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力之间的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  await expect(result).rejects.toBe(reviewError);
  expect(generationCalls).toBe(1);
  expect(reviewCalls).toBe(3);
});

test("does not retry an AI interpretation review authentication failure", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;

  const result = generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        return {
          json: async () => ({ error: "authentication failed" }),
          ok: false,
          status: 401
        };
      }
      generationCalls += 1;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力之间的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  await expect(result).rejects.toThrow("cloud_proxy 401");
  expect(generationCalls).toBe(1);
  expect(reviewCalls).toBe(1);
});

test("propagates AI interpretation review AbortError without regenerating the body", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;
  const abortError = new DOMException("review cancelled", "AbortError");

  const result = generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        throw abortError;
      }
      generationCalls += 1;
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  await expect(result).rejects.toBe(abortError);
  expect(generationCalls).toBe(1);
  expect(reviewCalls).toBe(1);
});

test("uses reviewer-only retries when AI interpretation review formatting remains invalid", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;

  const result = generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string } };
      const isReview = body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review";
      if (isReview) reviewCalls += 1;
      else generationCalls += 1;
      return {
        json: async () => ({
          answer: isReview
            ? "not-json"
            : JSON.stringify(aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  await expect(result).rejects.toThrow("AI 独立理解质量审阅返回格式无效");
  await expect(result).rejects.not.toThrow("薄读 Agent 结构质量门连续失败");
  expect(generationCalls).toBe(1);
  expect(reviewCalls).toBe(3);
});

test("repairs a failed AI interpretation review and reviews the repaired output again", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  let reviewCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        const sentenceId = prompt.match(/<sentence id="([^"]+)">/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify(reviewCalls === 1
              ? {
                  reason: "该句需要更明确地标记为概念假设。",
                  unsafeSentenceIds: [sentenceId],
                  verdict: "fail"
                }
              : {
                  reason: "修复后只保留明确标记的可能性推理。",
                  unsafeSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer(
            generationPrompts.length === 1
              ? "可以设想，另一种交互机制可能会改变检索效率与表达能力之间的权衡。"
              : "一种可能的理解是，另一种交互机制或许会改变检索权衡。"
          )),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-ai-review-repair",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  expect(reviewCalls).toBe(2);
  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("该输出处于无文献依据的 AI 独立理解档");
  expect(generationPrompts[1]).toContain("所有证据与来源字段必须保持为空");
  expect(result.thinReading?.qualityGate).toMatchObject({ attempts: 2, repaired: true });
});

test("rewrites AI interpretation once when its intent is right but its logic chain is shallow", async () => {
  const store = createSettingsStore();
  const generationPrompts: string[] = [];
  let reviewCalls = 0;
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        const sentenceId = prompt.match(/<sentence id="([^"]+)">/)?.[1] ?? "";
        return {
          json: async () => ({
            answer: JSON.stringify({
              contentQuality: reviewCalls === 1
                ? {
                    depthFit: "shallow",
                    focus: "focused",
                    intentAlignment: "aligned",
                    logicChain: "partial",
                    reason: "已经回答为什么，但缺少机制变化到结果变化之间的连接。",
                    revisionSentenceIds: [sentenceId],
                    severity: "advisory",
                    verdict: "revise"
                  }
                : {
                    depthFit: "appropriate",
                    focus: "focused",
                    intentAlignment: "aligned",
                    logicChain: "complete",
                    reason: "修复后形成了适合当前层级的完整概念因果链。",
                    revisionSentenceIds: [],
                    severity: "none",
                    verdict: "pass"
                  },
              reason: "正文保持为明确的概念推理，没有伪造来源或经验数据。",
              unsafeSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationPrompts.push(prompt);
      return {
        json: async () => ({
          answer: JSON.stringify(aiInterpretationAnswer(
            generationPrompts.length === 1
              ? "一种可能的理解是，改变交互机制可能影响最终结果。"
              : "一种可能的理解是，交互机制先改变信息保留方式，因此可能进一步影响最终结果。"
          )),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "为什么替代交互机制可能改变最终结果？",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-ai-composition-repair",
      depth: 2,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: {
        kind: "selected_text",
        excerpt: "论文外假设中的替代交互机制",
        prompt: "为什么替代交互机制可能改变最终结果？"
      },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  });

  expect(reviewCalls).toBe(2);
  expect(generationPrompts).toHaveLength(2);
  expect(generationPrompts[1]).toContain("成文质量诊断");
  expect(generationPrompts[1]).toContain("所有证据与来源字段必须保持为空");
  expect(result.thinReading?.rootSeed.evidence).toMatchObject({
    externalKnowledge: [],
    externalSources: [],
    generationAudit: {
      aiInterpretationReview: {
        contentQuality: {
          logicChain: "complete",
          verdict: "pass"
        },
        verdict: "pass"
      }
    },
    paperEvidence: []
  });
});

test("freezes AI interpretation sentences outside the content-quality repair scope", async () => {
  let generationCalls = 0;
  let reviewCalls = 0;
  const originalSentence = "一种可能的理解是，信息保留方式的变化会先改变中间表示。";
  const revisedSentence = "因此，后续处理可能在不同输入下呈现不同的结果权衡。";
  const rewrittenFrozenSentence = "修复轮次错误地把已经清楚的中间表示改成了另一种机制。";
  const unrequestedSentence = "修复轮次还凭空增加了一个没有被要求的旁支解释。";

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        const sentenceIds = [...body.prompt.matchAll(/<sentence id="([^"]+)">/g)]
          .map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify(reviewCalls === 1
              ? {
                  contentQuality: {
                    depthFit: "appropriate",
                    focus: "focused",
                    intentAlignment: "aligned",
                    logicChain: "partial",
                    reason: "第二句需要补足从机制变化到结果权衡的连接。",
                    revisionSentenceIds: [sentenceIds[1]],
                    severity: "advisory",
                    verdict: "revise"
                  },
                  reason: "正文没有来源归因，但需要补足概念链。",
                  unsafeSentenceIds: [],
                  verdict: "pass"
                }
              : {
                  contentQuality: {
                    depthFit: "appropriate",
                    focus: "focused",
                    intentAlignment: "aligned",
                    logicChain: "complete",
                    reason: "修复后概念链完整。",
                    revisionSentenceIds: [],
                    severity: "none",
                    verdict: "pass"
                  },
                  reason: "剩余句均为明确标记的概念推理。",
                  unsafeSentenceIds: [],
                  verdict: "pass"
                }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      generationCalls += 1;
      const summarySentences = generationCalls === 1
        ? [originalSentence, revisedSentence]
        : [
            rewrittenFrozenSentence,
            "一种可能的理解是，信息保留方式先改变中间表示，因此可能影响结果权衡。",
            unrequestedSentence
          ];
      return {
        json: async () => ({
          answer: JSON.stringify({
            ...aiInterpretationAnswer(summarySentences.join("")),
            summarySentences: summarySentences.map((text) => ({
              evidenceIds: [],
              externalKnowledge: [],
              status: "unsupported",
              text
            }))
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(generationCalls).toBe(2);
  expect(reviewCalls).toBe(2);
  expect(result.thinReading?.rootSeed.summary).toContain(originalSentence);
  expect(result.thinReading?.rootSeed.summary).not.toContain(rewrittenFrozenSentence);
  expect(result.thinReading?.rootSeed.summary).not.toContain(unrequestedSentence);
});

test("isolates one unsafe AI interpretation sentence and re-reviews the remaining answer", async () => {
  let bodyCalls = 0;
  let reviewCalls = 0;
  const safeSentence = "一种可能的理解是，改变交互机制会先改变信息保留方式，因此可能影响最终结果。";
  const unsafeSentence = "这种机制必然在所有任务上得到最佳结果。";

  const result = await generateAiInterpretationFallbackForTest({
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      if (body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review") {
        reviewCalls += 1;
        const sentenceIds = [...body.prompt.matchAll(/<sentence id="([^"]+)">/g)]
          .map((match) => match[1]);
        const unsafeSentenceIds = sentenceIds.length > 1 ? [sentenceIds.at(-1)!] : [];
        return {
          json: async () => ({
            answer: JSON.stringify({
              reason: unsafeSentenceIds.length > 0
                ? "末句把概念可能性写成了无条件经验结论。"
                : "剩余句明确保持为有逻辑过程的可能性解释。",
              unsafeSentenceIds,
              verdict: unsafeSentenceIds.length > 0 ? "fail" : "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      bodyCalls += 1;
      return {
        json: async () => ({
          answer: JSON.stringify({
            ...aiInterpretationAnswer(`${safeSentence}${unsafeSentence}`),
            summarySentences: [safeSentence, unsafeSentence].map((text) => ({
              evidenceIds: [],
              externalKnowledge: [],
              status: "unsupported",
              text
            }))
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    }
  });

  expect(bodyCalls).toBe(2);
  expect(reviewCalls).toBe(3);
  expect(result.thinReading?.rootSeed.summary).toBe(safeSentence);
  expect(result.thinReading?.rootSeed.evidence.summarySentences).toHaveLength(1);
  expect(result.thinReading?.rootSeed.evidence.claims).toEqual([]);
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.aiInterpretationReview)
    .toMatchObject({ unsafeSentenceIds: [], verdict: "pass" });
  expect(result.thinReading?.qualityGate.repairReasons.join(" "))
    .toMatch(/已隔离 AI 独立理解中修复后仍不安全的句子：thin-reading-sentence-/);
});

test("rejects an AI interpretation that fails review after the repair budget", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport: async (request) => {
      const body = JSON.parse(request.body) as { outputFormat?: { name?: string }; prompt: string };
      const prompt = String(body.prompt);
      const sentenceId = prompt.match(/<sentence id="([^"]+)">/)?.[1] ?? "";
      return {
        json: async () => ({
          answer: JSON.stringify(body.outputFormat?.name === "liteasy_thin_reading_ai_interpretation_review"
            ? {
                reason: "仍包含未标记的经验事实。",
                unsafeSentenceIds: [sentenceId],
                verdict: "fail"
              }
            : aiInterpretationAnswer("一种可能的理解是，替代交互机制或许会改变检索效率与表达能力之间的权衡。")),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-ai-review-fail",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  })).rejects.toThrow("薄读 Agent 结构质量门连续失败：AI 独立理解质量审阅未通过");
});

test("propagates external retrieval cancellation without calling AI generation", async () => {
  const store = createSettingsStore();
  const controller = new AbortController();
  const modelTransport = vi.fn();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const generation = generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport,
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    signal: controller.signal,
    thinReadingContext: {
      artifactId: "artifact-thin-ai-abort",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    }
  });

  await expect(generation).rejects.toMatchObject({ name: "AbortError" });
  expect(modelTransport).not.toHaveBeenCalled();
});

test("propagates model transport failure after AI interpretation authorization", async () => {
  const store = createSettingsStore();
  const modelTransport = vi.fn(async () => {
    throw new Error("model transport failed after fallback authorization");
  });
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  await expect(generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "demo-1": [{
        page: 1,
        paperId: "demo-1",
        paperTitle: "ColBERT",
        snippet: "ColBERT uses MaxSim.",
        summary: "ColBERT 使用 MaxSim。",
        tags: ["MaxSim"]
      }]
    },
    mode: "qa",
    modelTransport,
    question: "继续深入",
    selectedPapers: [{ id: "demo-1", title: "ColBERT" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-thin-ai-model-failure",
      depth: 1,
      paperIds: ["demo-1"],
      parentWithinPaperClosure: false,
      primaryPaperId: "demo-1",
      source: { kind: "omitted_section", label: "后续研究", sectionKey: "follow_up" },
      targetLanguage: "zh-CN"
    },
    thinReadingExternalKnowledgeTransport: async () => ({
      json: async () => ({ provider: "openalex", query: "query", sources: [], status: "empty" }),
      ok: true,
      status: 200
    })
  })).rejects.toThrow("model transport failed after fallback authorization");
  expect(modelTransport).toHaveBeenCalledTimes(1);
});

test("runs at most two responsibility Subagents for a genuinely large thin-reading load", async () => {
  const store = createSettingsStore();
  const prompts: string[] = [];
  let selectedEvidenceIds: string[] = [];
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      "paper-large": Array.from({ length: 20 }, (_, index) => ({
        page: index + 1,
        paperId: "paper-large",
        paperTitle: "Large Architecture Paper",
        snippet: `Component ${index + 1} sends state to the next processing stage under a bounded condition. `.repeat(140),
        summary: `Component ${index + 1} participates in the architecture pipeline.`,
        tags: ["architecture", "pipeline"]
      }))
    },
    mode: "qa",
    modelTransport: async (request) => {
      const prompt = String(JSON.parse(request.body).prompt);
      prompts.push(prompt);
      if (prompt.includes("证据规划 Agent")) {
        selectedEvidenceIds = [...prompt.matchAll(/\[(evidence-[^\]]+)\]/g)]
          .slice(0, 3)
          .map((match) => match[1]);
        return {
          json: async () => ({
            answer: JSON.stringify({
              focus: ["核心组件关系"],
              pageRequests: [],
              searchQueries: [],
              selectedEvidenceIds
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("证据观察 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              decision: "stop",
              focus: [],
              pageRequests: [],
              reason: "首轮已经覆盖核心组件、处理顺序和边界。",
              searchQueries: [],
              selectedEvidenceIds: []
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("关系梳理 Subagent")) {
        return {
          json: async () => ({
            answer: `组件按处理顺序连接〔${selectedEvidenceIds[0]}〕。`,
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      if (prompt.includes("视觉编辑 Subagent")) {
        throw new Error("visual provider internal failure text");
      }
      if (prompt.includes("薄读的证据复核 Agent")) {
        return {
          json: async () => ({
            answer: JSON.stringify({
              paperAnswerability: paperAnswerabilityForPrompt(prompt),
              propositionVerdicts: evidenceReviewPropositions(prompt),
              reason: "每个句子都由绑定证据直接支持。",
              rootOrientation: evidenceReviewRootOrientation(prompt),
              unsupportedSentenceIds: [],
              verdict: "pass"
            }),
            execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
          }),
          ok: true,
          status: 200
        };
      }
      const summary = "系统把多个组件按依赖顺序连接起来，让状态沿处理流水线逐步传递，并保留证据给出的条件边界。";
      return {
        json: async () => ({
          answer: JSON.stringify({
            claims: [{ evidenceIds: [selectedEvidenceIds[0]], status: "grounded", text: "组件按依赖顺序连接。" }],
            externalKnowledge: [],
            omittedSections: [],
            paperEvidence: [selectedEvidenceIds[0]],
            paperType: "systems",
            recommendedFigures: [],
            summary,
            summarySentences: [{ evidenceIds: [selectedEvidenceIds[0]], externalKnowledge: [], status: "grounded", text: summary }],
            visualizationIntent: {
              candidateModalities: ["semantic_graph"],
              evidenceIds: [selectedEvidenceIds[0]],
              expectedLearningGain: "high",
              purpose: "show_process",
              requestedBy: "automatic"
            },
            withinPaperClosure: true
          }),
          execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
        }),
        ok: true,
        status: 200
      };
    },
    question: "生成薄读",
    selectedPapers: [{ id: "paper-large", title: "Large Architecture Paper" }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "artifact-large-workload",
      depth: 0,
      paperIds: ["paper-large"],
      primaryPaperId: "paper-large",
      primaryPaperTitle: "Large Architecture Paper",
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(prompts.filter((prompt) => prompt.includes("关系梳理 Subagent"))).toHaveLength(1);
  expect(prompts.filter((prompt) => prompt.includes("视觉编辑 Subagent"))).toHaveLength(1);
  const finalPrompt = prompts.find((prompt) => prompt.includes("你是 Liteasy 薄读 Agent"));
  expect(finalPrompt).toContain("Subagent 私有工作记录");
  expect(finalPrompt).toContain("组件按处理顺序连接");
  expect(finalPrompt).not.toContain("visual provider internal failure text");
  expect(finalPrompt).not.toContain("视觉方案未完成");
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.workload).toMatchObject({
    maxConcurrency: 2,
    strategy: "parallel"
  });
  expect(result.thinReading?.rootSeed.evidence.generationAudit?.responsibilitySubagents).toEqual([
    expect.objectContaining({
      id: "relationship_mapper",
      includedInFinalPrompt: true,
      status: "completed"
    }),
    expect.objectContaining({
      failureKind: "unexpected",
      id: "visual_editor",
      includedInFinalPrompt: false,
      status: "failed"
    })
  ]);
});

// Controlled model responses for browser lifecycle tests only.
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

export function passingEvidenceReview(prompt: string) {
  return {
    paperAnswerability: paperAnswerabilityForPrompt(prompt),
    propositionVerdicts: evidenceReviewPropositions(prompt),
    reason: "每个正文句均由其绑定证据直接支持。",
    rootOrientation: evidenceReviewRootOrientation(prompt),
    unsupportedSentenceIds: [],
    verdict: "pass" as const
  };
}

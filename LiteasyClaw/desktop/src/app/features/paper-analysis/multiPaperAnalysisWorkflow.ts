import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type {
  AnalysisClaim,
  AnalysisEvidence,
  CompletedMultiPaperAnalysis,
  MultiPaperAnalysisInput,
  PreparedMultiPaperAnalysis
} from "./analysis.types";

const minimumAdaptiveEvidencePerPaper = 12;
const preferredAdaptiveEvidencePerPaper = 28;
const absoluteMaxEvidencePerPaper = 48;
const absoluteMaxTotalEvidence = 144;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(maximum, Math.floor(value!)));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Multi-paper analysis was cancelled");
  }
}

function tokenize(value: string) {
  const normalized = value.toLowerCase();
  const latinTokens = normalized.match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const chineseTokens = chineseRuns.flatMap((run) => {
    if (run.length < 2) {
      return [run];
    }
    return Array.from({ length: run.length - 1 }, (_, index) =>
      run.slice(index, index + 2)
    );
  });
  return [...new Set([...latinTokens, ...chineseTokens])];
}

function scoreChunk(queryTokens: string[], chunk: RetrievalChunk) {
  const snippet = chunk.snippet.toLowerCase();
  const summary = chunk.summary.toLowerCase();
  const title = chunk.paperTitle.toLowerCase();
  const tags = chunk.tags.map((tag) => tag.toLowerCase());
  return queryTokens.reduce((score, token) => {
    const tagScore = tags.some((tag) => tag.includes(token) || token.includes(tag)) ? 4 : 0;
    return (
      score +
      tagScore +
      (snippet.includes(token) ? 2 : 0) +
      (summary.includes(token) ? 1 : 0) +
      (title.includes(token) ? 1 : 0)
    );
  }, 0);
}

function defaultIdFactory() {
  let sequence = 0;
  return (kind: "analysis" | "claim" | "evidence") => {
    sequence += 1;
    const randomPart = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${kind}-${sequence}-${randomPart}`;
  };
}

function chunkId(chunk: RetrievalChunk, index: number) {
  return `${chunk.paperId}:p${chunk.page}:chunk-${index + 1}`;
}

type RankedChunk = {
  chunk: RetrievalChunk;
  chunkId: string;
  score: number;
};

function getAdaptiveEvidenceLimit(chunkCount: number) {
  if (chunkCount <= minimumAdaptiveEvidencePerPaper) {
    return Math.max(1, chunkCount);
  }
  return Math.min(
    absoluteMaxEvidencePerPaper,
    Math.max(
      minimumAdaptiveEvidencePerPaper,
      Math.min(preferredAdaptiveEvidencePerPaper, Math.ceil(chunkCount * 0.7))
    )
  );
}

function selectStratifiedEvidence(ranked: RankedChunk[], limit: number) {
  if (ranked.length <= limit) {
    return ranked;
  }

  const byDocumentOrder = [...ranked].sort(
    (left, right) => left.chunk.page - right.chunk.page || left.chunkId.localeCompare(right.chunkId)
  );
  const selected = new Map<string, RankedChunk>();
  const coverageSlots = Math.min(limit, Math.max(6, Math.ceil(limit * 0.6)));

  for (let slot = 0; slot < coverageSlots; slot += 1) {
    const start = Math.floor((slot * byDocumentOrder.length) / coverageSlots);
    const end = Math.max(
      start + 1,
      Math.floor(((slot + 1) * byDocumentOrder.length) / coverageSlots)
    );
    const bestInRange = byDocumentOrder
      .slice(start, end)
      .sort((left, right) => right.score - left.score)[0];
    if (bestInRange) {
      selected.set(bestInRange.chunkId, bestInRange);
    }
  }

  for (const candidate of ranked) {
    if (selected.size >= limit) {
      break;
    }
    selected.set(candidate.chunkId, candidate);
  }

  return [...selected.values()].sort(
    (left, right) => left.chunk.page - right.chunk.page || left.chunkId.localeCompare(right.chunkId)
  );
}

export function prepareMultiPaperAnalysis(
  input: MultiPaperAnalysisInput
): PreparedMultiPaperAnalysis {
  throwIfAborted(input.signal);
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultIdFactory();
  const analysisRunId = createId("analysis");
  const queryTokens = tokenize(input.query);
  const evidence: AnalysisEvidence[] = [];
  const rankedByPaper = input.selectedPapers.map((paper) => {
    throwIfAborted(input.signal);
    const chunks = input.importedChunksByPaperId[paper.id] ?? [];
    const paperLimit = input.limits?.maxEvidencePerPaper === undefined
      ? getAdaptiveEvidenceLimit(chunks.length)
      : boundedInteger(
          input.limits.maxEvidencePerPaper,
          minimumAdaptiveEvidencePerPaper,
          absoluteMaxEvidencePerPaper
        );
    const ranked = chunks
      .map((chunk, index) => ({
        chunk,
        chunkId: chunkId(chunk, index),
        score: scoreChunk(queryTokens, chunk)
      }))
      .sort((left, right) => right.score - left.score);
    return { paper, paperLimit, ranked: selectStratifiedEvidence(ranked, paperLimit) };
  });
  const maxEvidencePerPaper = Math.max(
    1,
    ...rankedByPaper.map((entry) => entry.paperLimit)
  );
  const adaptiveTotalEvidence = rankedByPaper.reduce(
    (total, entry) => total + entry.paperLimit,
    0
  );
  const maxTotalEvidence = input.limits?.maxTotalEvidence === undefined
    ? Math.min(absoluteMaxTotalEvidence, Math.max(maxEvidencePerPaper, adaptiveTotalEvidence))
    : Math.max(
        maxEvidencePerPaper,
        boundedInteger(
          input.limits.maxTotalEvidence,
          adaptiveTotalEvidence,
          absoluteMaxTotalEvidence
        )
      );

  for (let rank = 0; rank < maxEvidencePerPaper; rank += 1) {
    for (const { paper, ranked } of rankedByPaper) {
      throwIfAborted(input.signal);
      const candidate = ranked[rank];
      if (!candidate || evidence.length >= maxTotalEvidence) {
        continue;
      }
      const relevance = clamp(
        candidate.score === 0 ? 0.2 : 0.45 + candidate.score / (candidate.score + 12)
      );
      evidence.push({
        analysisRunId,
        chunkId: candidate.chunkId,
        id: createId("evidence"),
        page: candidate.chunk.page,
        paperId: paper.id,
        paperTitle: paper.title,
        quote: candidate.chunk.snippet,
        relevance: Number(relevance.toFixed(2)),
        retrievalReason:
          candidate.score > 0
            ? "query_overlap_within_selected_paper"
            : "per_paper_coverage_fallback",
        summary: candidate.chunk.summary,
        terms: candidate.chunk.tags
      });
    }
    if (evidence.length >= maxTotalEvidence) {
      break;
    }
  }

  const selectedPaperIds = input.selectedPapers.map((paper) => paper.id);
  const coveredPaperIds = selectedPaperIds.filter((paperId) =>
    evidence.some((item) => item.paperId === paperId)
  );
  const missingPaperIds = selectedPaperIds.filter(
    (paperId) => !coveredPaperIds.includes(paperId)
  );
  const coverageRatio = selectedPaperIds.length === 0
    ? 0
    : coveredPaperIds.length / selectedPaperIds.length;
  const averageRelevance = evidence.length === 0
    ? 0
    : evidence.reduce((total, item) => total + item.relevance, 0) / evidence.length;
  const retrievalConfidence = clamp(0.15 + coverageRatio * 0.65 + averageRelevance * 0.2);
  const createdAt = now().toISOString();
  const paperClaims: AnalysisClaim[] = evidence.map((item) => ({
    analysisRunId,
    confidence: item.relevance,
    evidenceIds: [item.id],
    id: createId("claim"),
    stance: "supported",
    text: item.summary
  }));
  const evidencePrompt = evidence.length > 0
    ? evidence
        .map(
          (item) =>
            `[${item.id}] ${item.paperTitle} p.${item.page}\n` +
            `摘要：${item.summary}\n原文：${item.quote}`
        )
        .join("\n\n")
    : "没有从所选论文中取得可引用证据；必须回答证据不足。";

  return {
    citations: evidence.map((item) => ({
      page: item.page,
      paperId: item.paperId,
      snippet: item.quote
    })),
    evidence,
    evidencePrompt,
    paperClaims,
    retrievalConfidence: Number(retrievalConfidence.toFixed(2)),
    run: {
      coverage: {
        coveredPaperIds,
        missingPaperIds,
        ratio: Number(coverageRatio.toFixed(2)),
        selectedPaperIds
      },
      createdAt,
      id: analysisRunId,
      plan: {
        dimensions: ["研究问题", "方法", "实验与结果", "局限与分歧"],
        maxEvidencePerPaper,
        maxTotalEvidence,
        paperIds: selectedPaperIds,
        query: input.query
      },
      query: input.query,
      selectionSnapshotId: input.selectionSnapshotId,
      status: "running",
      workspaceRevision: input.workspaceRevision
    }
  };
}

export function completeMultiPaperAnalysis(input: {
  answer: string;
  auditScore: number;
  auditVerdict: "fail" | "pass" | "review";
  createId?: (kind: "analysis" | "claim" | "evidence") => string;
  now?: () => Date;
  prepared: PreparedMultiPaperAnalysis;
  signal?: AbortSignal;
}): CompletedMultiPaperAnalysis {
  throwIfAborted(input.signal);
  const createId = input.createId ?? defaultIdFactory();
  const completedAt = (input.now ?? (() => new Date()))().toISOString();
  const hasCoverageGap = input.prepared.run.coverage.missingPaperIds.length > 0;
  const stance: AnalysisClaim["stance"] = input.prepared.evidence.length === 0
    ? "insufficient"
    : input.auditVerdict === "pass" && !hasCoverageGap
      ? "supported"
      : input.auditVerdict === "fail"
        ? "insufficient"
        : "mixed";
  const synthesisClaim: AnalysisClaim = {
    analysisRunId: input.prepared.run.id,
    confidence: Number(clamp(input.auditScore).toFixed(2)),
    evidenceIds: input.prepared.evidence.map((item) => item.id),
    id: createId("claim"),
    stance,
    text: input.answer
  };

  return {
    ...input.prepared,
    claims: [...input.prepared.paperClaims, synthesisClaim],
    run: {
      ...input.prepared.run,
      completedAt,
      status: stance === "supported" ? "completed" : "needs_review"
    }
  };
}

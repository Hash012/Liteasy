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

const rhetoricalEvidenceSignals: ReadonlyArray<{ pattern: RegExp; weight: number }> = [
  { pattern: /\babstract\b|\b摘要\b/i, weight: 3 },
  { pattern: /\bwe (?:propose|introduce|present|show|demonstrate)\b|\bcontribution(?:s)?\b|\b贡献\b|\b本文(?:提出|发现|证明)/i, weight: 4 },
  { pattern: /\bconclusion(?:s)?\b|\bconclude\b|\b讨论与结论\b|\b结论\b/i, weight: 4 },
  { pattern: /\bresults?\b|\bfindings?\b|\bexperiment(?:s|al)?\b|\b实验结果?\b|\b主要发现\b/i, weight: 3 },
  { pattern: /\blimitation(?:s)?\b|\bfailure cases?\b|\bthreats? to validity\b|\b局限(?:性)?\b|\b失效(?:条件|情形)?\b/i, weight: 3 },
  { pattern: /\btheorem\b|\bproof\b|\bproposition\b|\b定理\b|\b证明\b/i, weight: 3 }
];

function rhetoricalEvidenceScore(chunk: RetrievalChunk) {
  const text = `${chunk.summary}\n${chunk.snippet}`;
  return rhetoricalEvidenceSignals.reduce(
    (score, signal) => score + (signal.pattern.test(text) ? signal.weight : 0),
    0
  );
}

type LexicalCorpus = {
  averageDocumentLength: number;
  documentFrequency: ReadonlyMap<string, number>;
  documentCount: number;
};

function textTokens(value: string) {
  return tokenize(value);
}

function chunkText(chunk: RetrievalChunk) {
  return [chunk.paperTitle, ...chunk.tags, chunk.summary, chunk.snippet].join("\n");
}

function buildLexicalCorpus(chunks: readonly RetrievalChunk[]): LexicalCorpus {
  const documentFrequency = new Map<string, number>();
  const totalLength = chunks.reduce((total, chunk) => {
    const uniqueTerms = new Set(textTokens(chunkText(chunk)));
    uniqueTerms.forEach((term) => documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1));
    return total + Math.max(1, textTokens(chunkText(chunk)).length);
  }, 0);
  return {
    averageDocumentLength: Math.max(1, totalLength / Math.max(1, chunks.length)),
    documentCount: Math.max(1, chunks.length),
    documentFrequency
  };
}

function lexicalEvidenceScore(queryTokens: string[], chunk: RetrievalChunk, corpus: LexicalCorpus) {
  const terms = textTokens(chunkText(chunk));
  const termFrequency = new Map<string, number>();
  terms.forEach((term) => termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1));
  const documentLength = Math.max(1, terms.length);
  const k1 = 1.2;
  const b = 0.75;
  const bm25 = queryTokens.reduce((score, token) => {
    const frequency = termFrequency.get(token) ?? 0;
    if (frequency === 0) {
      return score;
    }
    const documentFrequency = corpus.documentFrequency.get(token) ?? 0;
    const idf = Math.log(1 + (corpus.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const normalizedFrequency = (frequency * (k1 + 1)) /
      (frequency + k1 * (1 - b + b * (documentLength / corpus.averageDocumentLength)));
    return score + idf * normalizedFrequency;
  }, 0);
  // Tags and title are curator-provided document metadata. Keep their explicit boost while the
  // body itself is ranked by BM25, so a repeated boilerplate term cannot dominate a rare query term.
  const metadataBoost = queryTokens.reduce((score, token) => (
    score +
    (chunk.tags.some((tag) => tag.toLowerCase().includes(token) || token.includes(tag.toLowerCase())) ? 1.25 : 0) +
    (chunk.paperTitle.toLowerCase().includes(token) ? 0.35 : 0)
  ), 0);
  // BM25 values are naturally small on short imported PDFs. Scale the lexical signal so an
  // explicit user term still outranks a generic rhetorical marker such as "result".
  return bm25 * 3 + metadataBoost;
}

function scoreChunk(queryTokens: string[], chunk: RetrievalChunk, corpus: LexicalCorpus) {
  // Thin reading needs decisive claims and limits even when the launch query is generic.
  return lexicalEvidenceScore(queryTokens, chunk, corpus) + rhetoricalEvidenceScore(chunk);
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
  lexicalScore: number;
  rhetoricalScore: number;
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
  // When the evidence budget is small, preserve claims/results/limits before spending slots on
  // uniform page coverage. Otherwise a title page can crowd out a paper's actual contribution.
  for (const candidate of ranked.filter((entry) => entry.rhetoricalScore > 0)) {
    if (selected.size >= limit) {
      break;
    }
    selected.set(candidate.chunkId, candidate);
  }
  const remainingSlots = limit - selected.size;
  const coverageSlots = Math.min(remainingSlots, Math.max(0, Math.ceil(limit * 0.6)));

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
  const lexicalCorpus = buildLexicalCorpus(
    input.selectedPapers.flatMap((paper) => input.importedChunksByPaperId[paper.id] ?? [])
  );
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
        lexicalScore: lexicalEvidenceScore(queryTokens, chunk, lexicalCorpus),
        rhetoricalScore: rhetoricalEvidenceScore(chunk),
        score: scoreChunk(queryTokens, chunk, lexicalCorpus)
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
        pageTextEnd: candidate.chunk.pageTextEnd,
        pageTextStart: candidate.chunk.pageTextStart,
        textExtraction: candidate.chunk.textExtraction,
        paperId: paper.id,
        paperTitle: paper.title,
        quote: candidate.chunk.snippet,
        relevance: Number(relevance.toFixed(2)),
        retrievalReason:
          candidate.lexicalScore > 0
            ? candidate.rhetoricalScore > 0
              ? "query_overlap_and_rhetorical_core_evidence"
              : "query_overlap_within_selected_paper"
            : candidate.rhetoricalScore > 0
              ? "rhetorical_core_evidence"
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

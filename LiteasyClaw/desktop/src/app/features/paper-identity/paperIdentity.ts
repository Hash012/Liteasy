import type { Paper } from "../workspace/workspace.types";

export type PaperIdentityKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "title_authors_year_hash"
  | "local_paper_id";

export type PaperIdentitySource = "inferred" | "local" | "metadata";

export type PaperIdentityCandidate = {
  id: string;
  kind: PaperIdentityKind;
  source: PaperIdentitySource;
  value: string;
};

export type PaperIdentity = {
  candidates: readonly PaperIdentityCandidate[];
  paperId: string;
  primary: PaperIdentityCandidate;
  sourcePath?: string;
  title: string;
};

type PaperIdentityMetadata = {
  arxivId?: unknown;
  authors?: unknown;
  doi?: unknown;
  semanticScholarId?: unknown;
  year?: unknown;
};

export type PaperIdentityInput = Paper & {
  arxivId?: string;
  authors?: readonly string[] | string;
  doi?: string;
  metadata?: PaperIdentityMetadata;
  semanticScholarId?: string;
  year?: number | string;
};

const identityPriority: readonly PaperIdentityKind[] = Object.freeze([
  "doi",
  "arxiv_id",
  "semantic_scholar_id",
  "title_authors_year_hash",
  "local_paper_id"
]);

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compact(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeDoi(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const match = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return (match?.[0] ?? "")
    .replace(/[.,;:\]\s]+$/g, "")
    .toLowerCase();
}

function normalizeArxivId(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const match = text.match(
    /(?:arxiv[:/\s]+|abs\/|pdf\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i
  );
  return (match?.[1] ?? "")
    .replace(/\.pdf$/i, "")
    .toLowerCase();
}

function normalizeSemanticScholarId(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const corpusId = text.match(/(?:CorpusID|corpus id)[:\s]+(\d+)/i)?.[1];
  if (corpusId) {
    return `corpus:${corpusId}`;
  }
  const paperId = text.match(/(?:semanticscholar\.org\/paper\/[^/\s]+\/|paper\/)([a-f0-9]{40})/i)?.[1] ??
    text.match(/^[a-f0-9]{40}$/i)?.[0];
  return paperId ? paperId.toLowerCase() : "";
}

function normalizeTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(compact).filter(Boolean);
  }
  const text = compact(value);
  return text
    ? text.split(/\s*(?:;|,|\band\b|和|、)\s*/i).map(compact).filter(Boolean)
    : [];
}

function normalizeYear(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1800 && value <= 2200) {
    return String(value);
  }
  const match = compact(value).match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2}|2200)\b/);
  return match?.[1] ?? "";
}

function createCandidate(
  kind: PaperIdentityKind,
  value: string,
  source: PaperIdentitySource
): PaperIdentityCandidate {
  return {
    id: `${kind}:${value}`,
    kind,
    source,
    value
  };
}

function addCandidate(
  candidates: PaperIdentityCandidate[],
  kind: PaperIdentityKind,
  value: string,
  source: PaperIdentitySource
) {
  if (!value) {
    return;
  }
  const candidate = createCandidate(kind, value, source);
  if (!candidates.some((item) => item.kind === candidate.kind && item.value === candidate.value)) {
    candidates.push(candidate);
  }
}

function firstByKind(
  candidates: readonly PaperIdentityCandidate[],
  kind: PaperIdentityKind
) {
  return candidates.find((candidate) => candidate.kind === kind);
}

function titleAuthorsYearHash(input: PaperIdentityInput) {
  const authors = normalizeAuthors(input.authors ?? input.metadata?.authors);
  const year = normalizeYear(input.year ?? input.metadata?.year);
  const title = normalizeTitle(input.title);
  if (!title || authors.length === 0 || !year) {
    return "";
  }
  const authorKey = authors
    .map((author) => normalizeTitle(author))
    .filter(Boolean)
    .join("|");
  return authorKey ? stableHash(`${title}\u0000${authorKey}\u0000${year}`) : "";
}

export function resolvePaperIdentity(input: PaperIdentityInput): PaperIdentity {
  const candidates: PaperIdentityCandidate[] = [];
  const sourceText = [input.title, input.sourcePath].filter(Boolean).join(" ");

  addCandidate(
    candidates,
    "doi",
    normalizeDoi(input.doi ?? input.metadata?.doi) || normalizeDoi(sourceText),
    input.doi || input.metadata?.doi ? "metadata" : "inferred"
  );
  addCandidate(
    candidates,
    "arxiv_id",
    normalizeArxivId(input.arxivId ?? input.metadata?.arxivId) || normalizeArxivId(sourceText),
    input.arxivId || input.metadata?.arxivId ? "metadata" : "inferred"
  );
  addCandidate(
    candidates,
    "semantic_scholar_id",
    normalizeSemanticScholarId(input.semanticScholarId ?? input.metadata?.semanticScholarId) ||
      normalizeSemanticScholarId(sourceText),
    input.semanticScholarId || input.metadata?.semanticScholarId ? "metadata" : "inferred"
  );
  addCandidate(
    candidates,
    "title_authors_year_hash",
    titleAuthorsYearHash(input),
    "metadata"
  );
  addCandidate(candidates, "local_paper_id", input.id, "local");

  const primary = identityPriority
    .map((kind) => firstByKind(candidates, kind))
    .find((candidate): candidate is PaperIdentityCandidate => Boolean(candidate)) ??
    createCandidate("local_paper_id", input.id, "local");

  return Object.freeze({
    candidates: Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate }))),
    paperId: input.id,
    primary: Object.freeze({ ...primary }),
    sourcePath: input.sourcePath,
    title: input.title
  });
}

export function resolvePaperIdentityMap(
  papers: readonly PaperIdentityInput[]
): Readonly<Record<string, PaperIdentity>> {
  return Object.freeze(
    Object.fromEntries(papers.map((paper) => [paper.id, resolvePaperIdentity(paper)]))
  );
}

export function freezePaperIdentity(identity: PaperIdentity): PaperIdentity {
  return Object.freeze({
    ...identity,
    candidates: Object.freeze(identity.candidates.map((candidate) => Object.freeze({ ...candidate }))),
    primary: Object.freeze({ ...identity.primary })
  });
}

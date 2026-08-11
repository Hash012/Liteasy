import type { Paper } from "../workspace/workspace.types";
import type { LiteratureRecord } from "./literature.types";

export type PaperIdentityKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "openreview_id"
  | "dblp_key"
  | "pmlr_id"
  | "title_authors_year_hash"
  | "local_paper_id";

export type PaperIdentitySource =
  | "inferred"
  | "local"
  | "manual"
  | "metadata"
  | "public_registry";

export type PaperIdentityCandidateRole =
  | "candidate_alias"
  | "confirmable_hint"
  | "confirmed_identifier"
  | "local_compatibility";

export type PaperIdentityCandidate = {
  id: string;
  kind: PaperIdentityKind;
  role: PaperIdentityCandidateRole;
  source: PaperIdentitySource;
  value: string;
};

export type PaperIdentity = {
  authority:
    | { kind: "candidate_hints" }
    | { kind: "confirmed_literature"; literatureId: string; revision: number };
  candidates: readonly PaperIdentityCandidate[];
  paperId: string;
  primary: PaperIdentityCandidate;
  sourcePath?: string;
  title: string;
};

export function paperIdentityFromLiterature(
  paper: Pick<Paper, "id" | "sourcePath" | "title">,
  literature: LiteratureRecord
): PaperIdentity {
  const priority: readonly PaperIdentityCandidate["kind"][] = [
    "doi",
    "arxiv_id",
    "openreview_id",
    "dblp_key",
    "pmlr_id",
    "semantic_scholar_id",
    "openalex_id",
    "title_authors_year_hash"
  ];
  const candidates: PaperIdentityCandidate[] = literature.identifiers
    .filter((identifier) => priority.some((kind) => kind === identifier.kind))
    .map((identifier) => ({
      id: `${identifier.kind}:${identifier.value}`,
      kind: identifier.kind as PaperIdentityCandidate["kind"],
      role: identifier.role === "candidate_alias" ? "candidate_alias" as const : "confirmed_identifier" as const,
      source: identifier.source,
      value: identifier.value
    }))
    .sort((left, right) => priority.indexOf(left.kind) - priority.indexOf(right.kind));
  const fallback: PaperIdentityCandidate = {
    id: `local_paper_id:${paper.id}`,
    kind: "local_paper_id",
    role: "local_compatibility",
    source: "local",
    value: paper.id
  };
  const primary = candidates[0] ?? fallback;
  return Object.freeze({
    authority: Object.freeze({
      kind: "confirmed_literature" as const,
      literatureId: literature.literatureId,
      revision: literature.revision
    }),
    candidates: Object.freeze([...candidates, fallback].map((candidate) => Object.freeze({ ...candidate }))),
    paperId: paper.id,
    primary: Object.freeze({ ...primary }),
    sourcePath: paper.sourcePath,
    title: literature.title
  });
}

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
  "openreview_id",
  "dblp_key",
  "pmlr_id",
  "semantic_scholar_id",
  "openalex_id",
  "title_authors_year_hash",
  "local_paper_id"
]);

const sha256RoundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function sha256Hex(value: string): string {
  const source = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  new DataView(padded.buffer).setUint32(paddedLength - 4, source.length * 8);
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + sha256RoundConstants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function compact(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeBibliographicText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function normalizeBibliographicAuthor(value: unknown): string {
  const source = String(value ?? "").normalize("NFKC");
  const parts = source.split(",").map((part) => part.trim()).filter(Boolean);
  return normalizeBibliographicText(parts.length === 2 ? `${parts[1]} ${parts[0]}` : source);
}

export function normalizeLiteratureIdentifier(kind: string, value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (kind === "doi") {
    const identifier = normalized
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[.,;:]+$/, "")
      .toLocaleLowerCase("en-US");
    return identifier.length <= 1_000 && /^10\.\d{4,9}\/[^\s?#]+$/u.test(identifier) ? identifier : "";
  }
  if (kind === "arxiv_id") {
    const identifier = normalized
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
      .replace(/^arxiv:\s*/i, "")
      .replace(/\.pdf$/i, "")
      .toLocaleLowerCase("en-US");
    return /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/.test(identifier)
      ? identifier
      : "";
  }
  if (kind === "semantic_scholar_id") {
    const identifier = normalized
      .replace(/^corpusid\s*:\s*/i, "corpus:")
      .replace(/\s*:\s*/g, ":")
      .toLocaleLowerCase("en-US");
    return /^(?:corpus:[1-9]\d*|[a-f0-9]{40})$/.test(identifier) ? identifier : "";
  }
  if (kind === "openalex_id") {
    const workId = normalized.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "");
    return /^w\d+$/i.test(workId) ? workId.toUpperCase() : "";
  }
  if (kind === "openreview_id") {
    let noteId = normalized.replace(/^openreview:\s*/i, "");
    try {
      const url = new URL(noteId);
      if (!new Set(["openreview.net", "www.openreview.net", "api.openreview.net", "api2.openreview.net"]).has(url.hostname)) return "";
      noteId = url.searchParams.get("id") ?? "";
    } catch {
      // Plain OpenReview note ids are accepted below.
    }
    return /^[A-Za-z0-9_-]{6,200}$/.test(noteId) ? noteId : "";
  }
  if (kind === "dblp_key") {
    let key = normalized
      .replace(/^https?:\/\/(?:www\.)?dblp\.org\/rec\//i, "")
      .replace(/\.(?:html|xml|json)$/i, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      return "";
    }
    return /^(?:conf|journals)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/.test(key) && !key.includes("..")
      ? key
      : "";
  }
  if (kind === "pmlr_id") {
    let identifier = normalized.replace(/^pmlr:\s*/i, "");
    try {
      const url = new URL(identifier);
      if (!new Set(["proceedings.mlr.press", "www.proceedings.mlr.press"]).has(url.hostname)) return "";
      identifier = url.pathname.replace(/^\/+/, "").replace(/\.html$/i, "");
    } catch {
      // Non-URL PMLR identifiers are normalized below.
    }
    identifier = identifier.replace(/^pmlr-v(\d{1,4})-/i, "v$1/").toLocaleLowerCase("en-US");
    return /^v[1-9]\d{0,3}\/[a-z0-9][a-z0-9._-]{0,199}$/.test(identifier) && !identifier.includes("..")
      ? identifier
      : "";
  }
  if (kind === "title_authors_year_hash") {
    const identifier = normalized.toLocaleLowerCase("en-US");
    return /^(?:sha256:[a-f0-9]{64}|[a-f0-9]{8})$/.test(identifier) ? identifier : "";
  }
  return normalized.toLocaleLowerCase("en-US");
}

export function isLegacyTitleAuthorsYearHash(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value.trim());
}

export function titleAuthorsYearFingerprint(input: {
  authors?: readonly unknown[];
  title?: unknown;
  year?: unknown;
}): string {
  const title = normalizeBibliographicText(input.title);
  const authors = Array.isArray(input.authors)
    ? [...new Set(input.authors.map(normalizeBibliographicAuthor).filter(Boolean))].sort()
    : [];
  const year = input.year;
  if (!title || authors.length === 0 || authors.some((author) => !author) || !Number.isInteger(year)) return "";
  return `sha256:${sha256Hex(JSON.stringify({ authors, title, year }))}`;
}

function normalizeDoi(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const match = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return normalizeLiteratureIdentifier("doi", match?.[0] ?? "");
}

function normalizeArxivId(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const match = text.match(
    /(?:arxiv[:/\s]+|abs\/|pdf\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i
  );
  return normalizeLiteratureIdentifier("arxiv_id", match?.[1] ?? "");
}

function normalizeSemanticScholarId(value: unknown) {
  const text = compact(value);
  if (!text) {
    return "";
  }
  const corpusId = text.match(/(?:CorpusID|corpus id)[:\s]+(\d+)/i)?.[1];
  if (corpusId) {
    return normalizeLiteratureIdentifier("semantic_scholar_id", `corpus:${corpusId}`);
  }
  const paperId = text.match(/(?:semanticscholar\.org\/paper\/[^/\s]+\/|paper\/)([a-f0-9]{40})/i)?.[1] ??
    text.match(/^[a-f0-9]{40}$/i)?.[0];
  return normalizeLiteratureIdentifier("semantic_scholar_id", paperId ?? "");
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
  source: PaperIdentitySource,
  role: PaperIdentityCandidateRole = kind === "title_authors_year_hash"
    ? "candidate_alias"
    : kind === "local_paper_id"
      ? "local_compatibility"
      : "confirmable_hint"
): PaperIdentityCandidate {
  return {
    id: `${kind}:${value}`,
    kind,
    role,
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

export function resolvePaperIdentity(input: PaperIdentityInput): PaperIdentity {
  if (input.literature) {
    return paperIdentityFromLiterature(input, input.literature);
  }
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
    titleAuthorsYearFingerprint({
      authors: normalizeAuthors(input.authors ?? input.metadata?.authors),
      title: input.title,
      year: Number(normalizeYear(input.year ?? input.metadata?.year)) || undefined
    }),
    "metadata"
  );
  addCandidate(candidates, "local_paper_id", input.id, "local");

  const primary = identityPriority
    .map((kind) => firstByKind(candidates, kind))
    .find((candidate): candidate is PaperIdentityCandidate => Boolean(candidate)) ??
    createCandidate("local_paper_id", input.id, "local");

  return Object.freeze({
    authority: Object.freeze({ kind: "candidate_hints" as const }),
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

export function inferPaperIdentityMetadataFromPdfText(value: string): Pick<Paper, "arxivId" | "doi"> {
  const text = compact(value);
  if (!text) {
    return {};
  }
  const doi = normalizeDoi(
    text.match(/(?:doi\s*[:：]\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[\-._;()/:A-Z0-9]+)/i)?.[1]
  );
  const arxivId = normalizeArxivId(
    text.match(/(?:arxiv\s*[:：]\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1]
  );
  return {
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {})
  };
}

export function freezePaperIdentity(identity: PaperIdentity): PaperIdentity {
  const authority = identity.authority?.kind === "confirmed_literature" &&
    typeof identity.authority.literatureId === "string" && Number.isSafeInteger(identity.authority.revision)
    ? identity.authority
    : { kind: "candidate_hints" as const };
  return Object.freeze({
    ...identity,
    authority: Object.freeze({ ...authority }),
    candidates: Object.freeze(identity.candidates.map((candidate) => Object.freeze({
      ...candidate,
      role: candidate.role ?? (candidate.kind === "title_authors_year_hash"
        ? "candidate_alias"
        : candidate.kind === "local_paper_id"
          ? "local_compatibility"
          : "confirmable_hint")
    }))),
    primary: Object.freeze({
      ...identity.primary,
      role: identity.primary.role ?? (identity.primary.kind === "title_authors_year_hash"
        ? "candidate_alias"
        : identity.primary.kind === "local_paper_id"
          ? "local_compatibility"
          : "confirmable_hint")
    })
  });
}

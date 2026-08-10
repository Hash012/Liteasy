export type LiteratureIdentifierKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "title_authors_year_hash";

export type LiteratureSource = "public_registry" | "manual" | "inferred" | "metadata";

export type LiteratureIdentifier = {
  kind: LiteratureIdentifierKind;
  source: LiteratureSource;
  value: string;
};

export type LiteratureProvider =
  | "intuecho"
  | "openalex"
  | "crossref"
  | "arxiv"
  | "semantic_scholar";

export type LiteratureDisplayRecord = {
  authors: string[];
  documentType?: string;
  identifiers: LiteratureIdentifier[];
  title: string;
  year?: number;
};

export type LiteratureCandidate = {
  candidateKey: string;
  provider: LiteratureProvider;
  record: LiteratureDisplayRecord;
  recordUrl?: string;
};

export type LiteratureRecord = LiteratureDisplayRecord & {
  identifiers: Array<LiteratureIdentifier & { source: "public_registry" }>;
  literatureId: string;
  provenance: {
    confirmedAt: string;
    mode: "public_registry";
    provider?: LiteratureProvider;
  };
  revision: number;
  status: "confirmed";
};

export type LegacyLiteratureRecord = LiteratureDisplayRecord & {
  identifiers: Array<{
    kind: LiteratureIdentifierKind;
    source: "inferred" | "manual" | "metadata";
    value: string;
  }>;
  literatureId: string;
  recordSource: "legacy_metadata" | "manual";
  status: "legacy_unverified";
};

export type ReadableLiteratureRecord = LiteratureRecord | LegacyLiteratureRecord;

export type LiteratureSnapshot = {
  literature: LiteratureRecord;
  version: 1;
};

export type ReadableLiteratureSnapshot = {
  literature: ReadableLiteratureRecord;
  version: 1;
};

export type LiteratureHydrationState =
  | { status: "idle" | "loading" | "ready" }
  | { issues: Array<{ message: string; paperId: string }>; status: "recoverable_error" };

export type LiteratureResolveInput = {
  hints?: {
    authors?: string[];
    identifiers?: Array<{ kind: LiteratureIdentifierKind; value: string }>;
    pmlr?: {
      source: "pmlr";
      volume: number;
      year: number;
    };
    title?: string;
    year?: number;
  };
  limit?: number;
  purpose: "forum_compose" | "liteasy_pdf_annotation";
  query?: string;
};

type LiteratureProviderAvailability = {
  unavailableProviders: Array<Exclude<LiteratureProvider, "intuecho">>;
};

export type LiteratureResolveResult =
  | ({ candidate: LiteratureCandidate; status: "exact" } & LiteratureProviderAvailability)
  | ({ candidates: LiteratureCandidate[]; status: "ambiguous" } & LiteratureProviderAvailability)
  | ({ candidates: LiteratureCandidate[]; status: "conflict" } & LiteratureProviderAvailability)
  | ({ candidates: []; status: "not_found" } & LiteratureProviderAvailability)
  | ({ retryable: true; status: "unavailable" } & LiteratureProviderAvailability);

export type LiteratureConfirmInput = { candidateKey: string; mode: "candidate" };

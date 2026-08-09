export type LiteratureIdentifierKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "title_authors_year_hash";

export type LiteratureSource = "public_registry" | "manual" | "inferred";

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

export type ManualLiteratureInput = LiteratureDisplayRecord & {
  identifiers: Array<{
    kind: Exclude<LiteratureIdentifierKind, "title_authors_year_hash">;
    source: "manual";
    value: string;
  }>;
};

export type LiteratureRecord = LiteratureDisplayRecord & {
  literatureId: string;
  provenance: {
    confirmedAt: string;
    mode: "public_registry" | "manual";
    provider?: LiteratureProvider;
  };
};

export type LiteratureSnapshot = {
  literature: LiteratureRecord;
  version: 1;
};

export type LiteratureResolveInput = {
  hints?: {
    authors?: string[];
    identifiers?: Array<{ kind: LiteratureIdentifierKind; value: string }>;
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
  | ({ candidates: []; status: "not_found" } & LiteratureProviderAvailability)
  | ({ retryable: true; status: "unavailable" } & LiteratureProviderAvailability);

export type LiteratureConfirmInput =
  | { candidateKey: string; mode: "candidate" }
  | { mode: "manual"; record: ManualLiteratureInput };

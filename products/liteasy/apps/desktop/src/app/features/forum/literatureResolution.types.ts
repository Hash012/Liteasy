import type {
  LiteratureCandidate,
  LiteratureResolveResult
} from "../paper-identity/literature.types";

export type LiteratureSearchDraft = {
  authors: string[];
  title: string;
  year: number;
};

type LiteratureDialogBase = {
  message?: string;
  pending: boolean;
  searchDraft?: LiteratureSearchDraft;
  unavailableProviders: LiteratureResolveResult["unavailableProviders"];
};

export type LiteratureDialogModel =
  | (LiteratureDialogBase & {
      candidates: LiteratureCandidate[];
      kind: "candidates";
    })
  | (LiteratureDialogBase & {
      candidate: LiteratureCandidate;
      kind: "confirming";
    })
  | (LiteratureDialogBase & { kind: "conflict" })
  | (LiteratureDialogBase & { kind: "unresolved" })
  | (LiteratureDialogBase & {
      kind: "resolving";
    })
  | (LiteratureDialogBase & {
      kind: "unavailable";
    });

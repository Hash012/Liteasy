import type {
  LiteratureCandidate,
  LiteratureResolveResult
} from "../paper-identity/literature.types";

type LiteratureDialogBase = {
  message?: string;
  pending: boolean;
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
  | (LiteratureDialogBase & {
      kind: "manual";
    })
  | (LiteratureDialogBase & {
      kind: "resolving";
    })
  | (LiteratureDialogBase & {
      kind: "unavailable";
    });

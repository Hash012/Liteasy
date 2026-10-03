import type { Paper } from "../workspace/workspace.types";

/** Provenance, not authorization. Legacy organization URIs have no known revision. */
export type AssetSourceReference = {
  scopeType: "user" | "organization";
  scopeId: string;
  paperId: string;
  revision?: number;
};

export function paperSourceReferences(paper: Pick<Paper, "id" | "libraryReference" | "sourcePath">): AssetSourceReference[] {
  if (paper.libraryReference) return [{ ...paper.libraryReference, paperId: paper.id }];
  const legacyOrganization = paper.sourcePath?.match(/^org:\/\/([^/]+)\/shared-library\//);
  return legacyOrganization ? [{ scopeType: "organization", scopeId: legacyOrganization[1], paperId: paper.id }] : [];
}

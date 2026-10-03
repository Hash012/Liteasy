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


/** Portable note-return metadata only adds restrictions; it never grants access. */
export function noteSourceReferences(text: string): { sourceReferences?: AssetSourceReference[]; sourceResolution?: "unavailable" } {
  const header = text.match(/^---\r?\n([\s\S]{0,8192}?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!header || !/^sourcePolicy:\s*organization-bound\s*$/m.test(header)) return {};
  try {
    const field = (name: string) => {
      const matches = [...header.matchAll(new RegExp(`^${name}:\\s*(.*)$`, "gm"))];
      if (matches.length !== 1) throw new Error("Ambiguous source metadata");
      return matches[0][1].trim();
    };
    const namespace = field("sourceNamespace"), id: unknown = JSON.parse(field("sourceId")), organization: unknown = JSON.parse(field("organizationId"));
    const revision = Number(field("revision"));
    if (!["intuecho.annotation", "intuecho.reply", "intuecho.literature"].includes(namespace) || typeof id !== "string" || !id || typeof organization !== "string" || !organization || !Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid source metadata");
    return { sourceReferences: [{ scopeType: "organization", scopeId: organization, paperId: `${namespace}:${id}`, revision }] };
  } catch { return { sourceResolution: "unavailable" }; }
}

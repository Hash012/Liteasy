import type { ArtifactTab } from "../artifacts/artifact.types";
import type { ThinReadingEvidenceSpan } from "../thin-reading/thinReading.types";
import { paperAnchorEntitySchema, paperAnchorFromEvidence, paperAnchorsFromCitations } from "./paperAnchorEntity";

/** Read-only adaptation of old artifacts; the existing evidence record remains the source of truth. */
export function paperAnchorsForArtifact(tab: Pick<ArtifactTab, "paperAnchors" | "artifactId" | "analysis" | "citations" | "papers" | "thinReadingDocument">) {
  const evidence = [
    ...(tab.analysis?.evidence ?? []),
    ...Object.values(tab.thinReadingDocument?.nodes ?? {}).flatMap((node) =>
      (node.evidence?.paperEvidenceSpans ?? []).map((span: ThinReadingEvidenceSpan) => ({
        ...span,
        paperTitle: tab.papers?.find((paper) => paper.id === span.paperId)?.title,
      }))),
  ];
  const persisted = Array.isArray(tab.paperAnchors) ? tab.paperAnchors.flatMap((value) => {
    const parsed = paperAnchorEntitySchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  const anchors = [...persisted, ...evidence.map(paperAnchorFromEvidence)];
  if (!anchors.length) return paperAnchorsFromCitations(tab.citations ?? [], tab.papers ?? [], tab.artifactId);
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = JSON.stringify([anchor.id, anchor.source, anchor.locator, anchor.snapshot]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

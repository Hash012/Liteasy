import { accessibleEvidenceSources, bindEvidenceSnapshots, evidenceReportFromAnchors } from "../evidence/evidenceAdapters";
import { evidenceAnswerRevision, parseEvidenceReport, projectEvidenceReport, type EvidenceReportV1 } from "../evidence/evidenceReport";
import { paperAnchorFromEvidence, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import type { ThinReadingNodeEvidence } from "./thinReading.types";

export function thinReadingEvidenceAnchors(evidence: ThinReadingNodeEvidence, titleForPaper?: (paperId: string) => string | undefined): PaperAnchorEntity[] {
  return (evidence.paperEvidenceSpans ?? []).map(span => paperAnchorFromEvidence({ ...span, paperTitle: titleForPaper?.(span.paperId) }));
}

/** Generation and legacy audits describe a draft, never an independent verification.
 * With no live revision resolver, restored evidence remains a page-level snapshot. */
export function thinReadingEvidenceReport(input: {
  id: string; summary: string; evidence: ThinReadingNodeEvidence; anchors?: readonly PaperAnchorEntity[];
}): EvidenceReportV1 {
  const anchors = input.anchors ?? thinReadingEvidenceAnchors(input.evidence);
  const persisted = parseEvidenceReport(input.evidence.evidenceReport);
  const report = persisted ?? evidenceReportFromAnchors({ id: input.id, answer: input.summary, anchors,
    claims: input.evidence.summarySentences?.map((sentence) => ({ id: sentence.id, text: sentence.text, evidenceIds: sentence.evidenceIds })) });
  const externalSources = input.evidence.externalSources ?? [];
  if (!persisted) externalSources.forEach((source, index) => {
    const sourceId = `external-source:${index + 1}`;
    const passageId = `external-passage:${index + 1}`;
    const url = /^https?:\/\//i.test(source.url) ? source.url : undefined;
    report.sources.push({ id: sourceId, kind: "paper_abstract", title: source.title, url, coverage: source.abstract.trim() ? "abstract_only" : "metadata_only" });
    if (!source.abstract.trim()) return;
    report.passages.push({ id: passageId, sourceId, quote: source.abstract, locator: { precision: "unavailable" }, locatorIntegrity: "unavailable" });
    for (const sentence of input.evidence.summarySentences ?? []) {
      if (!sentence.externalKnowledge.includes(source.id)) continue;
      report.claims.find((claim) => claim.id === sentence.id)?.edges.push({ passageId, relation: "unassessed" });
    }
  });
  const accessible = accessibleEvidenceSources(report, anchors);
  report.sources.forEach((source) => {
    if (source.kind === "paper_abstract" && externalSources.some((external, index) => source.id === `external-source:${index + 1}` && source.title === external.title && source.url === (/^https?:\/\//i.test(external.url) ? external.url : undefined))) accessible.add(source.id);
  });
  // Prefer the current host label without changing the saved source identity or quote.
  report.sources.forEach((source) => {
    const anchor = anchors.find((candidate) => candidate.source.paperId === source.paperId && candidate.source.documentHash === source.documentHash && JSON.stringify(candidate.source.objectRef) === JSON.stringify(source.objectRef));
    if (source.kind === "paper_pdf" && anchor) source.title = anchor.presentation.title;
  });
  const bound = bindEvidenceSnapshots(report, anchors);
  bound.passages = bound.passages.filter((passage) => {
    const source = bound.sources.find((candidate) => candidate.id === passage.sourceId);
    return source?.kind !== "paper_abstract" || externalSources.some((external, index) => source.id === `external-source:${index + 1}` && passage.quote === external.abstract && passage.locator.precision === "unavailable");
  });
  return projectEvidenceReport(bound, { answerRevision: evidenceAnswerRevision(input.summary), accessibleSourceIds: accessible });
}

export function freezeThinReadingEvidenceReport(report: EvidenceReportV1): EvidenceReportV1 {
  const freeze = (value: unknown) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  const copy = JSON.parse(JSON.stringify(report)) as EvidenceReportV1;
  freeze(copy);
  return copy;
}

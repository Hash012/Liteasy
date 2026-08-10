import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import type {
  LiteratureCandidate,
  LiteratureIdentifier,
  LiteratureProvider,
  LiteratureRecord,
  LiteratureVersionRelation
} from "../paper-identity/literature.types";

export type LiteratureCandidateVersionGroup = {
  candidates: LiteratureCandidate[];
  id: string;
  versioned: boolean;
};

export type LiteratureVersionOpenTarget =
  | { kind: "local"; paperId: string }
  | { kind: "external"; url: string }
  | { kind: "unavailable" };

const providerLabels: Record<LiteratureProvider, string> = {
  arxiv: "arXiv",
  crossref: "Crossref",
  intuecho: "Intuecho",
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar"
};

export function literatureProviderLabel(provider: LiteratureProvider) {
  return providerLabels[provider];
}

function identifierKey(identifier: Pick<LiteratureIdentifier, "kind" | "value">) {
  const value = normalizeLiteratureIdentifier(identifier.kind, identifier.value);
  return value ? `${identifier.kind}:${value}` : "";
}

export function groupLiteratureCandidates(
  candidates: LiteratureCandidate[]
): LiteratureCandidateVersionGroup[] {
  const identifierOwners = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    for (const identifier of candidate.record.identifiers) {
      const key = identifierKey(identifier);
      if (!key) continue;
      identifierOwners.set(key, [...(identifierOwners.get(key) ?? []), index]);
    }
  });

  const adjacency = candidates.map(() => new Set<number>());
  candidates.forEach((candidate, index) => {
    for (const relation of candidate.relations ?? []) {
      const targetKey = identifierKey(relation.targetIdentifier);
      for (const targetIndex of identifierOwners.get(targetKey) ?? []) {
        if (targetIndex === index) continue;
        adjacency[index].add(targetIndex);
        adjacency[targetIndex].add(index);
      }
    }
  });

  const visited = new Set<number>();
  return candidates.flatMap((_candidate, startIndex) => {
    if (visited.has(startIndex)) return [];
    const queue = [startIndex];
    const indexes: number[] = [];
    visited.add(startIndex);
    while (queue.length > 0) {
      const index = queue.shift()!;
      indexes.push(index);
      for (const connected of adjacency[index]) {
        if (visited.has(connected)) continue;
        visited.add(connected);
        queue.push(connected);
      }
    }
    const groupedCandidates = indexes.sort((left, right) => left - right).map((index) => candidates[index]!);
    return [{
      candidates: groupedCandidates,
      id: groupedCandidates.map((candidate) => candidate.candidateKey).sort().join("|"),
      versioned: groupedCandidates.length > 1
    }];
  });
}

export function candidateVersionLabel(candidate: LiteratureCandidate) {
  const preprintRelation = candidate.relations?.find((relation) => relation.relationType === "is_preprint_of");
  if (preprintRelation?.direction === "from_current") return "预印本，关联正式发表版";
  if (preprintRelation?.direction === "to_current") return "正式版，关联预印本";
  const documentType = candidate.record.documentType?.toLocaleLowerCase("en-US") ?? "";
  if (documentType.includes("preprint") || documentType.includes("posted")) return "预印本";
  if (documentType.includes("article") || documentType.includes("publication")) return "正式发表版";
  return "文献版本";
}

export function relationEvidenceLabel(evidence: Record<string, unknown>) {
  const sourceField = typeof evidence.sourceField === "string" ? evidence.sourceField.trim() : "";
  if (sourceField) return sourceField;
  const candidateKey = typeof evidence.candidateKey === "string" ? evidence.candidateKey.trim() : "";
  if (candidateKey) return candidateKey;
  return "来源记录关系字段";
}

export function preferredCitationLiterature(
  current: LiteratureRecord,
  versions: LiteratureVersionRelation[]
) {
  return versions.find((version) =>
    version.direction === "from_current" && version.relation.relationType === "is_preprint_of"
  )?.literature ?? current;
}

export function createLiteratureCitationExport({
  current,
  format,
  selectedLiteratureId,
  versions
}: {
  current: LiteratureRecord;
  format: "bibtex" | "citation";
  selectedLiteratureId?: string;
  versions: LiteratureVersionRelation[];
}) {
  const availableLiterature = [current, ...versions.map((version) => version.literature)];
  const explicitlySelected = selectedLiteratureId
    ? availableLiterature.find((literature) => literature.literatureId === selectedLiteratureId)
    : undefined;
  const literature = explicitlySelected ?? preferredCitationLiterature(current, versions);
  return {
    literature,
    text: format === "bibtex"
      ? formatLiteratureBibtex(literature)
      : formatLiteratureCitation(literature)
  };
}

function preferredIdentifier(record: LiteratureRecord) {
  return record.identifiers.find((identifier) => identifier.kind === "doi")
    ?? record.identifiers.find((identifier) => identifier.kind === "arxiv_id")
    ?? record.identifiers.find((identifier) => identifier.kind === "openalex_id")
    ?? record.identifiers.find((identifier) => identifier.kind === "semantic_scholar_id");
}

function encodeIdentifierPath(value: string) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function literatureRecordUrl(
  record: LiteratureRecord,
  evidence: Record<string, unknown> = {}
) {
  const evidenceUrl = typeof evidence.recordUrl === "string" ? evidence.recordUrl.trim() : "";
  if (/^https:\/\//iu.test(evidenceUrl)) return evidenceUrl;
  const identifier = preferredIdentifier(record);
  if (!identifier) return "";
  if (identifier.kind === "doi") return `https://doi.org/${encodeIdentifierPath(identifier.value)}`;
  if (identifier.kind === "arxiv_id") return `https://arxiv.org/abs/${encodeIdentifierPath(identifier.value)}`;
  if (identifier.kind === "openalex_id") return `https://openalex.org/${encodeURIComponent(identifier.value)}`;
  if (identifier.kind === "semantic_scholar_id") {
    return `https://www.semanticscholar.org/paper/${encodeURIComponent(identifier.value)}`;
  }
  return "";
}

export function literatureVersionOpenTarget(
  record: LiteratureRecord,
  localPapers: Array<{ id: string; literature?: { literatureId: string } }>,
  evidence: Record<string, unknown> = {}
): LiteratureVersionOpenTarget {
  const localPaper = localPapers.find((paper) => paper.literature?.literatureId === record.literatureId);
  if (localPaper) return { kind: "local", paperId: localPaper.id };
  const url = literatureRecordUrl(record, evidence);
  return url ? { kind: "external", url } : { kind: "unavailable" };
}

export function formatLiteratureCitation(record: LiteratureRecord) {
  const authors = record.authors.join(", ") || "Unknown author";
  const year = record.year ? ` (${record.year}).` : ".";
  const identifierUrl = literatureRecordUrl(record);
  return `${authors}${year} ${record.title}.${identifierUrl ? ` ${identifierUrl}` : ""}`;
}

function bibtexValue(value: string) {
  return value.replace(/[{}]/gu, "").replace(/\s+/gu, " ").trim();
}

function bibtexKey(record: LiteratureRecord) {
  const authorParts = record.authors[0]?.split(/[\s,]+/u).filter(Boolean) ?? [];
  const author = authorParts[authorParts.length - 1] ?? "literature";
  const title = record.title.split(/\s+/u).find(Boolean) ?? "record";
  const key = `${author}${record.year ?? ""}${title}`.normalize("NFKD").replace(/[^a-z0-9]/giu, "");
  return key || record.literatureId.replace(/[^a-z0-9]/giu, "") || "literature";
}

export function formatLiteratureBibtex(record: LiteratureRecord) {
  const doi = record.identifiers.find((identifier) => identifier.kind === "doi")?.value;
  const arxivId = record.identifiers.find((identifier) => identifier.kind === "arxiv_id")?.value;
  const fields = [
    `  title = {${bibtexValue(record.title)}}`,
    ...(record.authors.length ? [`  author = {${record.authors.map(bibtexValue).join(" and ")}}`] : []),
    ...(record.year ? [`  year = {${record.year}}`] : []),
    ...(doi ? [`  doi = {${bibtexValue(doi)}}`] : []),
    ...(arxivId ? [`  eprint = {${bibtexValue(arxivId)}}`, "  archivePrefix = {arXiv}"] : [])
  ];
  return `@article{${bibtexKey(record)},\n${fields.join(",\n")}\n}`;
}

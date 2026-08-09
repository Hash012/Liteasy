import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../thin-reading/thinReading.types";

export type AssociationPageGraphProjection = {
  hiddenPaperCount: number;
  paperEdges: readonly {
    directed: boolean;
    kind: ThinReadingRecommendationPaperEdge["kind"];
    sourcePaperKey: string;
    strength: number;
    targetPaperKey: string;
  }[];
  paperNodes: readonly {
    anchorIds: readonly string[];
    paperKey: string;
    primaryAnchorId: string;
    secondaryAnchorIds: readonly string[];
    source: ThinReadingExternalSource;
  }[];
  primaryAnchorEdges: readonly { anchorId: string; paperKey: string }[];
};

export const maximumAssociationPageGraphPapers = 24;

type ProjectionAnchor = {
  anchorId: string;
  quality?: { score: number };
};

type OwnershipCandidate = {
  anchorId: string;
  anchorQuality: number;
  source: ThinReadingExternalSource;
};

type ProjectedPaperCandidate = {
  candidateByAnchorId: ReadonlyMap<string, OwnershipCandidate>;
  node: AssociationPageGraphProjection["paperNodes"][number];
  primary: OwnershipCandidate;
};

const confidenceBasisRank: Record<NonNullable<ThinReadingExternalSource["confidenceBasis"]>, number> = {
  algorithmic_retrieval: 0,
  citation_graph: 1,
  canonical_registry: 2,
  author_citation: 3
};

function compareOwnership(left: OwnershipCandidate, right: OwnershipCandidate) {
  return (confidenceBasisRank[right.source.confidenceBasis ?? "algorithmic_retrieval"] -
      confidenceBasisRank[left.source.confidenceBasis ?? "algorithmic_retrieval"]) ||
    ((right.source.confidence ?? 0.3) - (left.source.confidence ?? 0.3)) ||
    (right.source.relevance - left.source.relevance) ||
    (right.anchorQuality - left.anchorQuality) ||
    left.anchorId.localeCompare(right.anchorId) ||
    left.source.id.localeCompare(right.source.id) ||
    left.source.provider.localeCompare(right.source.provider) ||
    left.source.sourceId.localeCompare(right.source.sourceId) ||
    (left.source.canonicalPaperId ?? "").localeCompare(right.source.canonicalPaperId ?? "") ||
    (left.source.doi ?? "").localeCompare(right.source.doi ?? "");
}

function compareProjectedPaperValue(left: ProjectedPaperCandidate, right: ProjectedPaperCandidate) {
  return compareOwnership(left.primary, right.primary) ||
    left.node.paperKey.localeCompare(right.node.paperKey);
}

function selectAssociationPaperNodes(
  values: readonly ProjectedPaperCandidate[],
  anchors: readonly ProjectionAnchor[]
) {
  const anchorOrder = anchors.map((anchor, index) => ({ anchor, index }))
    .sort((left, right) =>
      (right.anchor.quality?.score ?? 0) - (left.anchor.quality?.score ?? 0) ||
      left.index - right.index ||
      left.anchor.anchorId.localeCompare(right.anchor.anchorId));
  const selectedPaperKeys = new Set<string>();

  for (const { anchor } of anchorOrder) {
    if (selectedPaperKeys.size >= maximumAssociationPageGraphPapers) break;
    const alreadyCovered = values.some(({ node }) =>
      selectedPaperKeys.has(node.paperKey) && node.anchorIds.includes(anchor.anchorId));
    if (alreadyCovered) continue;
    const best = values.filter(({ node }) =>
      !selectedPaperKeys.has(node.paperKey) && node.anchorIds.includes(anchor.anchorId))
      .sort((left, right) => {
        const leftCandidate = left.candidateByAnchorId.get(anchor.anchorId)!;
        const rightCandidate = right.candidateByAnchorId.get(anchor.anchorId)!;
        return compareOwnership(leftCandidate, rightCandidate) ||
          left.node.paperKey.localeCompare(right.node.paperKey);
      })[0];
    if (best) selectedPaperKeys.add(best.node.paperKey);
  }

  for (const value of [...values].sort(compareProjectedPaperValue)) {
    if (selectedPaperKeys.size >= maximumAssociationPageGraphPapers) break;
    selectedPaperKeys.add(value.node.paperKey);
  }

  return values.filter(({ node }) => selectedPaperKeys.has(node.paperKey))
    .map(({ node }) => node)
    .sort((left, right) => left.paperKey.localeCompare(right.paperKey));
}

function normalizedText(value: string) {
  return value.normalize("NFKC").trim();
}

function doiAlias(value: string | undefined, assumeDoi = false) {
  if (!value) return "";
  const raw = normalizedText(value);
  const hasDoiForm = assumeDoi || /^doi:/iu.test(raw) || /^https?:\/\/(?:dx\.)?doi\.org\//iu.test(raw) || /^10\./u.test(raw);
  if (!hasDoiForm) return "";
  const doi = raw.replace(/^doi:\s*/iu, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
    .toLowerCase();
  return doi ? `doi:${doi}` : "";
}

function normalizedIdentity(value: string | undefined) {
  if (!value) return "";
  const raw = normalizedText(value);
  const doi = doiAlias(raw);
  if (doi) return doi;
  const openAlex = raw.match(/^(?:https?:\/\/openalex\.org\/|openalex:)?(W\d+)$/iu);
  if (openAlex) return `openalex:${openAlex[1]!.toUpperCase()}`;
  const semanticScholar = raw.match(/^(?:https?:\/\/(?:www\.)?semanticscholar\.org\/paper\/|semantic_scholar:|semanticscholar:)([^\s/]+)$/iu);
  if (semanticScholar) return `semantic_scholar:${semanticScholar[1]!.toLowerCase()}`;
  return raw.toLowerCase();
}

function providerSourceAlias(source: ThinReadingExternalSource) {
  const provider = source.provider.toLowerCase();
  const sourceId = normalizedText(source.sourceId);
  if (!sourceId) return "";
  if (provider === "openalex") {
    return normalizedIdentity(sourceId);
  }
  if (provider === "semantic_scholar") {
    const normalized = normalizedIdentity(sourceId);
    return normalized.startsWith("semantic_scholar:")
      ? normalized
      : normalizedIdentity(`semantic_scholar:${sourceId}`);
  }
  return `${provider}:${sourceId.toLowerCase()}`;
}

type IdentityRecord = {
  candidate: OwnershipCandidate;
  canonicalAlias: string;
  doiAlias: string;
  fallbackAlias: string;
  providerAlias: string;
  strongAliases: readonly string[];
};

function identityRecord(candidate: OwnershipCandidate): IdentityRecord {
  const source = candidate.source;
  const canonicalAlias = normalizedIdentity(source.canonicalPaperId);
  const normalizedDoi = doiAlias(source.doi, true);
  const providerAlias = providerSourceAlias(source);
  const canonicalDoiConflict = canonicalAlias.startsWith("doi:") && normalizedDoi &&
    canonicalAlias !== normalizedDoi;
  const trusted = !canonicalDoiConflict;
  return {
    candidate,
    canonicalAlias: trusted ? canonicalAlias : "",
    doiAlias: trusted ? normalizedDoi : "",
    fallbackAlias: normalizedIdentity(source.id),
    providerAlias,
    strongAliases: trusted
      ? [...new Set([canonicalAlias, normalizedDoi, providerAlias].filter(Boolean))]
      : [providerAlias].filter(Boolean)
  };
}

function componentHasConflicts(records: readonly IdentityRecord[]) {
  const canonicals = new Set(records.map((record) => record.canonicalAlias).filter(Boolean));
  const dois = new Set(records.map((record) => record.doiAlias).filter(Boolean));
  return canonicals.size > 1 || dois.size > 1;
}

function preferredComponentKey(records: readonly IdentityRecord[]) {
  const canonical = records.map((record) => record.canonicalAlias)
    .filter((alias) => alias && !alias.startsWith("doi:"))
    .sort()[0];
  if (canonical) return canonical;
  const doi = records.map((record) => record.doiAlias ||
    (record.canonicalAlias.startsWith("doi:") ? record.canonicalAlias : ""))
    .filter(Boolean).sort()[0];
  if (doi) return doi;
  return records.map((record) => record.providerAlias).filter(Boolean).sort()[0] ??
    records.map((record) => record.fallbackAlias).filter(Boolean).sort()[0]!;
}

function relationKey(edge: AssociationPageGraphProjection["paperEdges"][number]) {
  return `${edge.kind}\u0000${edge.directed ? "directed" : "undirected"}\u0000${
    edge.sourcePaperKey
  }\u0000${edge.targetPaperKey}`;
}

export function projectAssociationPageGraph({
  anchors,
  paperEdges,
  sourcesByAnchor
}: {
  anchors: readonly ProjectionAnchor[];
  paperEdges: readonly ThinReadingRecommendationPaperEdge[];
  sourcesByAnchor: Readonly<Record<string, readonly ThinReadingExternalSource[]>>;
}): AssociationPageGraphProjection {
  const anchorQualityById = new Map(
    anchors.map((anchor) => [anchor.anchorId, anchor.quality?.score ?? 0] as const)
  );
  const records: IdentityRecord[] = [];
  for (const anchor of [...anchors].sort((left, right) => left.anchorId.localeCompare(right.anchorId))) {
    for (const source of sourcesByAnchor[anchor.anchorId] ?? []) {
      const record = identityRecord({
        anchorId: anchor.anchorId,
        anchorQuality: anchorQualityById.get(anchor.anchorId) ?? 0,
        source
      });
      if (record.strongAliases.length > 0 || record.fallbackAlias) records.push(record);
    }
  }

  const parents = records.map((_, index) => index);
  const find = (index: number): number => parents[index] === index
    ? index
    : (parents[index] = find(parents[index]!));
  const union = (leftIndex: number, rightIndex: number) => {
    const left = find(leftIndex);
    const right = find(rightIndex);
    if (left !== right) parents[Math.max(left, right)] = Math.min(left, right);
  };
  const firstIndexByAlias = new Map<string, number>();
  records.forEach((record, index) => record.strongAliases.forEach((alias) => {
    const first = firstIndexByAlias.get(alias);
    if (first === undefined) firstIndexByAlias.set(alias, index);
    else union(first, index);
  }));

  const recordsByRoot = new Map<number, IdentityRecord[]>();
  records.forEach((record, index) => {
    const root = find(index);
    recordsByRoot.set(root, [...(recordsByRoot.get(root) ?? []), record]);
  });
  const components = [...recordsByRoot.values()].flatMap((component) => {
    if (!componentHasConflicts(component)) return [{ conflicted: false, records: component }];
    const byProvider = new Map<string, IdentityRecord[]>();
    for (const record of component) {
      const key = record.providerAlias || record.fallbackAlias;
      byProvider.set(key, [...(byProvider.get(key) ?? []), record]);
    }
    return [...byProvider.values()].map((componentRecords) => ({
      conflicted: true,
      records: componentRecords
    }));
  });

  const componentByPaperKey = new Map(components.map((component) => [
    component.conflicted
      ? component.records.map((record) => record.providerAlias || record.fallbackAlias).sort()[0]!
      : preferredComponentKey(component.records),
    component
  ] as const));
  const allPaperCandidates = [...componentByPaperKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([paperKey, component]) => {
      const candidatesByAnchor = new Map<string, OwnershipCandidate>();
      for (const { candidate } of component.records) {
        const previous = candidatesByAnchor.get(candidate.anchorId);
        if (!previous || compareOwnership(candidate, previous) < 0) {
          candidatesByAnchor.set(candidate.anchorId, candidate);
        }
      }
      const candidates = [...candidatesByAnchor.values()].sort(compareOwnership);
      const primary = candidates[0]!;
      const anchorIds = [...candidatesByAnchor.keys()].sort();
      return {
        candidateByAnchorId: candidatesByAnchor,
        node: {
          anchorIds,
          paperKey,
          primaryAnchorId: primary.anchorId,
          secondaryAnchorIds: anchorIds.filter((anchorId) => anchorId !== primary.anchorId),
          source: primary.source
        },
        primary
      };
    });
  const paperNodes = selectAssociationPaperNodes(allPaperCandidates, anchors);
  const visiblePaperKeys = new Set(paperNodes.map((node) => node.paperKey));

  const paperKeysByAlias = new Map<string, Set<string>>();
  for (const [paperKey, component] of componentByPaperKey) {
    for (const record of component.records) {
      const aliases = component.conflicted
        ? [record.providerAlias, record.fallbackAlias]
        : [...record.strongAliases, record.fallbackAlias];
      for (const alias of aliases) {
        if (!alias) continue;
        const paperKeys = paperKeysByAlias.get(alias) ?? new Set();
        paperKeys.add(paperKey);
        paperKeysByAlias.set(alias, paperKeys);
      }
    }
  }
  const paperKeyByAlias = new Map([...paperKeysByAlias.entries()].flatMap(([alias, paperKeys]) =>
    paperKeys.size === 1 ? [[alias, [...paperKeys][0]!] as const] : []));
  const paperEdgeByKey = new Map<string, AssociationPageGraphProjection["paperEdges"][number]>();
  for (const edge of paperEdges) {
    const sourcePaperKey = paperKeyByAlias.get(normalizedIdentity(edge.sourcePaperId));
    const targetPaperKey = paperKeyByAlias.get(normalizedIdentity(edge.targetPaperId));
    if (!sourcePaperKey || !targetPaperKey || sourcePaperKey === targetPaperKey ||
      !visiblePaperKeys.has(sourcePaperKey) || !visiblePaperKeys.has(targetPaperKey)) continue;
    const endpoints = edge.directed
      ? [sourcePaperKey, targetPaperKey]
      : [sourcePaperKey, targetPaperKey].sort();
    const projected = {
      directed: edge.directed,
      kind: edge.kind,
      sourcePaperKey: endpoints[0]!,
      strength: edge.strength,
      targetPaperKey: endpoints[1]!
    };
    const key = relationKey(projected);
    const previous = paperEdgeByKey.get(key);
    if (!previous || projected.strength > previous.strength) paperEdgeByKey.set(key, projected);
  }

  return {
    hiddenPaperCount: allPaperCandidates.length - paperNodes.length,
    paperEdges: [...paperEdgeByKey.values()].sort((left, right) =>
      relationKey(left).localeCompare(relationKey(right))),
    paperNodes,
    primaryAnchorEdges: paperNodes.map((node) => ({
      anchorId: node.primaryAnchorId,
      paperKey: node.paperKey
    }))
  };
}

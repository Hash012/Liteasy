import { pageGraphPaperKey } from "../associations/associationGraphLayout";
import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "./thinReading.types";

export type ThinReadingPaperRelationsTransport = (request: {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
}) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

export type ThinReadingPaperRelationsResult = {
  edges: readonly ThinReadingRecommendationPaperEdge[];
  warnings: readonly string[];
};

const maximumPapers = 24;
const edgeFields = new Set([
  "directed",
  "evidenceRecordUrls",
  "kind",
  "provider",
  "sourcePaperId",
  "strength",
  "targetPaperId"
]);
const responseFields = new Set(["edges", "warnings"]);
const edgeKinds = new Set<ThinReadingRecommendationPaperEdge["kind"]>([
  "bibliographic_coupling",
  "co_cited",
  "direct_citation"
]);
const edgeProviders = new Set<ThinReadingRecommendationPaperEdge["provider"]>([
  "openalex",
  "semantic_scholar"
]);

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>) {
  return Object.keys(value).every((key) => fields.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || !value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function invalidResponse(): never {
  throw new Error("推荐文献关系返回格式无效。");
}

function normalizeEdge(
  value: unknown,
  requestedPaperKeys: ReadonlySet<string>
): ThinReadingRecommendationPaperEdge {
  if (!isRecord(value) || !hasOnlyFields(value, edgeFields) ||
    typeof value.directed !== "boolean" ||
    typeof value.kind !== "string" || !edgeKinds.has(value.kind as ThinReadingRecommendationPaperEdge["kind"]) ||
    typeof value.provider !== "string" || !edgeProviders.has(value.provider as ThinReadingRecommendationPaperEdge["provider"]) ||
    typeof value.sourcePaperId !== "string" || !requestedPaperKeys.has(value.sourcePaperId) ||
    typeof value.targetPaperId !== "string" || !requestedPaperKeys.has(value.targetPaperId) ||
    value.sourcePaperId === value.targetPaperId ||
    typeof value.strength !== "number" || !Number.isFinite(value.strength) ||
    value.strength < 0 || value.strength > 1 ||
    !Array.isArray(value.evidenceRecordUrls) || value.evidenceRecordUrls.length === 0 ||
    !value.evidenceRecordUrls.every(validHttpsUrl)) {
    return invalidResponse();
  }

  const kind = value.kind as ThinReadingRecommendationPaperEdge["kind"];
  const shouldBeDirected = kind === "direct_citation";
  if (value.directed !== shouldBeDirected) return invalidResponse();

  const endpoints = shouldBeDirected
    ? [value.sourcePaperId, value.targetPaperId]
    : [value.sourcePaperId, value.targetPaperId].sort();
  return {
    directed: shouldBeDirected,
    evidenceRecordUrls: [...new Set(value.evidenceRecordUrls as string[])].sort(),
    kind,
    provider: value.provider as ThinReadingRecommendationPaperEdge["provider"],
    sourcePaperId: endpoints[0],
    strength: value.strength,
    targetPaperId: endpoints[1]
  };
}

function edgeKey(edge: ThinReadingRecommendationPaperEdge) {
  return `${edge.kind}\u0000${edge.sourcePaperId}\u0000${edge.targetPaperId}`;
}

function compareEdgeCandidate(
  left: ThinReadingRecommendationPaperEdge,
  right: ThinReadingRecommendationPaperEdge
) {
  return right.strength - left.strength ||
    left.provider.localeCompare(right.provider) ||
    left.evidenceRecordUrls.join("\u0000").localeCompare(right.evidenceRecordUrls.join("\u0000"));
}

export function normalizeThinReadingPaperRelationEdges(
  values: readonly unknown[],
  requestedPaperKeys: ReadonlySet<string>
): readonly ThinReadingRecommendationPaperEdge[] {
  const edgeByKey = new Map<string, ThinReadingRecommendationPaperEdge>();
  for (const value of values) {
    const edge = normalizeEdge(value, requestedPaperKeys);
    const key = edgeKey(edge);
    const previous = edgeByKey.get(key);
    if (!previous || compareEdgeCandidate(edge, previous) < 0) {
      edgeByKey.set(key, edge);
    }
  }
  return [...edgeByKey.values()].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

export function listThinReadingPageRelationPapers(papers: readonly ThinReadingExternalSource[]) {
  const sourceByKey = new Map<string, ThinReadingExternalSource>();
  for (const source of papers) {
    const key = pageGraphPaperKey(source);
    if (key && !sourceByKey.has(key)) sourceByKey.set(key, source);
  }
  return [...sourceByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, maximumPapers)
    .map(([id, source]) => ({
      ...(source.canonicalPaperId ? { canonicalPaperId: source.canonicalPaperId } : {}),
      ...(source.doi ? { doi: source.doi } : {}),
      id,
      provider: source.provider,
      sourceId: source.sourceId
    }));
}

async function defaultTransport(request: Parameters<ThinReadingPaperRelationsTransport>[0]) {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
    signal: request.signal
  });
}

export function createThinReadingPaperRelationsClient(input: {
  endpoint: string;
  transport?: ThinReadingPaperRelationsTransport;
}) {
  return async (request: {
    artifactId: string;
    papers: readonly ThinReadingExternalSource[];
    signal?: AbortSignal;
  }): Promise<ThinReadingPaperRelationsResult> => {
    const papers = listThinReadingPageRelationPapers(request.papers);
    const response = await (input.transport ?? defaultTransport)({
      body: JSON.stringify({ artifactId: request.artifactId, papers }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: request.signal,
      url: `${input.endpoint.replace(/\/+$/u, "")}/v1/research/paper-relations`
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `推荐文献关系加载失败（${response.status}）。`;
      throw new Error(message);
    }
    if (!isRecord(payload) || !hasOnlyFields(payload, responseFields) ||
      !Array.isArray(payload.edges) || !Array.isArray(payload.warnings) ||
      !payload.warnings.every((warning) => typeof warning === "string" && Boolean(warning.trim()))) {
      return invalidResponse();
    }
    const requestedPaperKeys = new Set(papers.map((paper) => paper.id));
    return {
      edges: normalizeThinReadingPaperRelationEdges(payload.edges, requestedPaperKeys),
      warnings: [...new Set(payload.warnings.map((warning) => warning.trim()))].sort()
    };
  };
}

import { z } from "zod";

import {
  isUserPaperArtifactStoreAvailable,
  loadUserPaperArtifact,
  saveUserPaperArtifact
} from "../library/userPaperArtifactClient";
import type {
  LiteratureCandidate,
  LiteratureResolveInput,
  LiteratureResolveResult
} from "./literature.types";

const identifierSchema = z.object({
  kind: z.enum(["doi", "arxiv_id", "semantic_scholar_id", "openalex_id", "title_authors_year_hash"]),
  role: z.enum(["confirmable", "candidate_alias"]).optional(),
  source: z.enum(["public_registry", "manual", "inferred", "metadata"]),
  value: z.string().trim().min(1).max(1000)
}).strict();
const candidateSchema = z.object({
  candidateKey: z.string().trim().min(1).max(1500),
  provider: z.enum(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]),
  record: z.object({
    authors: z.array(z.string().trim().min(1).max(300)).max(200),
    documentType: z.string().trim().min(1).max(100).optional(),
    identifiers: z.array(identifierSchema).max(20),
    title: z.string().trim().min(1).max(1000),
    year: z.number().int().min(1000).max(9999).optional()
  }).strict(),
  relations: z.array(z.object({
    direction: z.enum(["from_current", "to_current"]),
    evidence: z.record(z.string(), z.unknown()),
    relationType: z.enum(["is_preprint_of", "version_of", "translation_of"]),
    targetIdentifier: z.object({
      kind: identifierSchema.shape.kind,
      value: z.string().trim().min(1).max(1000)
    }).strict()
  }).strict()).max(20).optional(),
  recordUrl: z.string().trim().url().max(2000).optional()
}).strict();
const requestSchema = z.object({
  hints: z.object({
    authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
    identifiers: z.array(z.object({
      kind: identifierSchema.shape.kind,
      value: z.string().trim().min(1).max(1000)
    }).strict()).max(20).optional(),
    pmlr: z.object({
      source: z.literal("pmlr"),
      volume: z.number().int().positive(),
      year: z.number().int().min(1000).max(9999)
    }).strict().optional(),
    title: z.string().trim().min(1).max(1000).optional(),
    year: z.number().int().min(1000).max(9999).optional()
  }).strict().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  purpose: z.enum(["forum_compose", "liteasy_pdf_annotation"]),
  query: z.string().trim().min(1).max(1000).optional()
}).strict();
const unavailableProvidersSchema = z.array(z.enum([
  "openalex",
  "crossref",
  "arxiv",
  "semantic_scholar"
])).max(4);
const resolutionSchema = z.discriminatedUnion("status", [
  z.object({
    request: requestSchema,
    status: z.literal("resolving"),
    updatedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    candidates: z.array(candidateSchema).min(1).max(20),
    request: requestSchema,
    status: z.literal("candidate"),
    unavailableProviders: unavailableProvidersSchema,
    updatedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    request: requestSchema,
    status: z.enum(["unresolved", "conflict", "unavailable"]),
    unavailableProviders: unavailableProvidersSchema,
    updatedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    literatureId: z.string().trim().min(1).max(200),
    request: requestSchema,
    revision: z.number().int().positive(),
    status: z.literal("confirmed"),
    updatedAt: z.string().datetime({ offset: true })
  }).strict()
]);
const snapshotSchema = z.object({
  resolution: resolutionSchema,
  version: z.literal(1)
}).strict();

export type LiteratureResolutionState = z.infer<typeof resolutionSchema>;

type Dependencies = {
  isAvailable?: () => boolean;
  loadArtifact: typeof loadUserPaperArtifact;
  saveArtifact: typeof saveUserPaperArtifact;
};

function requirePaperId(paperId: string) {
  const normalized = paperId.trim();
  if (!normalized) throw new Error("论文标识无效。");
  return normalized;
}

export function resolutionStateFromResult(
  request: LiteratureResolveInput,
  result: LiteratureResolveResult,
  updatedAt = new Date().toISOString()
): LiteratureResolutionState {
  if (result.status === "exact") {
    return {
      candidates: [result.candidate],
      request,
      status: "candidate",
      unavailableProviders: result.unavailableProviders,
      updatedAt
    };
  }
  if (result.status === "ambiguous") {
    return {
      candidates: result.candidates,
      request,
      status: "candidate",
      unavailableProviders: result.unavailableProviders,
      updatedAt
    };
  }
  return {
    request,
    status: result.status === "not_found" ? "unresolved" : result.status,
    unavailableProviders: result.unavailableProviders,
    updatedAt
  };
}

export function createLiteratureResolutionRepository(
  dependencies: Dependencies = {
    isAvailable: isUserPaperArtifactStoreAvailable,
    loadArtifact: loadUserPaperArtifact,
    saveArtifact: saveUserPaperArtifact
  }
) {
  return {
    async load(paperId: string): Promise<LiteratureResolutionState | undefined> {
      if (dependencies.isAvailable && !dependencies.isAvailable()) return undefined;
      const snapshot = await dependencies.loadArtifact<unknown>({
        artifactKind: "literature-resolution",
        paperId: requirePaperId(paperId)
      });
      if (snapshot === undefined) return undefined;
      const parsed = snapshotSchema.safeParse(snapshot);
      if (!parsed.success) throw new Error("文献身份解析状态无效。");
      return parsed.data.resolution;
    },
    async save(paperId: string, resolution: LiteratureResolutionState): Promise<void> {
      if (dependencies.isAvailable && !dependencies.isAvailable()) return;
      const parsed = resolutionSchema.safeParse(resolution);
      if (!parsed.success) throw new Error("文献身份解析状态无效。");
      await dependencies.saveArtifact({
        artifactKind: "literature-resolution",
        paperId: requirePaperId(paperId),
        snapshot: { resolution: parsed.data, version: 1 }
      });
    }
  };
}

export const literatureResolutionRepository = createLiteratureResolutionRepository();

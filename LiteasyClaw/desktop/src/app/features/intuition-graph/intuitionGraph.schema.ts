import { z } from "zod";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).max(120);
const level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paper"), analysisRunId: id }).strict(),
  z.object({ type: z.literal("community"), intuitionNoteId: id, authorId: id }).strict(),
  z.object({ type: z.literal("user"), localNoteId: id }).strict(),
  z.object({ type: z.literal("system"), ruleId: id }).strict()
]);

const stub = z.object({
  id, status: z.literal("stub"), label: z.string().min(1).max(500), suggestedLevel: level.optional(),
  expandable: z.literal(true), tags: z.array(z.string().max(80)).max(20)
}).strict();

const complete = z.object({
  id, status: z.literal("complete"),
  kind: z.enum(["thesis", "historical_coordinate", "intuition", "concept", "mechanism", "derivation", "experiment", "limitation", "evidence", "gap"]),
  baseLevel: level, label: z.string().min(1).max(500), summary: z.string().min(1).max(4000),
  hover: z.object({ text: z.string().min(1).max(1200), evidenceIds: z.array(id).max(20).optional(), prerequisiteNodeIds: z.array(id).max(20).optional() }).strict().optional(),
  evidenceIds: z.array(id).max(50), source, confidence: z.number().min(0).max(1).optional(),
  expandable: z.boolean(), tags: z.array(z.string().max(80)).max(20)
}).strict();

export const IntuitionGraphNodeSchema = z.discriminatedUnion("status", [stub, complete]);
export const IntuitionGraphEdgeSchema = z.object({
  id, sourceNodeId: id, targetNodeId: id,
  kind: z.enum(["expands", "explains", "supports", "contradicts", "requires", "compares", "derived_from", "intuits", "cites"]),
  label: z.string().max(500).optional(), hover: z.string().max(1200).optional(), evidenceIds: z.array(id).max(50)
}).strict();

export const IntuitionGraphDocumentSchema = z.object({
  version: z.literal("liteasy-intuition-graph/v1"), id, workId: z.string().min(1).max(300), rootNodeId: id,
  revision: z.number().int().positive(), nodes: z.array(IntuitionGraphNodeSchema).min(1).max(120), edges: z.array(IntuitionGraphEdgeSchema).max(300),
  provenance: z.object({ createdAt: z.string().datetime(), generatedBy: z.enum(["rule", "model", "user"]), analysisRunId: id.optional(), traceId: id.optional() }).strict()
}).strict();

export const IntuitionGraphPatchSchema = z.object({
  version: z.literal("liteasy-intuition-graph-patch/v1"), graphId: id, baseRevision: z.number().int().positive(), requestId: id,
  focusNodeId: id, targetLevel: level, upsertNodes: z.array(IntuitionGraphNodeSchema).max(12), upsertEdges: z.array(IntuitionGraphEdgeSchema).max(40),
  removeNodeIds: z.array(id).max(30), removeEdgeIds: z.array(id).max(50), explanation: z.string().min(1).max(2000)
}).strict();

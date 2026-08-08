import { z } from "zod";
import { generatedVisualizationModalities } from "./visualizationArtifact.types";
import type { VisualizationArtifactV1 } from "./visualizationArtifact.types";

const stableIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const finiteNumberSchema = z.number().finite();
const boundedText = (max: number) => z.string().min(1).max(max);
const modalitySchema = z.enum(["source_figure", ...generatedVisualizationModalities]);
const evidenceIdsSchema = z.array(stableIdSchema).max(256);
const coordinateSchema = z.tuple([finiteNumberSchema, finiteNumberSchema]);
const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1)
}).strict().superRefine((bbox, context) => {
  if (bbox.x + bbox.width > 1 || bbox.y + bbox.height > 1) {
    context.addIssue({ code: "custom", message: "normalized_bbox_out_of_bounds" });
  }
});

const semanticGraphSchema = z.object({
  subtype: z.enum(["flowchart", "mindmap", "causal_graph", "timeline"]),
  nodes: z.array(z.object({
    id: stableIdSchema,
    kind: boundedText(80),
    label: boundedText(500),
    objectPath: z.array(stableIdSchema).min(1).max(32),
    evidenceClaimIds: evidenceIdsSchema.optional(),
    position: z.object({ x: finiteNumberSchema, y: finiteNumberSchema }).strict().optional()
  }).strict()).max(512),
  edges: z.array(z.object({
    id: stableIdSchema,
    from: stableIdSchema,
    to: stableIdSchema,
    kind: z.enum(["content", "layout", "supports", "causes", "precedes"]),
    label: z.string().max(500).optional(),
    evidenceClaimIds: evidenceIdsSchema.optional()
  }).strict()).max(1024),
  groups: z.array(z.object({ id: stableIdSchema, label: boundedText(500), memberIds: z.array(stableIdSchema).max(512) }).strict()).max(256),
  hierarchy: z.array(z.object({ parentId: stableIdSchema, childId: stableIdSchema }).strict()).max(1024),
  timeOrder: z.array(stableIdSchema).max(512),
  claims: z.array(z.object({ id: stableIdSchema, text: boundedText(4000), evidenceIds: evidenceIdsSchema }).strict()).max(512)
}).strict();

const circuitSchema = z.object({
  components: z.array(z.object({
    id: stableIdSchema,
    kind: boundedText(80),
    position: coordinateSchema,
    ports: z.array(z.object({ id: stableIdSchema, name: boundedText(120), position: coordinateSchema }).strict()).max(32),
    evidenceClaimIds: evidenceIdsSchema
  }).strict()).max(512),
  wires: z.array(z.object({ id: stableIdSchema, from: stableIdSchema, to: stableIdSchema, evidenceClaimIds: evidenceIdsSchema }).strict()).max(1024),
  networks: z.array(z.object({ id: stableIdSchema, memberIds: z.array(stableIdSchema).max(512) }).strict()).max(512),
  parameters: z.array(z.object({ id: stableIdSchema, value: finiteNumberSchema, unit: boundedText(40), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  measurementPoints: z.array(z.object({ id: stableIdSchema, nodeId: stableIdSchema, evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  currents: z.array(z.object({ nodeId: stableIdSchema, values: z.array(finiteNumberSchema).max(64) }).strict()).max(256),
  voltages: z.array(z.object({ componentId: stableIdSchema, value: finiteNumberSchema, unit: boundedText(40) }).strict()).max(256)
}).strict();

const physicsDiagramSchema = z.object({
  objects: z.array(z.object({ id: stableIdSchema, kind: boundedText(80), position: coordinateSchema, label: z.string().max(500).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(512),
  vectors: z.array(z.object({ id: stableIdSchema, objectId: stableIdSchema, direction: coordinateSchema, magnitude: finiteNumberSchema.optional(), unit: z.string().max(40).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(512),
  rays: z.array(z.object({ id: stableIdSchema, from: coordinateSchema, to: coordinateSchema, evidenceClaimIds: evidenceIdsSchema }).strict()).max(512),
  constraints: z.array(z.object({ id: stableIdSchema, kind: boundedText(80), objectIds: z.array(stableIdSchema).max(64), evidenceClaimIds: evidenceIdsSchema }).strict()).max(512),
  annotations: z.array(z.object({ id: stableIdSchema, text: boundedText(1000), objectId: stableIdSchema.optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(512)
}).strict();

const biologyStructureSchema = z.object({
  ontologyVersion: boundedText(80),
  structures: z.array(z.object({ id: stableIdSchema, ontologyId: boundedText(160), label: boundedText(500), parentId: stableIdSchema.optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(2048),
  regions: z.array(z.object({ id: stableIdSchema, structureId: stableIdSchema, label: boundedText(500), evidenceClaimIds: evidenceIdsSchema }).strict()).max(2048),
  connections: z.array(z.object({ id: stableIdSchema, from: stableIdSchema, to: stableIdSchema, direction: z.string().max(80).optional(), label: z.string().max(500).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(4096)
}).strict();

const geometry2dSchema = z.object({
  objects: z.array(z.object({
    id: stableIdSchema,
    kind: z.enum(["point", "line", "segment", "circle", "arc", "polygon", "curve"]),
    data: z.record(z.string().max(80), z.union([finiteNumberSchema, boundedText(240), z.array(finiteNumberSchema).max(64)])).superRefine((data, context) => {
      if (Object.keys(data).length > 64) context.addIssue({ code: "custom", message: "geometry_data_limit_exceeded" });
    }),
    evidenceClaimIds: evidenceIdsSchema
  }).strict()).max(512),
  constraints: z.array(z.object({ id: stableIdSchema, kind: boundedText(80), objectIds: z.array(stableIdSchema).max(64), evidenceClaimIds: evidenceIdsSchema }).strict()).max(1024),
  viewport: z.object({ xMin: finiteNumberSchema, xMax: finiteNumberSchema, yMin: finiteNumberSchema, yMax: finiteNumberSchema }).strict().superRefine((viewport, context) => {
    if (viewport.xMin >= viewport.xMax || viewport.yMin >= viewport.yMax) context.addIssue({ code: "custom", message: "geometry_viewport_invalid" });
  })
}).strict();

const functionPlotSchema = z.object({
  expression: boundedText(300),
  variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(32),
  domain: z.object({ min: finiteNumberSchema, max: finiteNumberSchema }).strict().superRefine((domain, context) => {
    if (domain.min >= domain.max) context.addIssue({ code: "custom", message: "function_domain_invalid" });
  }),
  parameters: z.array(z.object({ id: stableIdSchema, value: finiteNumberSchema, min: finiteNumberSchema, max: finiteNumberSchema, unit: z.string().max(40).optional(), evidenceClaimIds: evidenceIdsSchema }).strict().superRefine((parameter, context) => {
    if (parameter.min > parameter.max || parameter.value < parameter.min || parameter.value > parameter.max) context.addIssue({ code: "custom", message: "function_parameter_invalid" });
  })).max(64),
  axes: z.object({ xLabel: boundedText(120), yLabel: boundedText(120) }).strict(),
  keyPoints: z.array(z.object({ id: stableIdSchema, x: finiteNumberSchema, y: finiteNumberSchema, label: z.string().max(120).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  auxiliaryCurves: z.array(z.object({ id: stableIdSchema, expression: boundedText(300), evidenceClaimIds: evidenceIdsSchema }).strict()).max(64)
}).strict();

const geometry3dSchema = z.object({
  objects: z.array(z.object({ id: stableIdSchema, kind: boundedText(80), vertices: z.array(z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])).max(50000), faces: z.array(z.array(z.number().int().nonnegative()).max(64)).max(50000).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(512),
  constraints: z.array(z.object({ id: stableIdSchema, kind: boundedText(80), objectIds: z.array(stableIdSchema).max(64), evidenceClaimIds: evidenceIdsSchema }).strict()).max(1024),
  sections: z.array(z.object({ id: stableIdSchema, objectId: stableIdSchema, plane: z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  camera: z.object({ position: z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]), target: z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]), minDistance: z.number().gt(0), maxDistance: z.number().gt(0) }).strict().superRefine((camera, context) => {
    if (camera.minDistance > camera.maxDistance) context.addIssue({ code: "custom", message: "camera_distance_invalid" });
  })
}).strict();

const physicsProcessSchema = z.object({
  duration: z.number().gt(0).finite(),
  frameRate: z.number().int().gt(0).max(120),
  initialState: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(32), finiteNumberSchema).superRefine((state, context) => {
    if (Object.keys(state).length > 128) context.addIssue({ code: "custom", message: "physics_state_limit_exceeded" });
  }),
  parameters: z.array(z.object({ id: stableIdSchema, value: finiteNumberSchema, unit: boundedText(40), min: finiteNumberSchema, max: finiteNumberSchema, evidenceClaimIds: evidenceIdsSchema }).strict()).max(128),
  equations: z.array(z.object({ id: stableIdSchema, expression: boundedText(300), evidenceClaimIds: evidenceIdsSchema }).strict()).max(128),
  events: z.array(z.object({ id: stableIdSchema, time: z.number().nonnegative().finite(), label: boundedText(240), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  invariants: z.array(z.object({ id: stableIdSchema, expression: boundedText(300), evidenceClaimIds: evidenceIdsSchema }).strict()).max(128),
  errorTolerance: z.number().nonnegative().finite(),
  evidenceBindings: evidenceIdsSchema,
  seed: z.string().max(120).optional()
}).strict();

const reactionProcessSchema = z.object({
  species: z.array(z.object({ id: stableIdSchema, formula: boundedText(120), state: z.enum(["s", "l", "g", "aq"]), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  steps: z.array(z.object({ id: stableIdSchema, reactants: z.array(z.object({ speciesId: stableIdSchema, coefficient: z.number().int().positive() }).strict()).max(256), products: z.array(z.object({ speciesId: stableIdSchema, coefficient: z.number().int().positive() }).strict()).max(256), mechanism: z.array(z.object({ id: stableIdSchema, label: boundedText(240), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  conditions: z.array(z.object({ id: stableIdSchema, label: boundedText(240), value: z.string().max(240).optional(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  atomMap: z.array(z.object({ id: stableIdSchema, fromSpeciesId: stableIdSchema, fromAtom: z.number().int().nonnegative(), toSpeciesId: stableIdSchema, toAtom: z.number().int().nonnegative(), evidenceClaimIds: evidenceIdsSchema }).strict()).max(4096)
}).strict();

const rasterIllustrationSchema = z.object({
  visualSchema: boundedText(10000),
  composition: z.object({ width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096), aspectRatio: z.number().positive().finite() }).strict(),
  labels: z.array(z.object({ id: stableIdSchema, text: boundedText(500), evidenceClaimIds: evidenceIdsSchema }).strict()).max(256),
  styleLock: z.object({ palette: z.array(boundedText(40)).max(32), typography: boundedText(240), prohibitDecorativeClaims: z.literal(true) }).strict(),
  evidenceClaimIds: evidenceIdsSchema
}).strict();

const sourceFigureSchema = z.object({
  sourceFigureId: stableIdSchema,
  paperId: stableIdSchema,
  page: z.number().int().positive(),
  caption: boundedText(4000),
  imageRef: boundedText(500),
  regions: z.array(z.object({ id: stableIdSchema, bbox: bboxSchema, evidenceIds: evidenceIdsSchema }).strict()).max(256),
  extraction: z.object({ method: boundedText(120), confidence: z.number().min(0).max(1) }).strict()
}).strict();

const validationReportSchema = z.object({
  outcome: z.enum(["pass", "degraded", "fail"]),
  checks: z.array(z.object({
    gate: z.enum(["hard", "advisory"]),
    validatorId: stableIdSchema,
    validatorVersion: boundedText(80),
    outcome: z.enum(["pass", "warning", "fail"]),
    diagnosticCode: z.string().max(160).optional()
  }).strict()).max(256),
  repairCount: z.union([z.literal(0), z.literal(1)])
}).strict().superRefine((validation, context) => {
  if (!validation.checks.some((check) => check.gate === "hard")) {
    context.addIssue({ code: "custom", message: "visualization_hard_check_missing" });
  }
});

const visualizationSpecSchema = z.discriminatedUnion("modality", [
  z.object({ modality: z.literal("semantic_graph"), payload: semanticGraphSchema }).strict(),
  z.object({ modality: z.literal("circuit"), payload: circuitSchema }).strict(),
  z.object({ modality: z.literal("physics_diagram"), payload: physicsDiagramSchema }).strict(),
  z.object({ modality: z.literal("biology_structure"), payload: biologyStructureSchema }).strict(),
  z.object({ modality: z.literal("geometry_2d"), payload: geometry2dSchema }).strict(),
  z.object({ modality: z.literal("function_plot"), payload: functionPlotSchema }).strict(),
  z.object({ modality: z.literal("geometry_3d"), payload: geometry3dSchema }).strict(),
  z.object({ modality: z.literal("physics_process"), payload: physicsProcessSchema }).strict(),
  z.object({ modality: z.literal("reaction_process"), payload: reactionProcessSchema }).strict(),
  z.object({ modality: z.literal("raster_illustration"), payload: rasterIllustrationSchema }).strict(),
  z.object({ modality: z.literal("source_figure"), payload: sourceFigureSchema }).strict()
]);

const artifactSchema = z.object({
  artifactId: stableIdSchema,
  artifactVersion: z.literal("liteasy.visualization/v1"),
  modality: modalitySchema,
  nodeId: stableIdSchema,
  locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  spec: visualizationSpecSchema,
  implementation: z.object({
    skillId: stableIdSchema,
    skillVersion: boundedText(80),
    rendererId: stableIdSchema,
    rendererVersion: boundedText(80),
    kernelId: stableIdSchema.optional(),
    kernelVersion: boundedText(80).optional()
  }).strict(),
  evidenceBindings: z.array(z.object({ claimId: stableIdSchema, evidenceIds: evidenceIdsSchema, sourceFigureId: stableIdSchema.optional(), sourceRegion: bboxSchema.optional(), confidence: z.enum(["direct", "derived", "contextual"]) }).strict()).max(256),
  semanticObjects: z.array(z.object({ objectId: stableIdSchema, kind: boundedText(80), label: boundedText(500), objectPath: z.array(stableIdSchema).min(1).max(32), evidenceClaimIds: evidenceIdsSchema, selectable: z.boolean() }).strict()).max(512),
  interaction: z.object({ pan: z.boolean(), zoom: z.boolean(), rotate: z.boolean(), playback: z.enum(["none", "timeline", "stepwise"]), parameterIds: z.array(stableIdSchema).max(128), selectableObjectIds: z.array(stableIdSchema).max(512) }).strict(),
  accessibility: z.object({ summary: boundedText(4000), objectReadingOrder: z.array(stableIdSchema).max(512), dataTable: z.array(z.object({ label: boundedText(240), value: boundedText(1000) }).strict()).max(512).optional() }).strict(),
  validation: validationReportSchema,
  fallbackHistory: z.array(z.object({ from: modalitySchema, to: modalitySchema.optional(), reasonCode: boundedText(160) }).strict()).max(4),
  usage: z.object({ ledgerId: stableIdSchema, reservationId: stableIdSchema, providerRouteId: stableIdSchema, costPolicyVersion: boundedText(80), reservedUnits: z.number().finite().nonnegative(), settledUnits: z.number().finite().nonnegative() }).strict(),
  createdAt: z.string().datetime()
}).strict().superRefine((artifact, context) => {
  if (artifact.modality !== artifact.spec.modality || artifact.validation.outcome === "fail" || artifact.validation.checks.some((check) =>
    (check.gate === "hard" && check.outcome !== "pass") ||
    (check.gate === "advisory" && check.outcome === "fail")
  )) {
    context.addIssue({ code: "custom", message: "visualization_artifact_invalid" });
  }
});

export function parseVisualizationArtifact(value: unknown): VisualizationArtifactV1 {
  const result = artifactSchema.safeParse(value);
  if (!result.success) throw new Error("visualization_artifact_invalid");
  return result.data as VisualizationArtifactV1;
}

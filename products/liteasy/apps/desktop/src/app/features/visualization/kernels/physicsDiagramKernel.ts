import type { PhysicsDiagramSpecV1, SemanticObjectV1 } from "../visualizationArtifact.types";
import type { StableLayoutResultV1 } from "../rendering/scene.types";
import { layoutStableGraph } from "../rendering/stableLayout";

export type PhysicsDiagramValidationResult = {
  layout: StableLayoutResultV1;
  semanticObjects: readonly SemanticObjectV1[];
  selectableObjectIds: readonly string[];
};

const vectorUnits = new Set(["N", "m/s", "m", "rad", "degree", "unitless"]);

function assertUnique(ids: readonly string[], code: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function requireEvidence(ids: readonly string[], code = "physics_evidence_missing"): void {
  if (ids.length === 0) throw new Error(code);
}

function finitePair(pair: readonly [number, number]): boolean {
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1]);
}

export function validatePhysicsDiagram(spec: PhysicsDiagramSpecV1): PhysicsDiagramValidationResult {
  if (spec.objects.length === 0 || spec.objects.length > 512 || spec.vectors.length > 512) throw new Error("physics_bounds_invalid");
  assertUnique(spec.objects.map((object) => object.id), "physics_id_duplicate");
  assertUnique(spec.vectors.map((vector) => vector.id), "physics_id_duplicate");
  const objectIds = new Set(spec.objects.map((object) => object.id));

  for (const object of spec.objects) {
    requireEvidence(object.evidenceClaimIds);
    if (!finitePair(object.position)) throw new Error("physics_geometry_invalid");
  }
  for (const vector of spec.vectors) {
    requireEvidence(vector.evidenceClaimIds);
    if (!objectIds.has(vector.objectId)) throw new Error("physics_reference_invalid");
    if (!finitePair(vector.direction) || (vector.direction[0] === 0 && vector.direction[1] === 0)) throw new Error("physics_geometry_invalid");
    if (vector.magnitude !== undefined && !Number.isFinite(vector.magnitude)) throw new Error("physics_geometry_invalid");
    if (vector.unit && !vectorUnits.has(vector.unit)) throw new Error("physics_dimension_mismatch");
  }
  for (const ray of spec.rays) {
    requireEvidence(ray.evidenceClaimIds);
    if (!finitePair(ray.from) || !finitePair(ray.to)) throw new Error("physics_geometry_invalid");
  }
  for (const constraint of spec.constraints) {
    requireEvidence(constraint.evidenceClaimIds);
    if (constraint.objectIds.some((id) => !objectIds.has(id))) throw new Error("physics_reference_invalid");
  }
  for (const annotation of spec.annotations) {
    requireEvidence(annotation.evidenceClaimIds);
    if (annotation.objectId && !objectIds.has(annotation.objectId)) throw new Error("physics_reference_invalid");
  }

  const layout = layoutStableGraph({
    edges: spec.vectors.map((vector) => ({ factual: true, from: vector.objectId, id: vector.id, to: vector.objectId })),
    nodes: spec.objects.map((object) => ({ id: object.id, label: object.label ?? object.id }))
  }, "physics-diagram/v1");
  const objectSemantics = spec.objects.map((object) => ({
    evidenceClaimIds: [...object.evidenceClaimIds],
    kind: object.kind,
    label: object.label ?? object.id,
    objectId: object.id,
    objectPath: [object.id],
    selectable: true
  } satisfies SemanticObjectV1));
  const vectorSemantics = spec.vectors.map((vector) => ({
    evidenceClaimIds: [...vector.evidenceClaimIds],
    kind: "vector",
    label: vector.id,
    objectId: vector.id,
    objectPath: [vector.objectId, vector.id],
    selectable: true
  } satisfies SemanticObjectV1));
  return {
    layout,
    semanticObjects: [...objectSemantics, ...vectorSemantics],
    selectableObjectIds: [...objectSemantics, ...vectorSemantics].map((object) => object.objectId)
  };
}

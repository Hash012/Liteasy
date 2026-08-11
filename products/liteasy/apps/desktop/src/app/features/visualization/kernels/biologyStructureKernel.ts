import type { BiologyStructureSpecV1, SemanticObjectV1 } from "../visualizationArtifact.types";
import type { StableLayoutResultV1 } from "../rendering/scene.types";
import { layoutStableGraph } from "../rendering/stableLayout";

export type BiologyStructureValidationResult = {
  layout: StableLayoutResultV1;
  semanticObjects: readonly SemanticObjectV1[];
  selectableObjectIds: readonly string[];
};

const ontology = new Set([
  "liteasy:neuron",
  "liteasy:soma",
  "liteasy:axon",
  "liteasy:synapse"
]);

function assertUnique(ids: readonly string[], code: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function requireEvidence(ids: readonly string[], code: string): void {
  if (ids.length === 0) throw new Error(code);
}

export function validateBiologyStructure(spec: BiologyStructureSpecV1): BiologyStructureValidationResult {
  if (spec.structures.length === 0 || spec.structures.length > 2048 || spec.connections.length > 4096) {
    throw new Error("biology_bounds_invalid");
  }
  assertUnique(spec.structures.map((structure) => structure.id), "biology_id_duplicate");
  assertUnique(spec.regions.map((region) => region.id), "biology_id_duplicate");
  assertUnique(spec.connections.map((connection) => connection.id), "biology_id_duplicate");

  const structureIds = new Set(spec.structures.map((structure) => structure.id));
  for (const structure of spec.structures) {
    requireEvidence(structure.evidenceClaimIds, "biology_structure_unbound");
    if (!ontology.has(structure.ontologyId)) throw new Error("biology_ontology_unknown");
    if (structure.parentId && !structureIds.has(structure.parentId)) throw new Error("biology_parent_unknown");
  }
  for (const region of spec.regions) {
    requireEvidence(region.evidenceClaimIds, "biology_region_unbound");
    if (!structureIds.has(region.structureId)) throw new Error("biology_region_unbound");
  }
  for (const connection of spec.connections) {
    requireEvidence(connection.evidenceClaimIds, "biology_connection_unbound");
    if (!structureIds.has(connection.from) || !structureIds.has(connection.to)) throw new Error("biology_connection_unbound");
  }

  const layout = layoutStableGraph({
    edges: [
      ...spec.structures.flatMap((structure) => structure.parentId
        ? [{ factual: false, from: structure.parentId, id: `parent-${structure.id}`, to: structure.id }]
        : []),
      ...spec.connections.map((connection) => ({
        factual: true,
        from: connection.from,
        id: connection.id,
        label: connection.label,
        to: connection.to
      }))
    ],
    nodes: spec.structures.map((structure) => ({ id: structure.id, label: structure.label }))
  }, `biology-structure/v1:${spec.ontologyVersion}`);
  if (layout.diagnostics.some((diagnostic) => diagnostic.code === "layout_reference_invalid")) {
    throw new Error("biology_reference_invalid");
  }

  const structureObjects = spec.structures.map((structure) => ({
    evidenceClaimIds: [...structure.evidenceClaimIds],
    kind: structure.ontologyId,
    label: structure.label,
    objectId: structure.id,
    objectPath: structure.parentId ? [structure.parentId, structure.id] : [structure.id],
    selectable: true
  } satisfies SemanticObjectV1));
  const connectionObjects = spec.connections.map((connection) => ({
    evidenceClaimIds: [...connection.evidenceClaimIds],
    kind: "neural_connection",
    label: connection.label ?? connection.id,
    objectId: connection.id,
    objectPath: [connection.from, connection.to],
    selectable: true
  } satisfies SemanticObjectV1));

  return {
    layout,
    semanticObjects: [...structureObjects, ...connectionObjects],
    selectableObjectIds: [...structureObjects, ...connectionObjects].map((object) => object.objectId)
  };
}

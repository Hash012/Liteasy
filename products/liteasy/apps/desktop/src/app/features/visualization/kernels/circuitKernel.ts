import type { CircuitSpecV1, SemanticObjectV1 } from "../visualizationArtifact.types";
import type { StableLayoutResultV1 } from "../rendering/scene.types";
import { layoutStableGraph } from "../rendering/stableLayout";

export type CircuitValidationResult = {
  invariants: {
    kcl: "pass" | "fail" | "not_applicable";
    kvl: "pass" | "not_applicable";
  };
  layout: StableLayoutResultV1;
  semanticObjects: readonly SemanticObjectV1[];
  selectableObjectIds: readonly string[];
};

function assertUnique(ids: readonly string[], code: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function requireEvidence(ids: readonly string[]): void {
  if (ids.length === 0) throw new Error("circuit_evidence_missing");
}

function finitePair(pair: readonly [number, number]): boolean {
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1]);
}

function kclStatus(currents: CircuitSpecV1["currents"]): CircuitValidationResult["invariants"]["kcl"] {
  if (currents.length === 0) return "not_applicable";
  for (const current of currents) {
    if (current.values.length < 2 || current.values.some((value) => !Number.isFinite(value))) return "fail";
    const signedSum = current.values.reduce((sum, value) => sum + value, 0);
    if (Math.abs(signedSum) <= 1e-9) continue;
    const sorted = current.values.map(Math.abs).sort((a, b) => b - a);
    const [largest = 0, ...rest] = sorted;
    if (Math.abs(largest - rest.reduce((sum, value) => sum + value, 0)) > 1e-9) return "fail";
  }
  return "pass";
}

export function validateCircuit(spec: CircuitSpecV1): CircuitValidationResult {
  if (spec.components.length === 0 || spec.components.length > 512 || spec.wires.length > 1024) {
    throw new Error("circuit_bounds_invalid");
  }
  assertUnique(spec.components.map((component) => component.id), "circuit_id_duplicate");
  assertUnique(spec.wires.map((wire) => wire.id), "circuit_id_duplicate");

  const portToComponent = new Map<string, string>();
  for (const component of spec.components) {
    requireEvidence(component.evidenceClaimIds);
    if (!finitePair(component.position)) throw new Error("circuit_geometry_invalid");
    for (const port of component.ports) {
      if (portToComponent.has(port.id)) throw new Error("circuit_id_duplicate");
      if (!finitePair(port.position)) throw new Error("circuit_geometry_invalid");
      portToComponent.set(port.id, component.id);
    }
  }

  for (const wire of spec.wires) {
    requireEvidence(wire.evidenceClaimIds);
    if (!portToComponent.has(wire.from) || !portToComponent.has(wire.to)) throw new Error("circuit_port_unknown");
  }
  for (const network of spec.networks) {
    if (network.memberIds.some((id) => !portToComponent.has(id))) throw new Error("circuit_port_unknown");
  }
  for (const parameter of spec.parameters) {
    requireEvidence(parameter.evidenceClaimIds);
    if (!Number.isFinite(parameter.value)) throw new Error("circuit_parameter_invalid");
  }
  for (const measurement of spec.measurementPoints) {
    requireEvidence(measurement.evidenceClaimIds);
    if (!portToComponent.has(measurement.nodeId)) throw new Error("circuit_port_unknown");
  }
  const knownCurrentNodes = new Set([
    ...spec.networks.map((network) => network.id),
    ...spec.measurementPoints.map((point) => point.id),
    ...portToComponent.keys()
  ]);
  for (const current of spec.currents) {
    if (!knownCurrentNodes.has(current.nodeId)) throw new Error("circuit_port_unknown");
  }

  const layout = layoutStableGraph({
    edges: spec.wires.map((wire) => ({
      factual: true,
      from: portToComponent.get(wire.from)!,
      id: wire.id,
      to: portToComponent.get(wire.to)!
    })),
    nodes: spec.components.map((component) => ({ id: component.id, label: component.id }))
  }, "circuit/v1");
  const componentObjects = spec.components.map((component) => ({
    evidenceClaimIds: [...component.evidenceClaimIds],
    kind: component.kind,
    label: component.id,
    objectId: component.id,
    objectPath: [component.id],
    selectable: true
  } satisfies SemanticObjectV1));
  const wireObjects = spec.wires.map((wire) => ({
    evidenceClaimIds: [...wire.evidenceClaimIds],
    kind: "wire",
    label: wire.id,
    objectId: wire.id,
    objectPath: [wire.id],
    selectable: true
  } satisfies SemanticObjectV1));

  return {
    invariants: {
      kcl: kclStatus(spec.currents),
      kvl: spec.voltages.length > 0 ? "pass" : "not_applicable"
    },
    layout,
    semanticObjects: [...componentObjects, ...wireObjects],
    selectableObjectIds: [...componentObjects, ...wireObjects].map((object) => object.objectId)
  };
}

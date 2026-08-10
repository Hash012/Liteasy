function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pass() {
  return { outcome: "pass" };
}

function fail(diagnosticCode) {
  return { diagnosticCode, outcome: "fail" };
}

function requireUnique(ids, code) {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function requireEvidence(ids, code) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(code);
}

function finitePair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function dagOrder(nodeIds, edges, code) {
  const incoming = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const ready = [...nodeIds].filter((id) => incoming.get(id) === 0).sort();
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const target of outgoing.get(id).sort()) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
    ready.sort();
  }
  if (ordered.length !== nodeIds.length) throw new Error(code);
  return ordered;
}

function proposalSchema(modality) {
  return {
    additionalProperties: false,
    properties: {
      accessibility: {
        additionalProperties: true,
        properties: {
          objectReadingOrder: { items: { type: "string" }, type: "array" },
          summary: { type: "string" }
        },
        required: ["objectReadingOrder", "summary"],
        type: "object"
      },
      evidenceBindings: { type: "array" },
      interaction: { type: "object" },
      semanticObjects: { type: "array" },
      spec: {
        additionalProperties: false,
        properties: {
          modality: { const: modality },
          payload: { type: "object" }
        },
        required: ["modality", "payload"],
        type: "object"
      }
    },
    required: ["accessibility", "evidenceBindings", "interaction", "semanticObjects", "spec"],
    type: "object"
  };
}

function validateSemanticGraph({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!payload.nodes?.length || payload.nodes.length > 512 || payload.edges?.length > 1024) throw new Error("semantic_graph_bounds_invalid");
    const claims = new Set(payload.claims.map((claim) => {
      requireEvidence(claim.evidenceIds, "semantic_graph_evidence_missing");
      return claim.id;
    }));
    const nodeIds = payload.nodes.map((node) => node.id);
    requireUnique(nodeIds, "semantic_graph_id_duplicate");
    requireUnique(payload.edges.map((edge) => edge.id), "semantic_graph_id_duplicate");
    const nodeIdSet = new Set(nodeIds);
    for (const node of payload.nodes) {
      requireEvidence(node.evidenceClaimIds, "semantic_graph_evidence_missing");
      if (node.evidenceClaimIds.some((id) => !claims.has(id))) throw new Error("semantic_graph_evidence_missing");
    }
    for (const edge of payload.edges) {
      if (!nodeIdSet.has(edge.from) || !nodeIdSet.has(edge.to)) throw new Error("semantic_graph_reference_invalid");
      if (edge.kind !== "layout") {
        requireEvidence(edge.evidenceClaimIds, "semantic_graph_evidence_missing");
        if (edge.evidenceClaimIds.some((id) => !claims.has(id))) throw new Error("semantic_graph_evidence_missing");
      }
    }
    if (payload.subtype === "timeline") {
      if (payload.timeOrder.length !== nodeIds.length || nodeIds.some((id) => !payload.timeOrder.includes(id))) {
        throw new Error("semantic_graph_time_order_invalid");
      }
    }
    if (payload.subtype === "mindmap") {
      dagOrder(nodeIds, payload.hierarchy.map((item) => ({ from: item.parentId, to: item.childId })), "semantic_graph_cycle");
    } else {
      dagOrder(nodeIds, payload.edges.filter((edge) => edge.kind !== "layout"), "semantic_graph_cycle");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateCircuit({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!payload.components?.length || payload.components.length > 512 || payload.wires?.length > 1024) throw new Error("circuit_bounds_invalid");
    requireUnique(payload.components.map((component) => component.id), "circuit_id_duplicate");
    requireUnique(payload.wires.map((wire) => wire.id), "circuit_id_duplicate");
    const ports = new Map();
    for (const component of payload.components) {
      requireEvidence(component.evidenceClaimIds, "circuit_evidence_missing");
      if (!finitePair(component.position)) throw new Error("circuit_geometry_invalid");
      for (const port of component.ports) {
        if (ports.has(port.id)) throw new Error("circuit_id_duplicate");
        if (!finitePair(port.position)) throw new Error("circuit_geometry_invalid");
        ports.set(port.id, component.id);
      }
    }
    for (const wire of payload.wires) {
      requireEvidence(wire.evidenceClaimIds, "circuit_evidence_missing");
      if (!ports.has(wire.from) || !ports.has(wire.to)) throw new Error("circuit_port_unknown");
    }
    for (const network of payload.networks) {
      if (network.memberIds.some((id) => !ports.has(id))) throw new Error("circuit_port_unknown");
    }
    for (const point of payload.measurementPoints) {
      requireEvidence(point.evidenceClaimIds, "circuit_evidence_missing");
      if (!ports.has(point.nodeId)) throw new Error("circuit_port_unknown");
    }
    const currentNodes = new Set([...ports.keys(), ...payload.networks.map((network) => network.id), ...payload.measurementPoints.map((point) => point.id)]);
    for (const current of payload.currents) {
      if (!currentNodes.has(current.nodeId) || current.values.some((value) => !Number.isFinite(value))) throw new Error("circuit_port_unknown");
      if (current.values.length >= 2) {
        const sorted = current.values.map(Math.abs).sort((a, b) => b - a);
        const [largest = 0, ...rest] = sorted;
        if (Math.abs(current.values.reduce((sum, value) => sum + value, 0)) > 1e-9 &&
          Math.abs(largest - rest.reduce((sum, value) => sum + value, 0)) > 1e-9) {
          throw new Error("circuit_kcl_failed");
        }
      }
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validatePhysicsDiagram({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    const vectorUnits = new Set(["N", "m/s", "m", "rad", "degree", "unitless"]);
    if (!payload.objects?.length || payload.objects.length > 512 || payload.vectors?.length > 512) throw new Error("physics_bounds_invalid");
    requireUnique(payload.objects.map((item) => item.id), "physics_id_duplicate");
    requireUnique(payload.vectors.map((item) => item.id), "physics_id_duplicate");
    const objectIds = new Set(payload.objects.map((item) => item.id));
    for (const item of payload.objects) {
      requireEvidence(item.evidenceClaimIds, "physics_evidence_missing");
      if (!finitePair(item.position)) throw new Error("physics_geometry_invalid");
    }
    for (const vector of payload.vectors) {
      requireEvidence(vector.evidenceClaimIds, "physics_evidence_missing");
      if (!objectIds.has(vector.objectId)) throw new Error("physics_reference_invalid");
      if (!finitePair(vector.direction) || (vector.direction[0] === 0 && vector.direction[1] === 0)) throw new Error("physics_geometry_invalid");
      if (vector.unit && !vectorUnits.has(vector.unit)) throw new Error("physics_dimension_mismatch");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateBiologyStructure({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    const ontology = new Set(["liteasy:neuron", "liteasy:soma", "liteasy:axon", "liteasy:synapse"]);
    if (!payload.structures?.length || payload.structures.length > 2048 || payload.connections?.length > 4096) throw new Error("biology_bounds_invalid");
    requireUnique(payload.structures.map((item) => item.id), "biology_id_duplicate");
    const structureIds = new Set(payload.structures.map((item) => item.id));
    for (const structure of payload.structures) {
      requireEvidence(structure.evidenceClaimIds, "biology_structure_unbound");
      if (!ontology.has(structure.ontologyId)) throw new Error("biology_ontology_unknown");
      if (structure.parentId && !structureIds.has(structure.parentId)) throw new Error("biology_parent_unknown");
    }
    for (const region of payload.regions) {
      requireEvidence(region.evidenceClaimIds, "biology_region_unbound");
      if (!structureIds.has(region.structureId)) throw new Error("biology_region_unbound");
    }
    for (const connection of payload.connections) {
      requireEvidence(connection.evidenceClaimIds, "biology_connection_unbound");
      if (!structureIds.has(connection.from) || !structureIds.has(connection.to)) throw new Error("biology_connection_unbound");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function descriptor({
  kernelId,
  modality,
  rendererId,
  skillId,
  validator
}) {
  return {
    hardValidators: [{ id: `${modality.replaceAll("_", "-")}-hard`, validate: validator, version: "1.0.0" }],
    implementation: {
      kernelId,
      kernelVersion: "1.0.0",
      rendererId,
      rendererVersion: "1.0.0",
      skillId,
      skillVersion: "1.0.0"
    },
    modality,
    proposalSchema: proposalSchema(modality)
  };
}

export const productionStaticScienceVisualizationCompilers = Object.freeze({
  biology_structure: descriptor({
    kernelId: "biology-structure-v1",
    modality: "biology_structure",
    rendererId: "biology-structure-svg",
    skillId: "biology-structure",
    validator: validateBiologyStructure
  }),
  circuit: descriptor({
    kernelId: "circuit-v1",
    modality: "circuit",
    rendererId: "circuit-svg",
    skillId: "circuit",
    validator: validateCircuit
  }),
  physics_diagram: descriptor({
    kernelId: "physics-diagram-v1",
    modality: "physics_diagram",
    rendererId: "physics-diagram-svg",
    skillId: "physics-diagram",
    validator: validatePhysicsDiagram
  }),
  semantic_graph: descriptor({
    kernelId: "semantic-graph-v1",
    modality: "semantic_graph",
    rendererId: "semantic-graph-svg",
    skillId: "semantic-graph",
    validator: validateSemanticGraph
  })
});

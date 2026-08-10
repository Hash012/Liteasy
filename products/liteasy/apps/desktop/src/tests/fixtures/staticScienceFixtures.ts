import type {
  BiologyStructureSpecV1,
  CircuitSpecV1,
  PhysicsDiagramSpecV1
} from "../../app/features/visualization/visualizationArtifact.types";

type CircuitOverrides = {
  currents?: CircuitSpecV1["currents"];
  wire?: CircuitSpecV1["wires"][number];
};

type PhysicsOverrides = {
  vectorUnit?: string;
};

type BiologyOverrides = {
  connections?: BiologyStructureSpecV1["connections"];
  ontologyId?: string;
};

export function ohmsLawFixture(overrides: CircuitOverrides = {}): CircuitSpecV1 {
  return {
    components: [
      {
        evidenceClaimIds: ["claim-circuit"],
        id: "battery",
        kind: "voltage_source",
        ports: [
          { id: "battery-pos", name: "+", position: [120, 120] },
          { id: "battery-neg", name: "-", position: [120, 260] }
        ],
        position: [120, 190]
      },
      {
        evidenceClaimIds: ["claim-circuit"],
        id: "resistor",
        kind: "resistor",
        ports: [
          { id: "resistor-in", name: "in", position: [360, 120] },
          { id: "resistor-out", name: "out", position: [360, 260] }
        ],
        position: [360, 190]
      }
    ],
    currents: overrides.currents ?? [],
    measurementPoints: [{ evidenceClaimIds: ["claim-circuit"], id: "junction", nodeId: "battery-pos" }],
    networks: [{ id: "loop", memberIds: ["battery-pos", "resistor-in", "resistor-out", "battery-neg"] }],
    parameters: [{ evidenceClaimIds: ["claim-circuit"], id: "ohms-law", unit: "V/A", value: 10 }],
    voltages: [{ componentId: "battery", unit: "V", value: 10 }],
    wires: [
      overrides.wire ?? { evidenceClaimIds: ["claim-circuit"], from: "battery-pos", id: "wire-1", to: "resistor-in" },
      { evidenceClaimIds: ["claim-circuit"], from: "resistor-out", id: "wire-2", to: "battery-neg" }
    ]
  };
}

export function projectileFixture(overrides: PhysicsOverrides = {}): PhysicsDiagramSpecV1 {
  return {
    annotations: [{ evidenceClaimIds: ["claim-physics"], id: "label-trajectory", objectId: "projectile", text: "抛体受重力作用" }],
    constraints: [{ evidenceClaimIds: ["claim-physics"], id: "constraint-ground", kind: "ground_reference", objectIds: ["projectile"] }],
    objects: [{ evidenceClaimIds: ["claim-physics"], id: "projectile", kind: "mass", label: "抛体", position: [180, 180] }],
    rays: [],
    vectors: [{ direction: [0, 1], evidenceClaimIds: ["claim-physics"], id: "gravity", magnitude: 9.8, objectId: "projectile", unit: overrides.vectorUnit ?? "N" }]
  };
}

export function neuralFixture(overrides: BiologyOverrides = {}): BiologyStructureSpecV1 {
  return {
    ontologyVersion: "liteasy-neuro/v1",
    connections: overrides.connections ?? [{ evidenceClaimIds: ["claim-biology"], from: "soma", id: "connection-1", label: "sends signal", to: "axon" }],
    regions: [{ evidenceClaimIds: ["claim-biology"], id: "region-synapse", label: "突触区", structureId: "synapse" }],
    structures: [
      { evidenceClaimIds: ["claim-biology"], id: "neuron", label: "神经元", ontologyId: "liteasy:neuron" },
      { evidenceClaimIds: ["claim-biology"], id: "soma", label: "胞体", ontologyId: overrides.ontologyId ?? "liteasy:soma", parentId: "neuron" },
      { evidenceClaimIds: ["claim-biology"], id: "axon", label: "轴突", ontologyId: "liteasy:axon", parentId: "neuron" },
      { evidenceClaimIds: ["claim-biology"], id: "synapse", label: "突触", ontologyId: "liteasy:synapse", parentId: "axon" }
    ]
  };
}

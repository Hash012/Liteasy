import { getBuiltinSkillSummary, getVisualizationBuiltinCatalog } from "../skills/builtinSkillRegistry";
import type { VisualizationModality, VisualizationArtifactV1 } from "./visualizationArtifact.types";
import { validatorsExist } from "./visualizationValidatorRegistry";

export type VisualizationRenderer = {
  id: string;
  modality: VisualizationModality;
  version: string;
  render?: (artifact: VisualizationArtifactV1, container?: unknown) => unknown;
};

export type VisualizationRendererRegistration = {
  id: string;
  load: () => Promise<VisualizationRenderer>;
  modality: VisualizationModality;
  version: string;
};

export type VisualizationKernelRegistration = {
  id: string;
  version: string;
};

const rendererRegistrations = new Map<string, VisualizationRendererRegistration>();
const rendererLoads = new Map<string, Promise<VisualizationRenderer>>();
const kernelRegistrations = new Map<string, VisualizationKernelRegistration>();
const staticModalityChain = {
  biology_structure: {
    kernelId: "biology-structure-v1",
    rendererId: "biology-structure-svg"
  },
  circuit: {
    kernelId: "circuit-v1",
    rendererId: "circuit-svg"
  },
  physics_diagram: {
    kernelId: "physics-diagram-v1",
    rendererId: "physics-diagram-svg"
  },
  semantic_graph: {
    kernelId: "semantic-graph-v1",
    rendererId: "semantic-graph-svg"
  },
  function_plot: {
    kernelId: "function-plot-v1",
    rendererId: "function-plot-svg"
  },
  geometry_2d: {
    kernelId: "geometry-2d-v1",
    rendererId: "geometry-2d-svg"
  },
  geometry_3d: {
    kernelId: "geometry-3d-v1",
    rendererId: "geometry-3d-svg"
  }
} as const satisfies Partial<Record<VisualizationModality, { kernelId: string; rendererId: string }>>;

export type VisualizationBuiltinCatalogV1 = ReturnType<typeof getVisualizationBuiltinCatalog>;
export type VisualizationUnavailableReason =
  | "catalog_disabled"
  | "catalog_missing"
  | "kernel_missing"
  | "renderer_missing"
  | "skill_missing"
  | "validator_missing";

export function registerVisualizationRenderer(registration: VisualizationRendererRegistration): void {
  if (rendererRegistrations.has(registration.id)) throw new Error("visualization_renderer_already_registered");
  rendererRegistrations.set(registration.id, registration);
}

export function loadVisualizationRenderer(id: string): Promise<VisualizationRenderer> {
  const registration = rendererRegistrations.get(id);
  if (!registration) return Promise.reject(new Error("visualization_renderer_not_found"));
  const existing = rendererLoads.get(id);
  if (existing) return existing;

  const load = registration.load().then((renderer) => {
    if (renderer.id !== registration.id || renderer.modality !== registration.modality || renderer.version !== registration.version) {
      throw new Error("visualization_renderer_manifest_invalid");
    }
    return renderer;
  });
  rendererLoads.set(id, load);
  void load.catch(() => {
    if (rendererLoads.get(id) === load) rendererLoads.delete(id);
  });
  return load;
}

export function getVisualizationRendererRegistration(id: string): VisualizationRendererRegistration | undefined {
  return rendererRegistrations.get(id);
}

export function registerVisualizationKernel(registration: VisualizationKernelRegistration): void {
  if (kernelRegistrations.has(registration.id)) throw new Error("visualization_kernel_already_registered");
  kernelRegistrations.set(registration.id, registration);
}

export function hasVisualizationKernel(id: string): boolean {
  return kernelRegistrations.has(id);
}

export function getVisualizationKernelRegistration(id: string): VisualizationKernelRegistration | undefined {
  return kernelRegistrations.get(id);
}

function availabilityReason(
  modality: VisualizationModality,
  catalog: VisualizationBuiltinCatalogV1
): VisualizationUnavailableReason | null {
  const entry = catalog.entries.find((item) => item.modality === modality);
  if (!entry) return "catalog_missing";
  if (!entry.enabled) return "catalog_disabled";
  const skill = getBuiltinSkillSummary().find((item) => item.id === entry.skillId && item.modality === modality);
  if (!skill) return "skill_missing";
  const renderer = rendererRegistrations.get(skill.rendererId);
  if (!renderer || renderer.modality !== skill.modality || renderer.version !== skill.version) return "renderer_missing";
  const kernelReady = !skill.kernelId || kernelRegistrations.has(skill.kernelId);
  if (!kernelReady) return "kernel_missing";
  if (!validatorsExist(skill.validatorIds)) return "validator_missing";
  return null;
}

export function getUnavailableVisualizationModalityReasons(
  catalog: VisualizationBuiltinCatalogV1 = getVisualizationBuiltinCatalog()
): Partial<Record<VisualizationModality, VisualizationUnavailableReason>> {
  const modalities = new Set<VisualizationModality>([
    ...catalog.entries.map((entry) => entry.modality),
    ...getBuiltinSkillSummary().map((skill) => skill.modality)
  ]);
  const reasons: Partial<Record<VisualizationModality, VisualizationUnavailableReason>> = {};
  for (const modality of modalities) {
    const reason = availabilityReason(modality, catalog);
    if (reason) reasons[modality] = reason;
  }
  return reasons;
}

export function getAvailableVisualizationModalities(
  catalog: VisualizationBuiltinCatalogV1 = getVisualizationBuiltinCatalog()
): VisualizationModality[] {
  return catalog.entries
    .filter((entry) => availabilityReason(entry.modality, catalog) === null)
    .map((entry) => entry.modality);
}

for (const [modality, registration] of Object.entries(staticModalityChain)) {
  registerVisualizationKernel({ id: registration.kernelId, version: "1.0.0" });
  registerVisualizationRenderer({
    id: registration.rendererId,
    modality: modality as VisualizationModality,
    version: "1.0.0",
    load: async () => {
      if (modality === "semantic_graph") return (await import("./renderers/semanticGraphRenderer")).semanticGraphVisualizationRenderer;
      if (modality === "circuit") return (await import("./renderers/circuitRenderer")).circuitVisualizationRenderer;
      if (modality === "physics_diagram") return (await import("./renderers/physicsDiagramRenderer")).physicsDiagramVisualizationRenderer;
      if (modality === "function_plot") return (await import("./renderers/functionPlotRenderer")).functionPlotVisualizationRenderer;
      if (modality === "geometry_2d") return (await import("./renderers/geometry2dRenderer")).geometry2dVisualizationRenderer;
      if (modality === "geometry_3d") return (await import("./renderers/geometry3dRenderer")).geometry3dVisualizationRenderer;
      return (await import("./renderers/biologyStructureRenderer")).biologyStructureVisualizationRenderer;
    }
  });
}

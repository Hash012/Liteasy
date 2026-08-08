import { getBuiltinSkillSummary } from "../skills/builtinSkillRegistry";
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

export function getAvailableVisualizationModalities(): VisualizationModality[] {
  return [...new Set(getBuiltinSkillSummary()
    .filter((skill) => {
      const renderer = rendererRegistrations.get(skill.rendererId);
      const kernelReady = !skill.kernelId || kernelRegistrations.has(skill.kernelId);
      return renderer?.modality === skill.modality && validatorsExist(skill.validatorIds) && kernelReady;
    })
    .map((skill) => skill.modality))];
}

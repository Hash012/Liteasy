import type { VisualizationModality } from "../../app/features/visualization/visualizationArtifact.types";

export type MultimodalEvaluationFixture = {
  accessibilitySummary: string;
  evidenceClaimIds: readonly string[];
  expectedObjectIds: readonly string[];
  fallbackModality?: VisualizationModality;
  maxRenderSize: { height: number; width: number };
  modality: VisualizationModality;
};

export const multimodalEvaluationFixtures: readonly MultimodalEvaluationFixture[] = [
  { accessibilitySummary: "source figure", evidenceClaimIds: ["claim-source"], expectedObjectIds: ["figure-1"], maxRenderSize: { height: 720, width: 960 }, modality: "source_figure" },
  { accessibilitySummary: "semantic graph", evidenceClaimIds: ["claim-graph"], expectedObjectIds: ["start", "end"], fallbackModality: "source_figure", maxRenderSize: { height: 600, width: 800 }, modality: "semantic_graph" },
  { accessibilitySummary: "circuit", evidenceClaimIds: ["claim-circuit"], expectedObjectIds: ["battery", "resistor"], fallbackModality: "source_figure", maxRenderSize: { height: 600, width: 800 }, modality: "circuit" },
  { accessibilitySummary: "physics diagram", evidenceClaimIds: ["claim-physics"], expectedObjectIds: ["projectile", "gravity"], fallbackModality: "source_figure", maxRenderSize: { height: 600, width: 800 }, modality: "physics_diagram" },
  { accessibilitySummary: "biology structure", evidenceClaimIds: ["claim-biology"], expectedObjectIds: ["neuron", "axon"], fallbackModality: "source_figure", maxRenderSize: { height: 600, width: 800 }, modality: "biology_structure" },
  { accessibilitySummary: "function plot", evidenceClaimIds: ["claim-math"], expectedObjectIds: ["vertex"], fallbackModality: "source_figure", maxRenderSize: { height: 480, width: 720 }, modality: "function_plot" },
  { accessibilitySummary: "2d geometry", evidenceClaimIds: ["claim-math"], expectedObjectIds: ["circle", "line", "tangent-point"], fallbackModality: "source_figure", maxRenderSize: { height: 560, width: 560 }, modality: "geometry_2d" },
  { accessibilitySummary: "3d geometry", evidenceClaimIds: ["claim-math"], expectedObjectIds: ["cube", "mid-section"], fallbackModality: "geometry_2d", maxRenderSize: { height: 600, width: 800 }, modality: "geometry_3d" },
  { accessibilitySummary: "physics process", evidenceClaimIds: ["claim-process"], expectedObjectIds: ["trajectory"], fallbackModality: "physics_diagram", maxRenderSize: { height: 480, width: 720 }, modality: "physics_process" },
  { accessibilitySummary: "reaction process", evidenceClaimIds: ["claim-process"], expectedObjectIds: ["overall"], fallbackModality: "source_figure", maxRenderSize: { height: 360, width: 720 }, modality: "reaction_process" },
  { accessibilitySummary: "raster illustration", evidenceClaimIds: ["claim-process"], expectedObjectIds: ["label-1"], fallbackModality: "source_figure", maxRenderSize: { height: 512, width: 512 }, modality: "raster_illustration" }
];

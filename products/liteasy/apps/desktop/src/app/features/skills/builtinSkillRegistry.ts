import { z } from "zod";
import sourceFigureManifest from "../visualization/skills/source-figure/skill.json";
import sourceFigureInstructions from "../visualization/skills/source-figure/instructions.md?raw";
import semanticGraphManifest from "../visualization/skills/semantic-graph/skill.json";
import semanticGraphInstructions from "../visualization/skills/semantic-graph/instructions.md?raw";
import circuitManifest from "../visualization/skills/circuit/skill.json";
import circuitInstructions from "../visualization/skills/circuit/instructions.md?raw";
import physicsDiagramManifest from "../visualization/skills/physics-diagram/skill.json";
import physicsDiagramInstructions from "../visualization/skills/physics-diagram/instructions.md?raw";
import biologyStructureManifest from "../visualization/skills/biology-structure/skill.json";
import biologyStructureInstructions from "../visualization/skills/biology-structure/instructions.md?raw";
import functionPlotManifest from "../visualization/skills/function-plot/skill.json";
import functionPlotInstructions from "../visualization/skills/function-plot/instructions.md?raw";
import geometry2dManifest from "../visualization/skills/geometry-2d/skill.json";
import geometry2dInstructions from "../visualization/skills/geometry-2d/instructions.md?raw";
import geometry3dManifest from "../visualization/skills/geometry-3d/skill.json";
import geometry3dInstructions from "../visualization/skills/geometry-3d/instructions.md?raw";
import physicsProcessManifest from "../visualization/skills/physics-process/skill.json";
import physicsProcessInstructions from "../visualization/skills/physics-process/instructions.md?raw";
import reactionProcessManifest from "../visualization/skills/reaction-process/skill.json";
import reactionProcessInstructions from "../visualization/skills/reaction-process/instructions.md?raw";
import rasterIllustrationManifest from "../visualization/skills/raster-illustration/skill.json";
import rasterIllustrationInstructions from "../visualization/skills/raster-illustration/instructions.md?raw";
import sharedBuiltinCatalog from "../../../../../../packages/shared/visualizationBuiltins.v1.json";
import type {
  BuiltinSkillLoader,
  BuiltinSkillManifestV1,
  BuiltinSkillPackageV1,
  BuiltinSkillSummary
} from "./builtinSkill.types";
import { hasVisualizationValidator } from "../visualization/visualizationValidatorRegistry";

const stableId = z.string().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/);
const modality = z.enum([
  "source_figure",
  "semantic_graph",
  "circuit",
  "physics_diagram",
  "biology_structure",
  "geometry_2d",
  "function_plot",
  "geometry_3d",
  "physics_process",
  "reaction_process",
  "raster_illustration"
]);

const manifestSchema = z.object({
  costClass: z.enum(["none", "low", "medium", "high"]),
  evidenceRequirements: z.array(z.string().min(1).max(200)).max(64),
  fallbackModalities: z.array(modality).max(8),
  id: stableId,
  integrityRules: z.array(z.string().min(1).max(200)).max(64),
  kernelId: stableId.optional(),
  modality,
  outputSchemaId: z.string().min(1).max(160),
  remote: z.literal(false),
  rendererId: stableId,
  runtimeVersion: z.literal("liteasy.visualization-runtime/v1"),
  styleLock: z.array(z.string().min(1).max(200)).max(64),
  validatorIds: z.array(stableId).max(64),
  version: z.string().min(1).max(40)
}).strict();

const packageSchema = z.object({
  fallbackModalities: z.array(modality).max(8).optional(),
  instructions: z.string().min(1).max(100_000),
  manifest: manifestSchema,
  validatorIds: z.array(stableId).max(64).optional()
}).strict();

const builtinCatalogSchema = z.object({
  entries: z.array(z.object({
    enabled: z.boolean(),
    generated: z.boolean(),
    modality,
    skillId: stableId
  }).strict()),
  version: z.literal("liteasy.visualization-builtins/v1")
}).strict();

type BuiltinSkillRegistration = {
  load: BuiltinSkillLoader;
  manifest: BuiltinSkillManifestV1;
};

const packages = new Map<string, BuiltinSkillRegistration>();

function parseManifest(value: unknown): BuiltinSkillManifestV1 {
  const result = manifestSchema.safeParse(value);
  if (!result.success || result.data.validatorIds.some((id) => !hasVisualizationValidator(id))) {
    throw new Error("builtin_skill_manifest_invalid");
  }
  return result.data as BuiltinSkillManifestV1;
}

function parsePackage(value: unknown, expectedManifest: BuiltinSkillManifestV1): BuiltinSkillPackageV1 {
  const result = packageSchema.safeParse(value);
  if (!result.success) throw new Error("builtin_skill_package_invalid");
  const packageManifest = parseManifest(result.data.manifest);
  if (JSON.stringify(packageManifest) !== JSON.stringify(expectedManifest)) {
    throw new Error("builtin_skill_package_invalid");
  }
  if (result.data.validatorIds && JSON.stringify(result.data.validatorIds) !== JSON.stringify(expectedManifest.validatorIds)) {
    throw new Error("builtin_skill_package_invalid");
  }
  if (result.data.fallbackModalities && JSON.stringify(result.data.fallbackModalities) !== JSON.stringify(expectedManifest.fallbackModalities)) {
    throw new Error("builtin_skill_package_invalid");
  }
  return {
    fallbackModalities: result.data.fallbackModalities,
    instructions: result.data.instructions,
    manifest: packageManifest,
    validatorIds: result.data.validatorIds
  };
}

export function registerBuiltinSkill(manifest: BuiltinSkillManifestV1, load: BuiltinSkillLoader) {
  const parsedManifest = parseManifest(manifest);
  if (packages.has(parsedManifest.id)) throw new Error("builtin_skill_already_registered");
  packages.set(parsedManifest.id, { manifest: parsedManifest, load });
}

export function getBuiltinSkillSummary(): BuiltinSkillSummary[] {
  return [...packages.values()].map(({ manifest }) => ({
    costClass: manifest.costClass,
    id: manifest.id,
    kernelId: manifest.kernelId,
    modality: manifest.modality,
    remote: false,
    rendererId: manifest.rendererId,
    validatorIds: [...manifest.validatorIds],
    version: manifest.version
  }));
}

export function loadBuiltinSkill(id: string): Promise<BuiltinSkillPackageV1> {
  const registration = packages.get(id);
  if (!registration) return Promise.reject(new Error("builtin_skill_not_found"));
  return registration.load().then((value) => parsePackage(value, registration.manifest));
}

const sourceFigure = parseManifest(sourceFigureManifest);
registerBuiltinSkill(sourceFigure, async () => ({
  manifest: sourceFigure,
  instructions: sourceFigureInstructions
}));

const semanticGraph = parseManifest(semanticGraphManifest);
registerBuiltinSkill(semanticGraph, async () => ({
  fallbackModalities: semanticGraph.fallbackModalities,
  manifest: semanticGraph,
  instructions: semanticGraphInstructions,
  validatorIds: semanticGraph.validatorIds
}));

const circuit = parseManifest(circuitManifest);
registerBuiltinSkill(circuit, async () => ({
  fallbackModalities: circuit.fallbackModalities,
  manifest: circuit,
  instructions: circuitInstructions,
  validatorIds: circuit.validatorIds
}));

const physicsDiagram = parseManifest(physicsDiagramManifest);
registerBuiltinSkill(physicsDiagram, async () => ({
  fallbackModalities: physicsDiagram.fallbackModalities,
  manifest: physicsDiagram,
  instructions: physicsDiagramInstructions,
  validatorIds: physicsDiagram.validatorIds
}));

const biologyStructure = parseManifest(biologyStructureManifest);
registerBuiltinSkill(biologyStructure, async () => ({
  fallbackModalities: biologyStructure.fallbackModalities,
  manifest: biologyStructure,
  instructions: biologyStructureInstructions,
  validatorIds: biologyStructure.validatorIds
}));

const functionPlot = parseManifest(functionPlotManifest);
registerBuiltinSkill(functionPlot, async () => ({
  fallbackModalities: functionPlot.fallbackModalities,
  manifest: functionPlot,
  instructions: functionPlotInstructions,
  validatorIds: functionPlot.validatorIds
}));

const geometry2d = parseManifest(geometry2dManifest);
registerBuiltinSkill(geometry2d, async () => ({
  fallbackModalities: geometry2d.fallbackModalities,
  manifest: geometry2d,
  instructions: geometry2dInstructions,
  validatorIds: geometry2d.validatorIds
}));

const geometry3d = parseManifest(geometry3dManifest);
registerBuiltinSkill(geometry3d, async () => ({
  fallbackModalities: geometry3d.fallbackModalities,
  manifest: geometry3d,
  instructions: geometry3dInstructions,
  validatorIds: geometry3d.validatorIds
}));

const physicsProcess = parseManifest(physicsProcessManifest);
registerBuiltinSkill(physicsProcess, async () => ({
  fallbackModalities: physicsProcess.fallbackModalities,
  manifest: physicsProcess,
  instructions: physicsProcessInstructions,
  validatorIds: physicsProcess.validatorIds
}));

const reactionProcess = parseManifest(reactionProcessManifest);
registerBuiltinSkill(reactionProcess, async () => ({
  fallbackModalities: reactionProcess.fallbackModalities,
  manifest: reactionProcess,
  instructions: reactionProcessInstructions,
  validatorIds: reactionProcess.validatorIds
}));

const rasterIllustration = parseManifest(rasterIllustrationManifest);
registerBuiltinSkill(rasterIllustration, async () => ({
  fallbackModalities: rasterIllustration.fallbackModalities,
  manifest: rasterIllustration,
  instructions: rasterIllustrationInstructions,
  validatorIds: rasterIllustration.validatorIds
}));

const builtinCatalog = builtinCatalogSchema.parse(sharedBuiltinCatalog);
for (const entry of builtinCatalog.entries.filter(({ enabled }) => enabled)) {
  const registration = packages.get(entry.skillId);
  if (!registration || registration.manifest.modality !== entry.modality) {
    throw new Error("builtin_skill_catalog_mismatch");
  }
}

export function getVisualizationBuiltinCatalog() {
  return {
    entries: builtinCatalog.entries.map((entry) => ({ ...entry })),
    version: builtinCatalog.version
  };
}

export type { BuiltinSkillRegistration };

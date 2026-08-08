import { z } from "zod";
import sourceFigureManifest from "../visualization/skills/source-figure/skill.json";
import sourceFigureInstructions from "../visualization/skills/source-figure/instructions.md?raw";
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

export type { BuiltinSkillRegistration };

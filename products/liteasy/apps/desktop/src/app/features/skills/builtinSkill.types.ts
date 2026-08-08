import type { VisualizationModality } from "../visualization/visualizationArtifact.types";

export type BuiltinSkillManifestV1 = {
  costClass: "none" | "low" | "medium" | "high";
  evidenceRequirements: string[];
  fallbackModalities: VisualizationModality[];
  id: string;
  integrityRules: string[];
  kernelId?: string;
  modality: VisualizationModality;
  outputSchemaId: string;
  remote: false;
  rendererId: string;
  runtimeVersion: "liteasy.visualization-runtime/v1";
  styleLock: string[];
  validatorIds: string[];
  version: string;
};

export type BuiltinSkillPackageV1 = {
  fallbackModalities?: VisualizationModality[];
  instructions: string;
  manifest: BuiltinSkillManifestV1;
  validatorIds?: string[];
};

export type BuiltinSkillLoader = () => Promise<BuiltinSkillPackageV1>;

export type BuiltinSkillSummary = Pick<
  BuiltinSkillManifestV1,
  "costClass" | "id" | "kernelId" | "modality" | "remote" | "rendererId" | "validatorIds" | "version"
>;

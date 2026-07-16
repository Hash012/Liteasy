import type { UIDslDocument } from "../generative-ui/generativeUi.types";

export type ArtifactTaskStatus = "queued" | "running" | "completed" | "failed";
export type ArtifactType = "comparison_table" | "mindmap" | "ppt" | "skill_doc" | "tree";

export type ArtifactTask = {
  id: string;
  type: ArtifactType;
  status: ArtifactTaskStatus;
};

export type ArtifactPreview = {
  nodes: string[];
  rootLabel: string;
};

export type ArtifactTab = {
  artifactId: string;
  markdown?: string;
  sourcePath?: string;
  preview?: ArtifactPreview;
  title: string;
  type: ArtifactType;
  uiDsl?: UIDslDocument;
};

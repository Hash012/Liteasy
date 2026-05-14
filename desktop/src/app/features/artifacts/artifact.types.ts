export type ArtifactType = "mindmap" | "tree" | "ppt" | "reader";

export type ArtifactTaskStatus = "queued" | "running" | "completed" | "failed";

export type ArtifactTask = {
  id: string;
  type: ArtifactType;
  status: ArtifactTaskStatus;
  title?: string;
};

export type ArtifactTab = {
  id: string;
  title: string;
  artifactId?: string;
  artifactType?: ArtifactType;
  content?: string;
  paperId?: string;
};

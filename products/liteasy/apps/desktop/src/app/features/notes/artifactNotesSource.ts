import type { AgentArtifactResult } from "../artifacts/artifact.types";
import {
  notesTargetKey,
  type NotesItem,
  type NotesTarget,
} from "./notes.types";

export function artifactAnnotationNotes(
  artifacts: AgentArtifactResult[],
): NotesItem[] {
  return artifacts.flatMap((artifact) =>
    (artifact.thinReadingDocument?.annotations ?? [])
      .filter((annotation) => annotation.body.trim())
      .map((annotation) => {
        const target: NotesTarget = {
          kind: "artifact-annotation",
          artifactId: artifact.artifactId,
          annotationId: annotation.id,
        };
        const node = artifact.thinReadingDocument?.nodes[annotation.nodeId];
        return {
          key: notesTargetKey(target),
          target,
          title: annotation.body.split("\n")[0].slice(0, 100),
          text: annotation.body,
          source: `${artifact.title}${node ? ` · ${node.title}` : ""}`,
          defaultFolderId: "default/artifact",
          updatedAt: annotation.updatedAt,
          editable: false,
          automaticallyListed: true,
          artifactId: artifact.artifactId,
          nodeId: annotation.nodeId,
        };
      }),
  );
}

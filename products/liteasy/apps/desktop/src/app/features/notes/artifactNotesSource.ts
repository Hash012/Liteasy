import { formatPaperAnchorText, paperAnchorFromEvidence } from "../paper-anchors/paperAnchorEntity";
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
        const paperAnchors = (node?.evidence?.paperEvidenceSpans ?? []).map((span) => paperAnchorFromEvidence({
          ...span, paperTitle: artifact.papers?.find((paper) => paper.id === span.paperId)?.title,
        }));
        return {
          key: notesTargetKey(target),
          target,
          title: formatPaperAnchorText(annotation.body.split("\n")[0].slice(0, 100), paperAnchors),
          text: annotation.body,
          source: `${artifact.title}${node ? ` · ${node.title}` : ""}`,
          defaultFolderId: "default/artifact",
          updatedAt: annotation.updatedAt,
          editable: false,
          automaticallyListed: true,
          paperAnchors,
          artifactId: artifact.artifactId,
          nodeId: annotation.nodeId,
        };
      }),
  );
}

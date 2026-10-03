export declare function desktopAnnotationPublicationPayload(operation: {
  annotationId: string; queueKey: string; revision: number; updatedAt: string; operation: "upsert" | "retract";
  body?: string; expectedAuthorProfileRevision?: number; literatureId?: string; sourcePassage?: unknown; remoteAnnotationId?: string;
}): string;

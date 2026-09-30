type ForumAnnotationPublicationOperationBase = {
  annotationId: string;
  queueKey: string;
  revision: number;
  updatedAt: string;
};

export type ForumAnnotationPublicationOperation =
  | (ForumAnnotationPublicationOperationBase & {
      body: string;
      literatureId: string;
      operation: "upsert";
      sourcePassage: {
        anchorHash: string;
        excerpt: string;
        page?: number;
        rects: Array<{ height: number; left: number; top: number; width: number }>;
      };
    })
  | (ForumAnnotationPublicationOperationBase & {
      operation: "retract";
      remoteAnnotationId: string;
    });

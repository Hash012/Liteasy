function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalJsonValue(value[key])]));
  }
  return value;
}

export function desktopAnnotationPublicationPayload(operation) {
  const normalized = {
    annotationId: operation.annotationId,
    operation: operation.operation,
    queueKey: operation.queueKey,
    revision: operation.revision,
    updatedAt: new Date(operation.updatedAt).toISOString(),
    ...(operation.operation === "upsert"
      ? {
          body: operation.body,
          ...(operation.expectedAuthorProfileRevision === undefined ? {} : { expectedAuthorProfileRevision: operation.expectedAuthorProfileRevision }),
          literatureId: operation.literatureId,
          sourcePassage: {
            anchorHash: operation.sourcePassage.anchorHash,
            excerpt: operation.sourcePassage.excerpt,
            ...(operation.sourcePassage.page ? { page: operation.sourcePassage.page } : {}),
            rects: operation.sourcePassage.rects ?? []
          }
        }
      : { remoteAnnotationId: operation.remoteAnnotationId })
  };
  return JSON.stringify(canonicalJsonValue(normalized));
}


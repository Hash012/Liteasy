export function desktopPublicationLookup(query, row) {
  const identity = { annotationId: query.annotationId, queueKey: query.queueKey };
  if (!row) return { ...identity, status: "not_found" };
  if (row.source_annotation_id !== query.annotationId || Number(row.source_revision) !== query.revision ||
      new Date(row.source_updated_at).getTime() !== Date.parse(query.updatedAt) || row.operation_digest !== query.operationDigest) {
    return { ...identity, status: "conflict" };
  }
  return { ...query, status: "matched", receipt: { ...identity, remoteAnnotationId: row.annotation_id,
    remoteRevision: Number(row.remote_revision), state: row.state, syncedAt: new Date(row.synced_at).toISOString() } };
}

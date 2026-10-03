const iso = (value) => value instanceof Date ? value.toISOString() : value ?? null;

export function platformAppealSummary(row) {
  const available = row.submitted_visibility === "public" && row.submitted_revision != null;
  return {
    annotationBody: available ? row.annotation_body : "",
    annotationId: row.annotation_id,
    appealId: row.id,
    authorName: available ? row.author_name : "",
    createdAt: iso(row.created_at),
    detailsAvailable: available,
    reason: available ? row.reason : "",
    resolutionReason: available ? row.resolution_reason ?? null : null,
    resolvedAt: iso(row.resolved_at),
    resolvedBy: available ? row.resolved_by ?? null : null,
    status: row.status,
    submittedBy: available ? row.submitted_by : "",
    submittedRevision: available ? Number(row.submitted_revision) : null,
    tag: row.tag_name
  };
}

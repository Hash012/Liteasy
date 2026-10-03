// Unknown historical provenance is quarantined in reads, not deleted from storage.
// Human labels and appeal/audit records retain their existing lifecycle.
export function scopedPlatformTags(tags, row) {
  return tags.filter((tag) => {
    if (tag.origin !== "platform") return true;
    if (row.visibility === "public" || tag.classifierVersion !== "local-semantic-scope-v2") return false;
    const scope = tag.sourceScope;
    return scope?.visibility === row.visibility && (scope.organizationId ?? null) === (row.organization_id ?? null) &&
      scope.authorId === (row.visibility === "organization" ? null : row.author_id);
  });
}

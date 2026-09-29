/** Optional bibliography may be absent in old caches; malformed values must not reach the inspector. */
export function hasReadableRecommendationMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  for (const key of ["abstract", "venue", "publishedAt", "canonicalId", "openAccessPdfUrl"]) {
    if (item[key] !== undefined && typeof item[key] !== "string") return false;
  }
  for (const key of ["authors", "subjects", "keywords"]) {
    if (item[key] !== undefined && (!Array.isArray(item[key]) || item[key].length > 200 || item[key].some((entry) => typeof entry !== "string"))) return false;
  }
  return item.publishedYear === undefined || Number.isInteger(item.publishedYear) && Number(item.publishedYear) >= 1000 && Number(item.publishedYear) <= 9999;
}

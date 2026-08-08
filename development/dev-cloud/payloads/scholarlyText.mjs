/**
 * Normalisation shared by everything that has to decide whether two records are the same work.
 *
 * It lives in one place because reference resolution matches printed bibliography strings
 * against candidate titles. If it normalised text even slightly differently from the retrieval
 * stack, the two would disagree about identity in ways no single test would catch.
 */

export function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalizeTitle(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();
}

export function sourceIdFromValue(value) {
  const rawId = normalizeText(value);
  const match = rawId.match(/(?:openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

export function sourceIdFromWork(work) {
  return sourceIdFromValue(work?.id);
}

const validSources = new Set(["discipline_catalog", "openalex_topic", "user_derived"]);
const validKinds = new Set(["category", "discipline", "topic"]);

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function buildConceptListQuery(searchParams) {
  const source = normalizeText(searchParams.get("source"));
  const conceptKind = normalizeText(searchParams.get("kind") || searchParams.get("conceptKind"));
  const parentId = normalizeText(searchParams.get("parentId") || searchParams.get("parent"));
  return {
    conceptKind: validKinds.has(conceptKind) ? conceptKind : undefined,
    parentId: parentId || undefined,
    source: validSources.has(source) ? source : undefined
  };
}

export function buildConceptListPayload(concepts) {
  return { concepts };
}

export function buildConceptPayload(concept) {
  if (!concept) {
    return { error: "concept_not_found" };
  }
  return { concept };
}

export function normalizeConceptCode(rawCode) {
  const code = normalizeText(rawCode);
  if (!code || code.length > 64 || !/^[A-Za-z0-9._-]+$/.test(code)) {
    return null;
  }
  return code;
}

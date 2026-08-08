function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function buildWorkIndexRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_work_index_request" };
  }
  const title = normalizeText(body.title);
  const abstract = normalizeText(body.abstract || body.abstractText);
  if (!title && !abstract) {
    return { error: "missing_index_text" };
  }
  return { value: { abstract: abstract || null, title: title || null } };
}

export function buildWorkIndexSnapshot(result) {
  return {
    tags: result.tags,
    workId: result.workId
  };
}

export function buildTagListQuery(searchParams) {
  const limit = Number(searchParams.get("limit"));
  const minOccurrence = Number(searchParams.get("minOccurrence") || searchParams.get("min"));
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    minOccurrence: Number.isFinite(minOccurrence) && minOccurrence >= 0 ? minOccurrence : undefined
  };
}

export function normalizeTagId(rawId) {
  const id = normalizeText(rawId);
  if (!id || id.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    return null;
  }
  return id;
}

export function buildTagPayload(tag) {
  if (!tag) {
    return { error: "tag_not_found" };
  }
  return { tag };
}

export function buildWorksForTagPayload(works) {
  return { works };
}

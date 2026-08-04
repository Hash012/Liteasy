import { createHash } from "node:crypto";

const externalKnowledgeCacheMaxAgeMs = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validateArtifactId(value) {
  const artifactId = normalizeText(value);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(artifactId)) {
    throw new Error("invalid_external_knowledge_artifact_id");
  }
  return artifactId;
}

function validateOwnerScope(value) {
  const ownerScope = normalizeText(value);
  if (!/^[A-Za-z0-9:._-]{1,180}$/.test(ownerScope)) {
    throw new Error("invalid_external_knowledge_owner_scope");
  }
  return ownerScope;
}

function normalizeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value;
  const kind = normalizeText(candidate.kind);
  const identityValue = normalizeText(candidate.value);
  return kind && identityValue ? { kind, value: identityValue } : undefined;
}

/**
 * The anchor's own local reference subset, reduced to what changes the result.
 *
 * It has to be part of the cache key: two anchors in one paper share query-adjacent text but
 * cite different works, and the whole point of the subset is that they get different results.
 * Leaving it out would serve the first anchor's answer to every later one — and would make the
 * measurement arms collide on a single entry, so the difference between them would be fiction.
 */
function normalizeAnchorReferences(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .filter((entry) => entry && typeof entry === "object" && Number.isInteger(entry.number))
    .map((entry) => [entry.number, normalizeText(entry.text)])
    .filter(([, text]) => text)
    .sort((left, right) => left[0] - right[0]);
  return entries.length > 0 ? entries : undefined;
}

function requestKey(input) {
  const canonical = JSON.stringify({
    anchorReferenceMode: normalizeText(input.anchorReferenceMode) || undefined,
    anchorReferences: normalizeAnchorReferences(input.anchorReferences),
    includeArxiv: input.includeArxiv !== false,
    query: normalizeText(input.query),
    targetPaperIdentity: normalizeIdentity(input.targetPaperIdentity),
    targetPaperTitle: normalizeText(input.targetPaperTitle)
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

function readPayload(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function publicRun(row, reused) {
  const serverNow = new Date();
  const cachedAt = Date.parse(row.completed_at ?? row.updated_at);
  return {
    attempts: row.attempts,
    expiresAt: new Date(
      (Number.isFinite(cachedAt) ? cachedAt : serverNow.getTime()) + externalKnowledgeCacheMaxAgeMs
    ).toISOString(),
    id: `${row.artifact_id}:${row.request_key}`,
    reused,
    serverNow: serverNow.toISOString(),
    status: row.status
  };
}

export function createExternalKnowledgeRunRepository(database) {
  const find = database.prepare(
    "SELECT * FROM external_knowledge_runs WHERE owner_scope = ? AND artifact_id = ? AND request_key = ?"
  );
  const insert = database.prepare(`
    INSERT INTO external_knowledge_runs (
      owner_scope, artifact_id, request_key, query, target_identity_kind, target_identity_value,
      target_paper_title, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `);
  const start = database.prepare(`
    UPDATE external_knowledge_runs
    SET attempts = attempts + 1, status = 'running', error_code = NULL, error_message = NULL, updated_at = ?
    WHERE owner_scope = ? AND artifact_id = ? AND request_key = ?
  `);
  const complete = database.prepare(`
    UPDATE external_knowledge_runs
    SET status = ?, payload_json = ?, error_code = NULL, error_message = NULL,
        updated_at = ?, completed_at = ?
    WHERE owner_scope = ? AND artifact_id = ? AND request_key = ?
  `);
  const fail = database.prepare(`
    UPDATE external_knowledge_runs
    SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
    WHERE owner_scope = ? AND artifact_id = ? AND request_key = ?
  `);

  function scope(input) {
    const ownerScope = validateOwnerScope(input.ownerScope ?? input.sessionId ?? "anonymous");
    const artifactId = validateArtifactId(input.artifactId);
    return { artifactId, key: requestKey(input), ownerScope };
  }

  return {
    begin(input) {
      const { artifactId, key, ownerScope } = scope(input);
      const now = new Date().toISOString();
      let row = find.get(ownerScope, artifactId, key);
      if (!row) {
        const identity = normalizeIdentity(input.targetPaperIdentity);
        insert.run(
          ownerScope,
          artifactId,
          key,
          normalizeText(input.query),
          identity?.kind ?? null,
          identity?.value ?? null,
          normalizeText(input.targetPaperTitle) || null,
          now,
          now
        );
        row = find.get(ownerScope, artifactId, key);
      }
      const cachedAt = Date.parse(row.completed_at ?? row.updated_at);
      const cacheFresh = Number.isFinite(cachedAt) && Date.now() - cachedAt <= externalKnowledgeCacheMaxAgeMs;
      const cachedPayload = cacheFresh && (row.status === "completed" || row.status === "skipped")
        ? readPayload(row.payload_json)
        : undefined;
      if (cachedPayload) {
        return { payload: cachedPayload, run: publicRun(row, true) };
      }
      start.run(now, ownerScope, artifactId, key);
      return { payload: undefined, run: publicRun(find.get(ownerScope, artifactId, key), false) };
    },

    complete(input, payload) {
      const { artifactId, key, ownerScope } = scope(input);
      const now = new Date().toISOString();
      const status = payload?.status === "empty" ? "skipped" : "completed";
      complete.run(status, JSON.stringify(payload), now, now, ownerScope, artifactId, key);
      const row = find.get(ownerScope, artifactId, key);
      return publicRun(row, false);
    },

    fail(input, error) {
      const { artifactId, key, ownerScope } = scope(input);
      const now = new Date().toISOString();
      const code = normalizeText(error?.code).slice(0, 80) || "external_knowledge_unavailable";
      const message = normalizeText(error?.message).slice(0, 500) || "外部知识检索不可用。";
      fail.run(code, message, now, ownerScope, artifactId, key);
      const row = find.get(ownerScope, artifactId, key);
      return publicRun(row, false);
    }
  };
}

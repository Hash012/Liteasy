import { createHash } from "node:crypto";

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

function normalizeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value;
  const kind = normalizeText(candidate.kind);
  const identityValue = normalizeText(candidate.value);
  return kind && identityValue ? { kind, value: identityValue } : undefined;
}

function requestKey(input) {
  const canonical = JSON.stringify({
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
  return {
    attempts: row.attempts,
    id: `${row.artifact_id}:${row.request_key}`,
    reused,
    status: row.status
  };
}

export function createExternalKnowledgeRunRepository(database) {
  const find = database.prepare(
    "SELECT * FROM external_knowledge_runs WHERE artifact_id = ? AND request_key = ?"
  );
  const insert = database.prepare(`
    INSERT INTO external_knowledge_runs (
      artifact_id, request_key, query, target_identity_kind, target_identity_value,
      target_paper_title, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `);
  const start = database.prepare(`
    UPDATE external_knowledge_runs
    SET attempts = attempts + 1, status = 'running', error_code = NULL, error_message = NULL, updated_at = ?
    WHERE artifact_id = ? AND request_key = ?
  `);
  const complete = database.prepare(`
    UPDATE external_knowledge_runs
    SET status = ?, payload_json = ?, error_code = NULL, error_message = NULL,
        updated_at = ?, completed_at = ?
    WHERE artifact_id = ? AND request_key = ?
  `);
  const fail = database.prepare(`
    UPDATE external_knowledge_runs
    SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
    WHERE artifact_id = ? AND request_key = ?
  `);

  function scope(input) {
    const artifactId = validateArtifactId(input.artifactId);
    return { artifactId, key: requestKey(input) };
  }

  return {
    begin(input) {
      const { artifactId, key } = scope(input);
      const now = new Date().toISOString();
      let row = find.get(artifactId, key);
      if (!row) {
        const identity = normalizeIdentity(input.targetPaperIdentity);
        insert.run(
          artifactId,
          key,
          normalizeText(input.query),
          identity?.kind ?? null,
          identity?.value ?? null,
          normalizeText(input.targetPaperTitle) || null,
          now,
          now
        );
        row = find.get(artifactId, key);
      }
      const cachedPayload = row.status === "completed" || row.status === "skipped"
        ? readPayload(row.payload_json)
        : undefined;
      if (cachedPayload) {
        return { payload: cachedPayload, run: publicRun(row, true) };
      }
      start.run(now, artifactId, key);
      return { payload: undefined, run: publicRun(find.get(artifactId, key), false) };
    },

    complete(input, payload) {
      const { artifactId, key } = scope(input);
      const now = new Date().toISOString();
      const status = payload?.status === "empty" ? "skipped" : "completed";
      complete.run(status, JSON.stringify(payload), now, now, artifactId, key);
      const row = find.get(artifactId, key);
      return publicRun(row, false);
    },

    fail(input, error) {
      const { artifactId, key } = scope(input);
      const now = new Date().toISOString();
      const code = normalizeText(error?.code).slice(0, 80) || "external_knowledge_unavailable";
      const message = normalizeText(error?.message).slice(0, 500) || "外部知识检索不可用。";
      fail.run(code, message, now, artifactId, key);
      const row = find.get(artifactId, key);
      return publicRun(row, false);
    }
  };
}

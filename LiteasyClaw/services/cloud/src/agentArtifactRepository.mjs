import { randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const artifactTypes = new Set(["comparison_table", "layered_graph", "mindmap", "ppt", "thin_reading", "tree"]);

function text(value, maximum, code) {
  if (typeof value !== "string") throw new LibraryRepositoryError(code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum) throw new LibraryRepositoryError(code);
  return normalized;
}

function artifactId(value) {
  const normalized = text(value, 120, "agent_artifact_id_invalid");
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new LibraryRepositoryError("agent_artifact_id_invalid");
  }
  return normalized;
}

function artifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryRepositoryError("agent_artifact_invalid");
  }
  const normalized = {
    ...value,
    artifactId: artifactId(value.artifactId),
    title: text(value.title, 160, "agent_artifact_title_invalid")
  };
  if (
    value.version !== "liteasy.agent-artifact/v1" ||
    !artifactTypes.has(value.artifactType) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !value.agent ||
    typeof value.agent !== "object" ||
    typeof value.agent.runId !== "string" ||
    value.agent.runId.length > 300 ||
    value.agent.status !== "completed"
  ) {
    throw new LibraryRepositoryError("agent_artifact_invalid");
  }
  if (Buffer.byteLength(JSON.stringify(normalized)) > 12 * 1024 * 1024) {
    throw new LibraryRepositoryError("agent_artifact_too_large", 413);
  }
  return normalized;
}

function subject(value) {
  return text(value, 300, "identity_subject_invalid");
}

function locator(id) {
  return `liteasy://agent-artifacts/${encodeURIComponent(id)}`;
}

async function appendAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type,
      resource_id, scope_type, scope_id, trace_id, detail
    ) VALUES ($1, $2, 'liteasy-desktop', $3, 'agent_artifact', $4,
      'user', $2, $5, $6::jsonb)
  `, [
    `audit_${randomUUID()}`,
    input.subjectId,
    input.action,
    input.artifactId,
    input.traceId,
    JSON.stringify({ revision: input.revision })
  ]);
}

export class PostgresAgentArtifactRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(subjectInput) {
    const subjectId = subject(subjectInput);
    const result = await this.pool.query(`
      SELECT body FROM agent_artifacts
       WHERE subject_id = $1
       ORDER BY updated_at DESC, artifact_id
    `, [subjectId]);
    return { artifacts: result.rows.map((row) => artifact(row.body)) };
  }

  async save(subjectInput, input, traceId) {
    const subjectId = subject(subjectInput);
    const body = artifact(input);
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        INSERT INTO agent_artifacts(
          subject_id, artifact_id, artifact_type, title, body, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
        ON CONFLICT (subject_id, artifact_id) DO UPDATE SET
          artifact_type = excluded.artifact_type,
          title = excluded.title,
          body = excluded.body,
          revision = agent_artifacts.revision + 1,
          updated_at = now()
        RETURNING revision
      `, [
        subjectId,
        body.artifactId,
        body.artifactType,
        body.title,
        JSON.stringify(body),
        body.createdAt
      ]);
      const revision = Number(result.rows[0].revision);
      await appendAudit(client, {
        action: "save_agent_artifact",
        artifactId: body.artifactId,
        revision,
        subjectId,
        traceId
      });
      return { artifact: body, path: locator(body.artifactId), revision };
    });
  }

  async rename(subjectInput, artifactIdInput, titleInput, traceId) {
    const subjectId = subject(subjectInput);
    const id = artifactId(artifactIdInput);
    const title = text(titleInput, 160, "agent_artifact_title_invalid");
    return withPostgresTransaction(this.pool, async (client) => {
      const current = await client.query(`
        SELECT body FROM agent_artifacts
         WHERE subject_id = $1 AND artifact_id = $2 FOR UPDATE
      `, [subjectId, id]);
      if (!current.rows[0]) throw new LibraryRepositoryError("agent_artifact_not_found", 404);
      const body = artifact({ ...current.rows[0].body, title });
      const result = await client.query(`
        UPDATE agent_artifacts
           SET title = $3, body = $4::jsonb, revision = revision + 1, updated_at = now()
         WHERE subject_id = $1 AND artifact_id = $2
         RETURNING revision
      `, [subjectId, id, title, JSON.stringify(body)]);
      const revision = Number(result.rows[0].revision);
      await appendAudit(client, {
        action: "rename_agent_artifact",
        artifactId: id,
        revision,
        subjectId,
        traceId
      });
      return { artifact: body, path: locator(id), revision };
    });
  }

  async remove(subjectInput, artifactIdInput, traceId) {
    const subjectId = subject(subjectInput);
    const id = artifactId(artifactIdInput);
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        DELETE FROM agent_artifacts
         WHERE subject_id = $1 AND artifact_id = $2
         RETURNING revision
      `, [subjectId, id]);
      if (!result.rows[0]) throw new LibraryRepositoryError("agent_artifact_not_found", 404);
      const revision = Number(result.rows[0].revision);
      await appendAudit(client, {
        action: "delete_agent_artifact",
        artifactId: id,
        revision,
        subjectId,
        traceId
      });
      return { artifactId: id, deleted: true, path: locator(id) };
    });
  }
}

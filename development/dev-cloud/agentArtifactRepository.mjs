import { createHash } from "node:crypto";

const artifactVersion = "liteasy.agent-artifact/v1";
const artifactTypes = new Set(["comparison_table", "layered_graph", "mindmap", "ppt", "thin_reading", "tree"]);

function validateArtifactId(artifactId) {
  if (typeof artifactId !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(artifactId)) {
    throw new Error("invalid_agent_artifact_id");
  }
  return artifactId;
}

function validateOwnerId(ownerUserId) {
  if (typeof ownerUserId !== "string" || !ownerUserId.trim() || ownerUserId.length > 300) {
    throw new Error("invalid_agent_artifact_owner");
  }
  return ownerUserId;
}

function validateArtifact(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("invalid_agent_artifact");
  }
  if (
    document.version !== artifactVersion ||
    typeof document.artifactId !== "string" ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(document.artifactId) ||
    !artifactTypes.has(document.artifactType) ||
    typeof document.createdAt !== "string" ||
    !Number.isFinite(Date.parse(document.createdAt)) ||
    typeof document.title !== "string" ||
    !document.agent ||
    typeof document.agent !== "object" ||
    typeof document.agent.runId !== "string" ||
    document.agent.runId.length > 300 ||
    document.agent.status !== "completed"
  ) {
    throw new Error("invalid_agent_artifact");
  }
  return document;
}

function validateTitle(title) {
  if (typeof title !== "string") throw new Error("invalid_agent_artifact_title");
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 160) throw new Error("invalid_agent_artifact_title");
  return normalized;
}

function internalId(prefix, ownerUserId, clientId) {
  const digest = createHash("sha256")
    .update(validateOwnerId(ownerUserId))
    .update("\0")
    .update(clientId)
    .digest("hex");
  return `${prefix}_${digest}`;
}

function parseDocument(row) {
  if (!row) return null;
  return validateArtifact(JSON.parse(row.content_json));
}

function artifactLocator(artifactId) {
  return `liteasy://agent-artifacts/${encodeURIComponent(artifactId)}`;
}

export function createAgentArtifactRepository(database) {
  if (!database?.prepare || !database?.transaction) {
    throw new Error("agent_artifact_database_required");
  }

  const loadCurrent = database.prepare(`
    SELECT artifact.id, artifact.current_version, version.content_json
      FROM artifacts artifact
      JOIN artifact_versions version
        ON version.artifact_id = artifact.id AND version.version = artifact.current_version
     WHERE artifact.id = ? AND artifact.owner_user_id = ? AND artifact.deleted_at IS NULL
  `);
  const listCurrent = database.prepare(`
    SELECT version.content_json
      FROM artifacts artifact
      JOIN artifact_versions version
        ON version.artifact_id = artifact.id AND version.version = artifact.current_version
     WHERE artifact.owner_user_id = ? AND artifact.deleted_at IS NULL
     ORDER BY artifact.updated_at DESC, artifact.id
  `);

  const saveTransaction = database.transaction((ownerUserId, rawDocument) => {
    const owner = validateOwnerId(ownerUserId);
    const document = validateArtifact(rawDocument);
    const artifactId = internalId("artifact", owner, document.artifactId);
    const current = loadCurrent.get(artifactId, owner);
    const nextVersion = current ? current.current_version + 1 : 1;
    const now = new Date().toISOString();
    const contentJson = JSON.stringify(document);
    const contentHash = createHash("sha256").update(contentJson).digest("hex");

    if (current) {
      database.prepare(`
        UPDATE artifacts
           SET artifact_type = ?, title = ?, status = 'ready', current_version = ?,
               metadata_json = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ?
      `).run(
        document.artifactType,
        document.title,
        nextVersion,
        JSON.stringify({ clientArtifactId: document.artifactId }),
        now,
        artifactId,
        owner
      );
    } else {
      database.prepare(`
        INSERT INTO artifacts (
          id, owner_user_id, artifact_type, title, status, current_version,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ready', 1, ?, ?, ?)
      `).run(
        artifactId,
        owner,
        document.artifactType,
        document.title,
        JSON.stringify({ clientArtifactId: document.artifactId }),
        document.createdAt,
        now
      );
    }

    database.prepare(`
      INSERT INTO artifact_versions (
        id, artifact_id, version, source_kind, content_json,
        content_hash, created_by_user_id, created_at
      ) VALUES (?, ?, ?, 'ai', ?, ?, ?, ?)
    `).run(
      `${artifactId}:v${nextVersion}`,
      artifactId,
      nextVersion,
      contentJson,
      contentHash,
      owner,
      now
    );

    const runId = internalId("run", owner, document.agent.runId);
    database.prepare(`
      INSERT INTO generation_runs (
        id, owner_user_id, output_artifact_id, status, input_json,
        metadata_json, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, 'succeeded', '{}', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        output_artifact_id = excluded.output_artifact_id,
        status = 'succeeded',
        metadata_json = excluded.metadata_json,
        completed_at = excluded.completed_at
    `).run(
      runId,
      owner,
      artifactId,
      JSON.stringify({ agent: document.agent, clientRunId: document.agent.runId }),
      document.createdAt,
      document.createdAt,
      now
    );

    return { artifact: document, path: artifactLocator(document.artifactId) };
  });

  const renameTransaction = database.transaction((ownerUserId, clientArtifactId, rawTitle) => {
    const owner = validateOwnerId(ownerUserId);
    const artifactIdValue = validateArtifactId(clientArtifactId);
    const artifactId = internalId("artifact", owner, artifactIdValue);
    const current = loadCurrent.get(artifactId, owner);
    if (!current) return null;
    const document = parseDocument(current);
    return saveTransaction(owner, { ...document, title: validateTitle(rawTitle) });
  });

  const removeTransaction = database.transaction((ownerUserId, clientArtifactId) => {
    const owner = validateOwnerId(ownerUserId);
    const artifactIdValue = validateArtifactId(clientArtifactId);
    const artifactId = internalId("artifact", owner, artifactIdValue);
    const removed = database.prepare(
      "DELETE FROM artifacts WHERE id = ? AND owner_user_id = ?"
    ).run(artifactId, owner);
    if (removed.changes === 0) return null;
    return {
      artifactId: artifactIdValue,
      deleted: true,
      path: artifactLocator(artifactIdValue)
    };
  });

  const purgeOwnerTransaction = database.transaction((ownerUserId) => {
    const owner = validateOwnerId(ownerUserId);
    const artifacts = database.prepare("DELETE FROM artifacts WHERE owner_user_id = ?").run(owner);
    const runs = database.prepare("DELETE FROM generation_runs WHERE owner_user_id = ?").run(owner);
    return { artifacts: artifacts.changes, generationRuns: runs.changes };
  });

  return {
    list(ownerUserId) {
      return listCurrent.all(validateOwnerId(ownerUserId)).map(parseDocument);
    },
    purgeOwner(ownerUserId) {
      return purgeOwnerTransaction(ownerUserId);
    },
    remove(ownerUserId, artifactId) {
      return removeTransaction(ownerUserId, artifactId);
    },
    rename(ownerUserId, artifactId, title) {
      return renameTransaction(ownerUserId, artifactId, title);
    },
    save(ownerUserId, document) {
      return saveTransaction(ownerUserId, document);
    }
  };
}

export { artifactVersion };

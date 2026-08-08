import { createHash, randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

function requiredId(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new LibraryRepositoryError(code);
  }
  return value;
}

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LibraryRepositoryError("annotation_revision_invalid");
  }
  return value;
}

function annotationBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryRepositoryError("annotation_body_invalid");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
    throw new LibraryRepositoryError("annotation_body_too_large", 413);
  }
  const allowed = new Set([
    "clientAnnotationId", "color", "excerpt", "kind", "note", "page", "rects", "text", "updatedAt"
  ]);
  const colors = new Set(["yellow", "red", "blue", "green", "pink"]);
  const kinds = new Set(["highlight", "underline", "note"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.clientAnnotationId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(value.clientAnnotationId) ||
    typeof value.excerpt !== "string" || value.excerpt.trim().length < 1 || value.excerpt.length > 5000 ||
    !kinds.has(value.kind) ||
    !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 1_000_000 ||
    !Array.isArray(value.rects) || value.rects.length > 100 ||
    typeof value.text !== "string" || value.text.trim().length < 1 || value.text.length > 100 ||
    typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 10_000)) ||
    (value.color !== undefined && !colors.has(value.color)) ||
    (value.kind === "highlight" && !colors.has(value.color))) {
    throw new LibraryRepositoryError("annotation_body_invalid");
  }
  const rects = value.rects.map((rect) => {
    if (!rect || typeof rect !== "object" || Array.isArray(rect)) {
      throw new LibraryRepositoryError("annotation_body_invalid");
    }
    const keys = Object.keys(rect);
    if (keys.some((key) => !new Set(["height", "left", "top", "width"]).has(key))) {
      throw new LibraryRepositoryError("annotation_body_invalid");
    }
    for (const key of ["height", "left", "top", "width"]) {
      if (typeof rect[key] !== "number" || !Number.isFinite(rect[key]) || rect[key] < 0 || rect[key] > 1) {
        throw new LibraryRepositoryError("annotation_body_invalid");
      }
    }
    if (rect.height === 0 || rect.width === 0) throw new LibraryRepositoryError("annotation_body_invalid");
    return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
  });
  return {
    clientAnnotationId: value.clientAnnotationId,
    ...(value.color === undefined ? {} : { color: value.color }),
    excerpt: value.excerpt.trim(),
    kind: value.kind,
    ...(value.note === undefined ? {} : { note: value.note }),
    page: value.page,
    rects,
    text: value.text.trim(),
    updatedAt: new Date(value.updatedAt).toISOString()
  };
}

function mapAnnotation(row) {
  return {
    annotationId: row.annotation_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    documentId: row.document_id,
    organizationId: row.organization_id,
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
    uploadedBy: row.uploaded_by
  };
}

function assertOrganizationScope(scope) {
  if (scope?.scopeType !== "organization" || !scope.scopeId || !scope.actorId || !scope.role) {
    throw new LibraryRepositoryError("library_scope_invalid");
  }
}

function canModerate(scope) {
  return scope.role === "owner" || scope.role === "admin";
}

async function idempotentMutation(client, scope, input, operation, requestBody, mutate) {
  const key = operationKey(input.idempotencyKey);
  const requestHash = createHash("sha256").update(JSON.stringify(requestBody)).digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${scope.actorId}:${operation}:${key}`
  ]);
  const prior = await client.query(`
    SELECT request_hash, response_body FROM idempotency_records
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
  `, [scope.actorId, operation, key]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      throw new LibraryRepositoryError("idempotency_key_reused", 409);
    }
    return prior.rows[0].response_body;
  }
  const response = await mutate();
  await client.query(`
    INSERT INTO idempotency_records(
      actor_id, operation, idempotency_key, request_hash, response_status,
      response_body, expires_at
    ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
  `, [scope.actorId, operation, key, requestHash, JSON.stringify(response)]);
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      scope_type, scope_id, trace_id, detail
    ) VALUES ($1, $2, 'liteasy-desktop', $3, 'team_annotation', $4,
      'organization', $5, $6, $7::jsonb)
  `, [
    `audit_${randomUUID()}`, scope.actorId, operation, response.annotationId,
    scope.scopeId, input.traceId, JSON.stringify({ documentId: response.documentId })
  ]);
  return response;
}

export class PostgresTeamAnnotationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(scope, input) {
    assertOrganizationScope(scope);
    const documentId = requiredId(input.documentId, "library_document_invalid");
    const result = await this.pool.query(`
      SELECT annotation.*
        FROM team_annotations annotation
        JOIN library_entries entry ON entry.document_id = annotation.document_id
       WHERE annotation.organization_id = $1 AND annotation.document_id = $2
         AND entry.scope_type = 'organization' AND entry.scope_id = $1
         AND entry.status = 'active'
       ORDER BY annotation.created_at, annotation.annotation_id
    `, [scope.scopeId, documentId]);
    return { annotations: result.rows.map(mapAnnotation) };
  }

  async create(scope, input) {
    assertOrganizationScope(scope);
    const documentId = requiredId(input.documentId, "library_document_invalid");
    const body = annotationBody(input.body);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      scope,
      input,
      "create_team_annotation",
      { body, documentId, organizationId: scope.scopeId },
      async () => {
        const document = await client.query(`
          SELECT 1 FROM library_entries
           WHERE document_id = $1 AND scope_type = 'organization' AND scope_id = $2 AND status = 'active'
        `, [documentId, scope.scopeId]);
        if (!document.rows[0]) throw new LibraryRepositoryError("library_document_not_found", 404);
        const annotationId = `annotation_${randomUUID()}`;
        const result = await client.query(`
          INSERT INTO team_annotations(annotation_id, organization_id, document_id, uploaded_by, body)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          RETURNING *
        `, [annotationId, scope.scopeId, documentId, scope.actorId, JSON.stringify(body)]);
        return mapAnnotation(result.rows[0]);
      }
    ));
  }

  async update(scope, input) {
    assertOrganizationScope(scope);
    const annotationId = requiredId(input.annotationId, "annotation_id_invalid");
    const body = annotationBody(input.body);
    const revision = expectedRevision(input.expectedRevision);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      scope,
      input,
      "update_team_annotation",
      { annotationId, body, organizationId: scope.scopeId, revision },
      async () => {
        const current = await client.query(`
          SELECT * FROM team_annotations
           WHERE annotation_id = $1 AND organization_id = $2 FOR UPDATE
        `, [annotationId, scope.scopeId]);
        if (!current.rows[0]) throw new LibraryRepositoryError("annotation_not_found", 404);
        if (current.rows[0].uploaded_by !== scope.actorId) {
          throw new LibraryRepositoryError("annotation_author_required", 403);
        }
        const result = await client.query(`
          UPDATE team_annotations
             SET body = $3::jsonb, revision = revision + 1, updated_at = now()
           WHERE annotation_id = $1 AND organization_id = $2 AND revision = $4
           RETURNING *
        `, [annotationId, scope.scopeId, JSON.stringify(body), revision]);
        if (!result.rows[0]) throw new LibraryRepositoryError("annotation_revision_conflict", 409);
        return mapAnnotation(result.rows[0]);
      }
    ));
  }

  async remove(scope, input) {
    assertOrganizationScope(scope);
    const annotationId = requiredId(input.annotationId, "annotation_id_invalid");
    const revision = expectedRevision(input.expectedRevision);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      scope,
      input,
      "delete_team_annotation",
      { annotationId, organizationId: scope.scopeId, revision },
      async () => {
        const current = await client.query(`
          SELECT * FROM team_annotations
           WHERE annotation_id = $1 AND organization_id = $2 FOR UPDATE
        `, [annotationId, scope.scopeId]);
        if (!current.rows[0]) throw new LibraryRepositoryError("annotation_not_found", 404);
        if (current.rows[0].uploaded_by !== scope.actorId && !canModerate(scope)) {
          throw new LibraryRepositoryError("annotation_delete_forbidden", 403);
        }
        const result = await client.query(`
          DELETE FROM team_annotations
           WHERE annotation_id = $1 AND organization_id = $2 AND revision = $3
           RETURNING *
        `, [annotationId, scope.scopeId, revision]);
        if (!result.rows[0]) throw new LibraryRepositoryError("annotation_revision_conflict", 409);
        return { ...mapAnnotation(result.rows[0]), deleted: true };
      }
    ));
  }
}

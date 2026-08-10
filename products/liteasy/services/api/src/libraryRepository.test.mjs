import assert from "node:assert/strict";
import test from "node:test";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";

const confirmedLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/liteasy" }],
  literatureId: "lit_01J00000000000000000000000",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
  revision: 3,
  status: "confirmed",
  title: "Cloud Literature Metadata",
  year: 2026
};

function postgresHarness(entryKind) {
  const queries = [];
  const state = {
    metadata: { retained: true },
    revision: 1
  };
  const row = () => ({
    byte_length: entryKind === "pdf" ? "128" : null,
    content_hash: entryKind === "pdf" ? "a".repeat(64) : null,
    created_at: new Date("2026-08-09T00:00:00.000Z"),
    created_by: "user-1",
    document_id: "document-1",
    entry_kind: entryKind,
    file_name: entryKind === "pdf" ? "Paper.pdf" : "Paper",
    folder_id: null,
    metadata: state.metadata,
    normalized_name: "paper.pdf",
    purge_after: null,
    scope_id: "user-1",
    scope_type: "user",
    status: "active",
    title: "Paper",
    trashed_at: null,
    updated_at: new Date("2026-08-09T00:00:00.000Z")
  });
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT request_hash, response_status, response_body/.test(sql)) return { rows: [] };
      if (/SELECT revision FROM library_scope_revisions/.test(sql)) {
        return { rows: [{ revision: String(state.revision) }] };
      }
      if (/SELECT entry\.\*, reference\.content_hash/.test(sql)) return { rows: [row()] };
      if (/SELECT snapshot = \$3::jsonb AS matches/.test(sql)) return { rows: [{ matches: true }] };
      if (/jsonb_set\(metadata, '\{literature\}'/.test(sql)) {
        state.metadata = { ...state.metadata, literature: JSON.parse(values.at(-1)) };
        return { rows: [] };
      }
      if (/UPDATE library_scope_revisions/.test(sql)) {
        state.revision += 1;
        return { rows: [{ revision: String(state.revision) }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    state
  };
}

for (const entryKind of ["pdf", "metadata_only"]) {
  test(`persists canonical literature for a ${entryKind} entry in the versioned mutation`, async () => {
    const harness = postgresHarness(entryKind);
    const verifiedReferences = [];
    const repository = new PostgresLibraryRepository(harness.pool, {
      literatureProjectionVerifier: {
        async verifyProjection(reference) {
          verifiedReferences.push(reference);
          return confirmedLiterature;
        }
      }
    });

    const updated = await repository.updateEntry(
      { scopeId: "user-1", scopeType: "user" },
      {
        actorId: "user-1",
        documentId: "document-1",
        expectedRevision: 1,
        idempotencyKey: `literature-${entryKind}`,
        literature: {
          authors: ["Desktop Spoof"],
          literatureId: confirmedLiterature.literatureId,
          revision: confirmedLiterature.revision,
          title: "Caller-controlled title must be ignored"
        }
      }
    );

    assert.deepEqual(verifiedReferences, [{ literatureId: confirmedLiterature.literatureId, revision: 3 }]);
    assert.deepEqual(updated.document.metadata.literature, confirmedLiterature);
    assert.equal(updated.revision, 2);
    assert.equal(harness.state.revision, 2);
    assert.equal(harness.queries.some(({ sql }) => /jsonb_set\(metadata, '\{literature\}'/.test(sql)), true);
    assert.equal(harness.queries.some(({ sql }) => /INSERT INTO idempotency_records/.test(sql)), true);
    const audit = harness.queries.find(({ sql }) => /INSERT INTO audit_events/.test(sql));
    assert.deepEqual(JSON.parse(audit.values.at(-1)), {
      documentId: "document-1",
      operation: "update_library_entry"
    });
  });
}

test("invalid literature fails before PostgreSQL revision or mutation work begins", async () => {
  let connections = 0;
  const repository = new PostgresLibraryRepository({
    async connect() {
      connections += 1;
      throw new Error("must not connect");
    }
  }, { literatureProjectionVerifier: { verifyProjection: async () => confirmedLiterature } });

  await assert.rejects(() => repository.updateEntry(
    { scopeId: "user-1", scopeType: "user" },
    {
      actorId: "user-1",
      documentId: "document-1",
      expectedRevision: 1,
      idempotencyKey: "literature-invalid",
      literature: { literatureId: confirmedLiterature.literatureId, revision: 0 }
    }
  ), /literature_metadata_invalid/);
  assert.equal(connections, 0);
});

test("rejects stale or unconfirmed literature before PostgreSQL mutation work begins", async () => {
  let connections = 0;
  const repository = new PostgresLibraryRepository({
    async connect() {
      connections += 1;
      throw new Error("must not connect");
    }
  }, {
    literatureProjectionVerifier: {
      async verifyProjection() {
        const error = new Error("literature_projection_not_confirmed");
        error.code = "literature_projection_not_confirmed";
        error.status = 409;
        throw error;
      }
    }
  });

  await assert.rejects(() => repository.updateEntry(
    { scopeId: "user-1", scopeType: "user" },
    {
      actorId: "user-1",
      documentId: "document-1",
      expectedRevision: 1,
      idempotencyKey: "literature-stale",
      literature: { literatureId: confirmedLiterature.literatureId, revision: 2 }
    }
  ), /literature_projection_not_confirmed/);
  assert.equal(connections, 0);
});

test("rejects a client-supplied literature snapshot in metadata-only creation", async () => {
  let connections = 0;
  const repository = new PostgresLibraryRepository({
    async connect() {
      connections += 1;
      throw new Error("must not connect");
    }
  });

  await assert.rejects(() => repository.createMetadataEntry(
    { scopeId: "user-1", scopeType: "user" },
    {
      actorId: "user-1",
      expectedRevision: 0,
      idempotencyKey: "metadata-literature-spoof",
      metadata: { literature: confirmedLiterature },
      title: "Spoofed literature"
    }
  ), /literature_projection_verification_required/);
  assert.equal(connections, 0);
});

function transactionPool(query) {
  const client = {
    async query(sql, values = []) {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      return query(sql, values);
    },
    release() {}
  };
  return { async connect() { return client; } };
}

test("rechecks organization upload permission after staging and before database preparation", async () => {
  let reachedStorageMutation = false;
  const repository = new PostgresLibraryRepository(transactionPool(async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM storage_publish_workflows")) return { rows: [] };
    if (sql.includes("FROM organizations")) {
      return { rows: [{ organization_status: "active", owner_subject: "owner_1" }] };
    }
    if (sql.includes("FROM organization_members")) {
      return { rows: [{ member_role: "member", member_status: "active" }] };
    }
    if (sql.includes("FROM organization_storage_policies")) {
      return { rows: [{ export_policy: "disabled", upload_policy: "owner_admins" }] };
    }
    if (sql.includes("INSERT INTO library_scope_revisions")) return { rows: [] };
    if (sql.includes("SELECT revision FROM library_scope_revisions")) return { rows: [{ revision: "0" }] };
    if (sql.includes("SELECT limit_bytes FROM storage_quotas")) return { rows: [{ limit_bytes: "1024" }] };
    if (sql.includes("SUM(logical_bytes)")) return { rows: [{ used_bytes: "0" }] };
    if (sql.includes("FROM storage_objects")) return { rows: [] };
    if (sql.includes("INSERT INTO storage_objects")) {
      reachedStorageMutation = true;
      throw new Error("storage mutation reached without commit authorization");
    }
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(
    () => repository.preparePdfUpload(
      { scopeId: "org_1", scopeType: "organization" },
      {
        actorId: "user_1",
        expectedRevision: 0,
        fileName: "Paper.pdf",
        finalKey: `documents/objects/aa/${"a".repeat(64)}`,
        idempotencyKey: "upload-recheck-0001",
        traceId: "trace_upload_recheck"
      },
      {
        byteLength: 12,
        contentHash: "a".repeat(64),
        securityScan: {
          contentHash: "a".repeat(64),
          scannedAt: "2026-08-11T00:00:00.000Z",
          scanner: "clamav",
          version: "1.4.3"
        },
        storageKey: "documents/.staging/upload-recheck"
      }
    ),
    (error) => error.code === "organization_upload_forbidden"
  );
  assert.equal(reachedStorageMutation, false);
});

test("rechecks source export permission before a cross-scope copy mutation", async () => {
  let reachedSourceLookup = false;
  const repository = new PostgresLibraryRepository(transactionPool(async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("INSERT INTO library_scope_revisions")) return { rows: [] };
    if (sql.includes("SELECT revision FROM library_scope_revisions")) return { rows: [{ revision: "0" }] };
    if (sql.includes("FROM organizations")) {
      return { rows: [{ organization_status: "active", owner_subject: "owner_1" }] };
    }
    if (sql.includes("FROM organization_members")) {
      return { rows: [{ member_role: "member", member_status: "active" }] };
    }
    if (sql.includes("FROM organization_storage_policies")) {
      return { rows: [{ export_policy: "disabled", upload_policy: "all_members" }] };
    }
    if (sql.includes("SELECT entry.*")) {
      reachedSourceLookup = true;
      throw new Error("source lookup reached without commit authorization");
    }
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(
    () => repository.copyEntry(
      { scopeId: "org_source", scopeType: "organization" },
      { scopeId: "user_1", scopeType: "user" },
      {
        actorId: "user_1",
        documentId: "document_1",
        expectedRevision: 0,
        idempotencyKey: "copy-recheck-0001",
        traceId: "trace_copy_recheck"
      }
    ),
    (error) => error.code === "organization_export_forbidden"
  );
  assert.equal(reachedSourceLookup, false);
});

function trashedFolderRow() {
  return {
    created_at: new Date("2026-08-11T00:00:00.000Z"),
    created_by: "user_1",
    folder_id: "folder_trashed",
    name: "Archived",
    normalized_name: "archived",
    parent_folder_id: null,
    purge_after: new Date("2026-09-10T00:00:00.000Z"),
    scope_id: "user_1",
    scope_type: "user",
    status: "trashed",
    trashed_at: new Date("2026-08-11T00:00:00.000Z"),
    updated_at: new Date("2026-08-11T00:00:00.000Z")
  };
}

function trashedParentPool(onUnexpectedMutation) {
  return transactionPool(async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("INSERT INTO library_scope_revisions")) return { rows: [] };
    if (sql.includes("SELECT revision FROM library_scope_revisions")) return { rows: [{ revision: "0" }] };
    if (sql.includes("SELECT * FROM library_folders")) return { rows: [trashedFolderRow()] };
    if (sql.includes("INSERT INTO library_folders") || sql.includes("INSERT INTO library_entries")) {
      onUnexpectedMutation();
      throw new Error("active node inserted below trashed parent");
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

test("rejects new active folders and metadata entries below a trashed parent", async () => {
  for (const operation of [
    (repository) => repository.createFolder(
      { scopeId: "user_1", scopeType: "user" },
      {
        actorId: "user_1",
        expectedRevision: 0,
        idempotencyKey: "folder-parent-trashed",
        name: "Child",
        parentFolderId: "folder_trashed",
        traceId: "trace_folder_parent"
      }
    ),
    (repository) => repository.createMetadataEntry(
      { scopeId: "user_1", scopeType: "user" },
      {
        actorId: "user_1",
        expectedRevision: 0,
        folderId: "folder_trashed",
        idempotencyKey: "metadata-parent-trashed",
        title: "Child paper",
        traceId: "trace_metadata_parent"
      }
    )
  ]) {
    let reachedMutation = false;
    const repository = new PostgresLibraryRepository(trashedParentPool(() => {
      reachedMutation = true;
    }));
    await assert.rejects(operation(repository), (error) => error.code === "library_folder_trashed");
    assert.equal(reachedMutation, false);
  }
});

test("rejects a PDF upload targeted at a trashed folder", async () => {
  let reachedStorageMutation = false;
  const repository = new PostgresLibraryRepository(transactionPool(async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM storage_publish_workflows")) return { rows: [] };
    if (sql.includes("INSERT INTO library_scope_revisions")) return { rows: [] };
    if (sql.includes("SELECT revision FROM library_scope_revisions")) return { rows: [{ revision: "0" }] };
    if (sql.includes("SELECT * FROM library_folders")) return { rows: [trashedFolderRow()] };
    if (sql.includes("SELECT limit_bytes FROM storage_quotas")) return { rows: [{ limit_bytes: "1024" }] };
    if (sql.includes("SUM(logical_bytes)")) return { rows: [{ used_bytes: "0" }] };
    if (sql.includes("FROM storage_objects")) return { rows: [] };
    if (sql.includes("INSERT INTO storage_objects")) {
      reachedStorageMutation = true;
      throw new Error("storage mutation reached below trashed parent");
    }
    throw new Error(`unexpected query: ${sql}`);
  }));

  await assert.rejects(
    () => repository.preparePdfUpload(
      { scopeId: "user_1", scopeType: "user" },
      {
        actorId: "user_1",
        expectedRevision: 0,
        fileName: "Paper.pdf",
        finalKey: `documents/objects/aa/${"a".repeat(64)}`,
        folderId: "folder_trashed",
        idempotencyKey: "upload-parent-trashed",
        traceId: "trace_upload_parent"
      },
      {
        byteLength: 12,
        contentHash: "a".repeat(64),
        securityScan: {
          contentHash: "a".repeat(64),
          scannedAt: "2026-08-11T00:00:00.000Z",
          scanner: "clamav",
          version: "1.4.3"
        },
        storageKey: "documents/.staging/upload-parent"
      }
    ),
    (error) => error.code === "library_folder_trashed"
  );
  assert.equal(reachedStorageMutation, false);
});

test("increments the scope revision when a repaired upload becomes visible", async () => {
  const workflow = {
    actor_id: "user_1",
    content_hash: "a".repeat(64),
    final_key: `documents/objects/aa/${"a".repeat(64)}`,
    idempotency_key: "upload-repair-visible",
    operation: "upload_pdf",
    request_hash: "b".repeat(64),
    response_body: { document: { documentId: "document_1" }, revision: 4, status: "imported" },
    scope_id: "user_1",
    scope_type: "user",
    security_scan_hash: "a".repeat(64),
    security_scanned_at: new Date("2026-08-11T00:00:00.000Z"),
    security_scanner: "clamav",
    security_scanner_version: "1.4.3",
    state: "object_published",
    workflow_id: "workflow_visible"
  };
  const persistedResponses = [];
  const repository = new PostgresLibraryRepository(transactionPool(async (sql, values) => {
    if (sql.includes("FROM storage_publish_workflows") && sql.includes("FOR UPDATE")) {
      return { rows: [workflow] };
    }
    if (sql.includes("UPDATE storage_objects")) return { rows: [{ content_hash: workflow.content_hash }] };
    if (sql.includes("UPDATE library_entries SET availability")) return { rows: [] };
    if (sql.includes("UPDATE library_scope_revisions")) return { rows: [{ revision: "5" }] };
    if (sql.includes("INSERT INTO idempotency_records")) {
      persistedResponses.push(JSON.parse(values[4]));
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_events")) return { rows: [] };
    if (sql.includes("UPDATE storage_publish_workflows")) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  }));

  const result = await repository.completePdfUpload(workflow, "trace_repair_visible");

  assert.equal(result.revision, 5);
  assert.equal(persistedResponses[0].revision, 5);
});

test("finds staging keys still referenced by recoverable database state", async () => {
  const queries = [];
  const repository = new PostgresLibraryRepository({
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [
        { staging_key: "documents/.staging/workflow" },
        { staging_key: "documents/.staging/object" }
      ] };
    }
  });

  assert.deepEqual(await repository.listReferencedStagingKeys([
    "documents/.staging/workflow",
    "documents/.staging/object",
    "documents/.staging/orphan"
  ]), [
    "documents/.staging/workflow",
    "documents/.staging/object"
  ]);
  assert.deepEqual(queries[0].values, [[
    "documents/.staging/workflow",
    "documents/.staging/object",
    "documents/.staging/orphan"
  ]]);
  assert.match(queries[0].sql, /state <> 'completed'/);
  assert.match(queries[0].sql, /FROM storage_objects/);
});

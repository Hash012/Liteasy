import assert from "node:assert/strict";
import test from "node:test";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";

const confirmedLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/liteasy" }],
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

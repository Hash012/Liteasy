import assert from "node:assert/strict";
import test from "node:test";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";

const manualLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "manual", value: "10.1000/liteasy" }],
  literatureId: "literature:doi:10.1000/liteasy",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
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
    const repository = new PostgresLibraryRepository(harness.pool);

    const updated = await repository.updateEntry(
      { scopeId: "user-1", scopeType: "user" },
      {
        actorId: "user-1",
        documentId: "document-1",
        expectedRevision: 1,
        idempotencyKey: `literature-${entryKind}`,
        literature: manualLiterature
      }
    );

    assert.deepEqual(updated.document.metadata.literature, manualLiterature);
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
  });

  await assert.rejects(() => repository.updateEntry(
    { scopeId: "user-1", scopeType: "user" },
    {
      actorId: "user-1",
      documentId: "document-1",
      expectedRevision: 1,
      idempotencyKey: "literature-invalid",
      literature: { ...manualLiterature, identifiers: [] }
    }
  ), /literature_metadata_invalid/);
  assert.equal(connections, 0);
});

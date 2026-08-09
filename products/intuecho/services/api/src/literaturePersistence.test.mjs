import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";

const owner = { id: "literature-owner", initials: "LO", name: "Literature Owner" };

function publicCandidate(overrides = {}) {
  return {
    candidateKey: "crossref:doi:10.1000/verified",
    provider: "crossref",
    record: {
      authors: ["Verified Author"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }],
      title: "Verified Registry Title",
      year: 2026,
      ...overrides
    }
  };
}

function manualConfirmation(overrides = {}) {
  return {
    mode: "manual",
    record: {
      authors: ["Manual Author"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/verified" }],
      title: "Manual Replacement Title",
      year: 2025,
      ...overrides
    }
  };
}

function postgresLiteratureHarness({ identities, record }) {
  const records = new Map([[record.id, { ...record }]]);
  const identityRows = identities.map((identity) => ({ literature_id: record.id, ...identity }));
  const versions = [];
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values });
      if (normalized.startsWith("BEGIN ") || normalized === "COMMIT" || normalized === "ROLLBACK") return { rows: [] };
      if (normalized.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.startsWith("SELECT literature_id, identity_kind, identity_value FROM literature_identities")) {
        return { rows: identityRows.filter((identity) => values[0].includes(identity.identity_kind)).map((identity) => ({ ...identity })) };
      }
      if (normalized.startsWith("SELECT literature_id FROM literature_identities")) {
        return { rows: identityRows.filter((identity) => values[0].includes(identity.literature_id)).map((identity) => ({ literature_id: identity.literature_id })) };
      }
      if (normalized.startsWith("SELECT * FROM literature_records WHERE id = $1")) {
        const selected = records.get(values[0]);
        return { rows: selected ? [{ ...selected }] : [] };
      }
      if (normalized.startsWith("SELECT identity_kind AS kind")) {
        return {
          rows: identityRows.filter((identity) => identity.literature_id === values[0]).map((identity) => ({
            kind: identity.identity_kind,
            source: identity.identity_source,
            value: identity.identity_value
          })).sort((left, right) => `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`))
        };
      }
      if (normalized.startsWith("SELECT 1 FROM literature_identities")) {
        return { rows: identityRows.some((identity) => identity.literature_id === values[0] && identity.identity_source !== values[1]) ? [{ exists: 1 }] : [] };
      }
      if (normalized.startsWith("INSERT INTO literature_record_versions")) {
        if (!versions.some((version) => version.literatureId === values[1] && version.revision === Number(values[2]))) {
          versions.push({
            changedBy: values[4],
            literatureId: values[1],
            revision: Number(values[2]),
            snapshot: JSON.parse(values[3])
          });
        }
        return { rows: [] };
      }
      if (normalized.startsWith("UPDATE literature_records SET title")) {
        const current = records.get(values[0]);
        records.set(values[0], {
          ...current,
          authors: JSON.parse(values[2]),
          confirmed_at: values[7],
          document_type: values[4],
          publication_year: values[3],
          record_source: values[5],
          revision: Number(values[8]),
          source_provider: values[6],
          title: values[1],
          updated_at: values[9]
        });
        return { rows: [] };
      }
      if (normalized.startsWith("UPDATE literature_identities SET identity_source")) {
        for (const identity of identityRows) {
          if (identity.literature_id === values[1]) identity.identity_source = values[0];
        }
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO literature_identities")) {
        if (!identityRows.some((identity) => identity.identity_kind === values[1] && identity.identity_value === values[2])) {
          identityRows.push({
            identity_kind: values[1],
            identity_source: values[3],
            identity_value: values[2],
            literature_id: values[0]
          });
        }
        return { rows: [] };
      }
      throw new Error(`unexpected PostgreSQL literature query: ${normalized}`);
    },
    release() {}
  };
  const pool = {
    async connect() { return client; },
    async query(sql, values) { return client.query(sql, values); }
  };
  return {
    identities: identityRows,
    queries,
    records,
    repository: new PostgresAnnotationCommunityRepository(pool),
    versions
  };
}

function postgresRecord(overrides = {}) {
  const now = new Date("2026-08-09T00:00:00.000Z");
  return {
    authors: ["Verified Author"],
    confirmed_at: now,
    created_at: now,
    document_type: null,
    id: "literature-postgres",
    publication_year: 2026,
    record_source: "public_registry",
    revision: 1,
    source_provider: "crossref",
    title: "Verified Registry Title",
    updated_at: now,
    ...overrides
  };
}

test("manual confirmation cannot downgrade a provider-verified SQLite record", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const verified = await repository.confirmRefetchedLiterature(owner, publicCandidate());
    const result = await repository.confirmLiterature(owner, manualConfirmation({
      identifiers: [
        { kind: "doi", source: "manual", value: "10.1000/verified" },
        { kind: "arxiv_id", source: "manual", value: "2401.01234" }
      ]
    }));

    assert.equal(result.literatureId, verified.literatureId);
    assert.equal(result.title, "Verified Registry Title");
    assert.equal(result.provenance.mode, "public_registry");
    assert.deepEqual(result.identifiers, [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }]);
    assert.equal(db.prepare("SELECT revision FROM literature_records_v2 WHERE id = ?").get(verified.literatureId).revision, 1);
  } finally {
    db.close();
  }
});

test("manual confirmation cannot downgrade a provider-verified PostgreSQL record", async () => {
  const instance = postgresLiteratureHarness({
    identities: [{ identity_kind: "doi", identity_source: "public_registry", identity_value: "10.1000/verified" }],
    record: postgresRecord()
  });

  const result = await instance.repository.confirmLiterature(owner, manualConfirmation({
    identifiers: [
      { kind: "doi", source: "manual", value: "10.1000/verified" },
      { kind: "arxiv_id", source: "manual", value: "2401.01234" }
    ]
  }));

  assert.equal(result.title, "Verified Registry Title");
  assert.equal(result.provenance.mode, "public_registry");
  assert.deepEqual(result.identifiers, [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }]);
  assert.equal(instance.records.get("literature-postgres").revision, 1);
  assert.equal(instance.queries.some((query) => query.sql.startsWith("UPDATE literature_records")), false);
});

test("SQLite versions an identity-only correction before inserting the alias", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const initial = await repository.confirmLiterature(owner, manualConfirmation({
      authors: ["Manual Author"],
      title: "Manual Record",
      year: 2025
    }));
    const corrected = await repository.confirmLiterature(owner, manualConfirmation({
      authors: ["Manual Author"],
      identifiers: [
        { kind: "doi", source: "manual", value: "10.1000/verified" },
        { kind: "arxiv_id", source: "manual", value: "2401.01234" }
      ],
      title: "Manual Record",
      year: 2025
    }));

    assert.equal(db.prepare("SELECT revision FROM literature_records_v2 WHERE id = ?").get(initial.literatureId).revision, 2);
    const snapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").get(initial.literatureId).snapshot_json);
    assert.deepEqual(snapshot.identifiers.map((identifier) => identifier.kind), ["doi"]);
    assert.deepEqual(corrected.identifiers.map((identifier) => identifier.kind), ["arxiv_id", "doi"]);
  } finally {
    db.close();
  }
});

test("PostgreSQL versions an identity-only correction before inserting the alias", async () => {
  const instance = postgresLiteratureHarness({
    identities: [{ identity_kind: "doi", identity_source: "manual", identity_value: "10.1000/verified" }],
    record: postgresRecord({
      authors: ["Manual Author"],
      publication_year: 2025,
      record_source: "manual",
      source_provider: null,
      title: "Manual Record"
    })
  });

  const corrected = await instance.repository.confirmLiterature(owner, manualConfirmation({
    authors: ["Manual Author"],
    identifiers: [
      { kind: "doi", source: "manual", value: "10.1000/verified" },
      { kind: "arxiv_id", source: "manual", value: "2401.01234" }
    ],
    title: "Manual Record",
    year: 2025
  }));

  assert.equal(instance.records.get("literature-postgres").revision, 2);
  assert.deepEqual(instance.versions[0].snapshot.identifiers.map((identifier) => identifier.kind), ["doi"]);
  assert.deepEqual(corrected.identifiers.map((identifier) => identifier.kind), ["arxiv_id", "doi"]);
});

test("PostgreSQL snapshots legacy metadata without false manual provenance", async () => {
  const instance = postgresLiteratureHarness({
    identities: [{ identity_kind: "doi", identity_source: "metadata", identity_value: "10.1000/verified" }],
    record: postgresRecord({
      confirmed_at: null,
      record_source: "legacy_metadata",
      source_provider: null,
      title: "Legacy Metadata Title"
    })
  });

  await instance.repository.confirmLiterature(owner, manualConfirmation());

  assert.equal(instance.versions.length, 1);
  assert.equal(instance.versions[0].snapshot.recordSource, "legacy_metadata");
  assert.equal("provenance" in instance.versions[0].snapshot, false);
  assert.equal(instance.versions[0].snapshot.identifiers[0].source, "metadata");
});

test("SQLite versions supported legacy metadata updates", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const author = { id: "legacy-owner", initials: "LO", name: "Legacy Owner" };
    const annotation = (title, updatedAt) => ({
      annotationId: "legacy-annotation",
      body: "Legacy annotation body.",
      createdAt: "2026-08-09T01:00:00.000Z",
      queueKey: "legacy-queue",
      targets: [{
        kind: "whole_document",
        literature: {
          identity: { id: "doi:10.1000/legacy-update", kind: "doi", source: "metadata", value: "10.1000/legacy-update" },
          metadata: { authors: ["Legacy Author"], title, year: 2020 }
        }
      }],
      updatedAt
    });

    repository.syncDesktopAnnotations(author, [annotation("Original Legacy Title", "2026-08-09T01:00:00.000Z")]);
    repository.syncDesktopAnnotations(author, [annotation("Corrected Legacy Title", "2026-08-09T02:00:00.000Z")]);

    const row = db.prepare("SELECT id, revision, title FROM literature_records_v2 WHERE title = ?").get("Corrected Legacy Title");
    assert.equal(row.revision, 2);
    const snapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").get(row.id).snapshot_json);
    assert.equal(snapshot.recordSource, "legacy_metadata");
    assert.equal(snapshot.title, "Original Legacy Title");
  } finally {
    db.close();
  }
});

test("PostgreSQL legacy sync does not update matched canonical metadata", async () => {
  const queries = [];
  const canonical = postgresRecord();
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values });
      if (normalized.startsWith("BEGIN ") || normalized === "COMMIT" || normalized === "ROLLBACK") return { rows: [] };
      if (normalized.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.includes("account_deletion_jobs")) return { rows: [] };
      if (normalized.startsWith("SELECT * FROM desktop_annotation_syncs")) return { rows: [] };
      if (normalized.startsWith("SELECT education_stage") || normalized.startsWith("SELECT institution_name AS name")) return { rows: [] };
      if (normalized.startsWith("SELECT literature_id, identity_kind, identity_value FROM literature_identities")) {
        return { rows: [{ identity_kind: "doi", identity_value: "10.1000/verified", literature_id: canonical.id }] };
      }
      if (normalized.startsWith("SELECT literature_id FROM literature_identities")) return { rows: [{ literature_id: canonical.id }] };
      if (normalized.startsWith("SELECT * FROM literature_records")) return { rows: [canonical] };
      if (normalized.startsWith("SELECT identity_kind AS kind")) {
        return { rows: [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }] };
      }
      if (normalized.startsWith("SELECT tags.id AS tag_id")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({ async connect() { return client; } });

  const [result] = await repository.syncDesktopAnnotations({ id: "legacy-owner", initials: "LO", name: "Legacy Owner" }, [{
    annotationId: "legacy-annotation",
    body: "Legacy annotation body.",
    createdAt: "2026-08-09T01:00:00.000Z",
    queueKey: "legacy-queue",
    targets: [{
      kind: "whole_document",
      literature: {
        identity: { id: "doi:10.1000/verified", kind: "doi", source: "metadata", value: "10.1000/verified" },
        metadata: { authors: ["Spoofed Author"], title: "Spoofed Canonical Title", year: 1900 }
      }
    }],
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);

  assert.equal(result.status, "synced");
  assert.equal(queries.some((query) => query.sql.startsWith("UPDATE literature_records SET title")), false);
});

test("PostgreSQL legacy sync locks lifecycle and sorted queues while preserving result order", async () => {
  const events = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      if (normalized.startsWith("BEGIN ") || normalized === "COMMIT" || normalized === "ROLLBACK") return { rows: [] };
      if (normalized.includes("pg_advisory_xact_lock")) {
        events.push(`lock:${values[0]}`);
        return { rows: [] };
      }
      if (normalized.includes("account_deletion_jobs")) {
        events.push("tombstone");
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT * FROM desktop_annotation_syncs")) {
        events.push(`sync:${values[1]}`);
        return {
          rows: [{
            annotation_id: `remote-${values[1]}`,
            source_updated_at: new Date("2026-08-09T02:00:00.000Z")
          }]
        };
      }
      throw new Error(`unexpected PostgreSQL legacy lifecycle query: ${normalized}`);
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({ async connect() { return client; } });
  const items = [
    {
      annotationId: "legacy-b",
      body: "Legacy B",
      createdAt: "2026-08-09T01:00:00.000Z",
      queueKey: "queue-b",
      targets: [],
      updatedAt: "2026-08-09T01:00:00.000Z"
    },
    {
      annotationId: "legacy-a",
      body: "Legacy A",
      createdAt: "2026-08-09T01:00:00.000Z",
      queueKey: "queue-a",
      targets: [],
      updatedAt: "2026-08-09T01:00:00.000Z"
    }
  ];

  const results = await repository.syncDesktopAnnotations({ id: "legacy-owner", initials: "LO", name: "Legacy Owner" }, items);

  assert.deepEqual(results.map((result) => result.queueKey), ["queue-b", "queue-a"]);
  assert.deepEqual(events, [
    "lock:intuecho-account-deletion:legacy-owner",
    "tombstone",
    "lock:desktop-publication:legacy-owner:queue-a",
    "lock:desktop-publication:legacy-owner:queue-b",
    "sync:queue-b",
    "sync:queue-a"
  ]);
});

test("PostgreSQL legacy sync rejects a deleted owner without touching sync rows", async () => {
  let touchedSyncRows = false;
  const client = {
    async query(sql) {
      const normalized = sql.trim();
      if (normalized.startsWith("BEGIN ") || normalized === "COMMIT" || normalized === "ROLLBACK") return { rows: [] };
      if (normalized.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.includes("account_deletion_jobs")) return { rows: [{ exists: 1 }] };
      if (normalized.includes("desktop_annotation_syncs")) {
        touchedSyncRows = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({ async connect() { return client; } });
  const items = [{
    annotationId: "legacy-deleted",
    body: "Must not be written.",
    createdAt: "2026-08-09T01:00:00.000Z",
    queueKey: "deleted-queue",
    targets: [],
    updatedAt: "2026-08-09T01:00:00.000Z"
  }];

  const results = await repository.syncDesktopAnnotations({ id: "deleted-owner", initials: "DO", name: "Deleted Owner" }, items);

  assert.deepEqual(results, [{
    annotationId: "legacy-deleted",
    error: "ANNOTATION_PUBLICATION_OWNER_DELETED",
    queueKey: "deleted-queue"
  }]);
  assert.equal(touchedSyncRows, false);
});

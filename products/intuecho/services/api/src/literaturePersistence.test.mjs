import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";

const owner = { id: "literature-owner" };

function candidate({
  candidateKey = "crossref:doi:10.1000/verified",
  identifiers = [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }],
  provider = "crossref",
  documentType,
  title = "Verified Registry Title",
  year = 2026
} = {}) {
  return {
    candidateKey,
    provider,
    record: { authors: ["Verified Author"], ...(documentType ? { documentType } : {}), identifiers, title, year },
    recordUrl: "https://registry.example.test/record"
  };
}

test("SQLite reuses one confirmed literature id across owners and separates identifiers from claims", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const first = await repository.confirmRefetchedLiterature(owner, candidate());
    const second = await repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate());

    assert.equal(second.literatureId, first.literatureId);
    assert.equal(first.status, "confirmed");
    assert.equal(first.revision, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 1);
    assert.deepEqual(db.prepare("SELECT identifier_kind, normalized_value FROM literature_identifiers_v2").all(), [
      { identifier_kind: "doi", normalized_value: "10.1000/verified" }
    ]);
    assert.deepEqual(db.prepare("SELECT literature_id, provider, provider_record_id, verification_status FROM literature_identity_claims_v2").all(), [{
      literature_id: first.literatureId,
      provider: "crossref",
      provider_record_id: "10.1000/verified",
      verification_status: "confirmed"
    }]);
  } finally {
    db.close();
  }
});

test("SQLite rejects fingerprint-only confirmation and conflicting bibliography for a stable identifier", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: `openalex:title_authors_year_hash:sha256:${"a".repeat(64)}`,
      identifiers: [{ kind: "title_authors_year_hash", source: "public_registry", value: `sha256:${"a".repeat(64)}` }],
      provider: "openalex"
    })), /LITERATURE_IDENTITY_REQUIRED/);

    await repository.confirmRefetchedLiterature(owner, candidate());
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      title: "A Conflicting Work",
      year: 2024
    })), /LITERATURE_IDENTITY_CONFLICT/);
  } finally {
    db.close();
  }
});

test("SQLite binds a provider record id to one literature even when its external identifiers change", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const first = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [
        { kind: "openalex_id", source: "public_registry", value: "W123" },
        { kind: "doi", source: "public_registry", value: "10.1000/first" }
      ],
      provider: "openalex"
    }));
    const refreshed = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [
        { kind: "openalex_id", source: "public_registry", value: "W123" },
        { kind: "doi", source: "public_registry", value: "10.1000/corrected" }
      ],
      provider: "openalex"
    }));

    assert.equal(refreshed.literatureId, first.literatureId);
    assert.equal(refreshed.revision, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identity_claims_v2").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2 WHERE literature_id = ?").get(first.literatureId).count, 3);
  } finally {
    db.close();
  }
});

test("SQLite keeps preprint and publication identities separate and returns evidenced relations", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const preprint = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "arxiv:arxiv_id:2401.01234",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }],
      provider: "arxiv"
    }));
    const publication = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "crossref:doi:10.1000/publication",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }]
    }));
    await repository.confirmLiteratureRelation({
      evidence: { recordUrl: "https://registry.example.test/relation" },
      fromLiteratureId: preprint.literatureId,
      provider: "crossref",
      relationType: "is_preprint_of",
      toLiteratureId: publication.literatureId
    });

    assert.notEqual(preprint.literatureId, publication.literatureId);
    const relations = await repository.findLiteratureRelations(preprint.literatureId);
    assert.equal(relations.length, 1);
    assert.match(relations[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual({ ...relations[0], createdAt: "timestamp" }, {
      createdAt: "timestamp",
      evidence: { recordUrl: "https://registry.example.test/relation" },
      fromLiteratureId: preprint.literatureId,
      provider: "crossref",
      relationType: "is_preprint_of",
      toLiteratureId: publication.literatureId,
      verificationStatus: "confirmed"
    });
  } finally {
    db.close();
  }
});

test("SQLite rejects one formal publication record that binds both publication DOI and arXiv identifiers", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      identifiers: [
        { kind: "semantic_scholar_id", source: "public_registry", value: "semantic-123" },
        { kind: "doi", source: "public_registry", value: "10.1000/publication" },
        { kind: "arxiv_id", source: "public_registry", value: "2401.01234" }
      ],
      candidateKey: "semantic_scholar:semantic_scholar_id:semantic-123",
      provider: "semantic_scholar",
      documentType: "publication"
    })), /LITERATURE_IDENTITY_CONFLICT/);
  } finally {
    db.close();
  }
});

test("SQLite projection verification requires the exact confirmed revision", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const record = await repository.confirmRefetchedLiterature(owner, candidate());
    assert.equal((await repository.verifyLiteratureProjection(record.literatureId, 1))?.literatureId, record.literatureId);
    assert.equal(await repository.verifyLiteratureProjection(record.literatureId, 2), null);
    assert.equal(await repository.verifyLiteratureProjection("missing", 1), null);
  } finally {
    db.close();
  }
});

function postgresHarness() {
  const records = new Map();
  const identifiers = [];
  const claims = [];
  const versions = [];
  const client = {
    async query(sql, values = []) {
      const query = sql.trim();
      if (query.startsWith("BEGIN ") || query === "COMMIT" || query === "ROLLBACK" || query.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (query.startsWith("SELECT literature_id, identifier_kind, normalized_value FROM literature_identifiers")) {
        return { rows: identifiers.filter((item) => values[0].includes(item.identifier_kind)) };
      }
      if (query.startsWith("SELECT literature_id FROM literature_identifiers")) {
        return { rows: identifiers.filter((item) => values[0].includes(item.literature_id)).map((item) => ({ literature_id: item.literature_id })) };
      }
      if (query.startsWith("SELECT literature_id FROM literature_identity_claims")) {
        return { rows: claims.filter((item) => item.provider === values[0] && item.provider_record_id === values[1]) };
      }
      if (query.startsWith("SELECT * FROM literature_records WHERE id = $1")) {
        const record = records.get(values[0]);
        return { rows: record ? [{ ...record }] : [] };
      }
      if (query.startsWith("INSERT INTO literature_records(")) {
        const now = values[6];
        records.set(values[0], {
          authors: JSON.parse(values[2]), confirmed_at: now, document_type: values[4], id: values[0],
          identity_status: "confirmed", publication_year: values[3], record_source: "public_registry",
          revision: 1, source_provider: values[5], title: values[1], updated_at: now
        });
        return { rows: [] };
      }
      if (query.startsWith("SELECT identifier_kind AS kind")) {
        return { rows: identifiers.filter((item) => item.literature_id === values[0]).map((item) => ({ kind: item.identifier_kind, source: "public_registry", value: item.normalized_value })) };
      }
      if (query.startsWith("INSERT INTO literature_identifiers")) {
        if (!identifiers.some((item) => item.identifier_kind === values[1] && item.normalized_value === values[2])) {
          identifiers.push({ literature_id: values[0], identifier_kind: values[1], normalized_value: values[2] });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_identity_claims")) {
        if (!claims.some((item) => item.provider === values[2] && item.provider_record_id === values[3])) {
          claims.push({ literature_id: values[1], provider: values[2], provider_record_id: values[3] });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_record_versions")) {
        versions.push({
          literatureId: values[1],
          revision: query.includes("VALUES ($1, $2, 1") ? 1 : Number(values[2])
        });
        return { rows: [] };
      }
      throw new Error(`unexpected PostgreSQL literature query: ${query}`);
    },
    release() {}
  };
  const pool = { async connect() { return client; }, async query(sql, values) { return client.query(sql, values); } };
  return { claims, identifiers, records, repository: new PostgresAnnotationCommunityRepository(pool), versions };
}

test("PostgreSQL confirmation stores one identifier owner and one provider claim", async () => {
  const harness = postgresHarness();
  const record = await harness.repository.confirmRefetchedLiterature(owner, candidate());

  assert.equal(record.status, "confirmed");
  assert.equal(record.revision, 1);
  assert.equal(harness.records.size, 1);
  assert.deepEqual(harness.identifiers, [{
    identifier_kind: "doi",
    literature_id: record.literatureId,
    normalized_value: "10.1000/verified"
  }]);
  assert.deepEqual(harness.claims, [{
    literature_id: record.literatureId,
    provider: "crossref",
    provider_record_id: "10.1000/verified"
  }]);
  assert.deepEqual(harness.versions, [{ literatureId: record.literatureId, revision: 1 }]);
});

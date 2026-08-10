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
    assert.deepEqual(new Set(db.prepare("SELECT changed_by FROM literature_record_versions_v2").all().map((row) => row.changed_by)), new Set(["literature_resolver"]));
  } finally {
    db.close();
  }
});

test("SQLite reuses one version when two aggregate providers independently confirm the same bibliography", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const openAlex = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      documentType: "article",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provider: "openalex"
    }));
    const semanticScholar = await repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
      documentType: "publication",
      identifiers: [{ kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" }],
      provider: "semantic_scholar"
    }));

    assert.equal(semanticScholar.literatureId, openAlex.literatureId);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2").get().count, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identity_claims_v2").get().count, 2);
    const claim = db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE provider = 'semantic_scholar'").get();
    assert.equal(JSON.parse(claim.evidence_json).confirmationBasis, "independent_aggregate_bibliography");
  } finally {
    db.close();
  }
});

test("SQLite does not merge aggregate preprint and publication records with matching bibliography", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const preprint = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      documentType: "preprint",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provider: "openalex"
    }));
    const publication = await repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
      documentType: "publication",
      identifiers: [{ kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" }],
      provider: "semantic_scholar"
    }));

    assert.notEqual(publication.literatureId, preprint.literatureId);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 2);
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

test("SQLite replaces migrated aggregate claim evidence after a fresh server refetch", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const first = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provider: "openalex"
    }));
    db.prepare("UPDATE literature_records_v2 SET identity_status = 'legacy_unverified' WHERE id = ?").run(first.literatureId);
    db.prepare("UPDATE literature_identity_claims_v2 SET evidence_json = ? WHERE literature_id = ?")
      .run(JSON.stringify({ migration: "sqlite_source_confirmed_identity" }), first.literatureId);

    const refreshed = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provider: "openalex"
    }));

    assert.equal(refreshed.status, "confirmed");
    const claim = db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE literature_id = ?").get(first.literatureId);
    assert.equal(JSON.parse(claim.evidence_json).confirmationBasis, "user_selected_refetch");
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
    await assert.rejects(() => repository.confirmLiteratureRelation({
      evidence: {},
      fromLiteratureId: preprint.literatureId,
      provider: "crossref",
      relationType: "is_preprint_of",
      toLiteratureId: publication.literatureId
    }), /LITERATURE_RELATION_EVIDENCE_REQUIRED/);
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
      if (query.startsWith("SELECT DISTINCT claim.literature_id")) {
        return {
          rows: claims.filter((claim) => values[0].includes(claim.provider) && claim.provider !== values[1])
            .filter((claim) => records.get(claim.literature_id)?.publication_year === values[2])
            .map((claim) => ({ literature_id: claim.literature_id }))
        };
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
      if (query.startsWith("UPDATE literature_records SET title")) {
        const record = records.get(values[0]);
        records.set(values[0], {
          ...record,
          authors: JSON.parse(values[2]),
          confirmed_at: values[6],
          document_type: values[4],
          identity_status: "confirmed",
          publication_year: values[3],
          record_source: "public_registry",
          revision: values[7],
          source_provider: values[5],
          title: values[1],
          updated_at: values[8]
        });
        return { rows: [] };
      }
      if (query.startsWith("SELECT identifier_kind AS kind")) {
        return { rows: identifiers.filter((item) => item.literature_id === values[0]).map((item) => ({ kind: item.identifier_kind, source: "public_registry", value: item.normalized_value })) };
      }
      if (query.startsWith("SELECT identity_kind AS kind")) return { rows: [] };
      if (query.startsWith("INSERT INTO literature_identifiers")) {
        if (!identifiers.some((item) => item.identifier_kind === values[1] && item.normalized_value === values[2])) {
          identifiers.push({ literature_id: values[0], identifier_kind: values[1], normalized_value: values[2] });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_identity_claims")) {
        const existing = claims.find((item) => item.provider === values[2] && item.provider_record_id === values[3]);
        if (existing) {
          if (existing.literature_id === values[1]) {
            existing.evidence = JSON.parse(values[4]);
            existing.observed_at = values[5];
          }
        } else {
          claims.push({
            evidence: JSON.parse(values[4]),
            literature_id: values[1],
            observed_at: values[5],
            provider: values[2],
            provider_record_id: values[3]
          });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_record_versions")) {
        versions.push({
          changedBy: query.includes("VALUES ($1, $2, 1") ? values[3] : values[4],
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
    evidence: {
      candidateKey: "crossref:doi:10.1000/verified",
      confirmationBasis: "primary_registry_refetch",
      recordUrl: "https://registry.example.test/record",
      sourceTier: "primary"
    },
    literature_id: record.literatureId,
    observed_at: harness.claims[0].observed_at,
    provider: "crossref",
    provider_record_id: "10.1000/verified"
  }]);
  assert.deepEqual(harness.versions, [{
    changedBy: "literature_resolver",
    literatureId: record.literatureId,
    revision: 1
  }]);
  assert.equal(harness.versions[0].changedBy, "literature_resolver");
});

test("PostgreSQL reuses one version when two aggregate providers independently confirm the same bibliography", async () => {
  const harness = postgresHarness();
  const openAlex = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W123",
    documentType: "article",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    provider: "openalex"
  }));
  const semanticScholar = await harness.repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
    documentType: "publication",
    identifiers: [{ kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" }],
    provider: "semantic_scholar"
  }));

  assert.equal(semanticScholar.literatureId, openAlex.literatureId);
  assert.equal(harness.records.size, 1);
  assert.equal(harness.identifiers.length, 2);
  assert.equal(harness.claims.length, 2);
});

test("PostgreSQL does not merge aggregate preprint and publication records with matching bibliography", async () => {
  const harness = postgresHarness();
  const preprint = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W123",
    documentType: "preprint",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    provider: "openalex"
  }));
  const publication = await harness.repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
    documentType: "publication",
    identifiers: [{ kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" }],
    provider: "semantic_scholar"
  }));

  assert.notEqual(publication.literatureId, preprint.literatureId);
  assert.equal(harness.records.size, 2);
});

test("PostgreSQL replaces migrated aggregate evidence after refetch and rejects empty relation evidence", async () => {
  const harness = postgresHarness();
  const openAlex = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    provider: "openalex"
  }));
  const publication = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "crossref:doi:10.1000/publication",
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }],
    title: "Published Registry Title"
  }));
  harness.records.get(openAlex.literatureId).identity_status = "legacy_unverified";
  const claim = harness.claims.find((item) => item.provider === "openalex");
  claim.evidence = { migration: "016_source_confirmed_literature_identity" };

  await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
    provider: "openalex"
  }));

  assert.equal(claim.evidence.confirmationBasis, "user_selected_refetch");
  await assert.rejects(() => harness.repository.confirmLiteratureRelation({
    evidence: {},
    fromLiteratureId: openAlex.literatureId,
    provider: "intuecho",
    relationType: "version_of",
    toLiteratureId: publication.literatureId
  }), /LITERATURE_RELATION_EVIDENCE_REQUIRED/);
});

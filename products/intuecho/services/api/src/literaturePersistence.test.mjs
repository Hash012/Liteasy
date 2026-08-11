import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";

const owner = { id: "literature-owner" };

function candidate({
  candidateKey = "crossref:doi:10.1000/verified",
  identifiers = [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }],
  provider = "crossref",
  recordUrl,
  sourceEvidence,
  documentType,
  title = "Verified Registry Title",
  year = 2026
} = {}) {
  return {
    candidateKey,
    provider,
    record: { authors: ["Verified Author"], ...(documentType ? { documentType } : {}), identifiers, title, year },
    recordUrl: recordUrl ?? (provider === "pmlr"
      ? `https://proceedings.mlr.press/${identifiers.find((identifier) => identifier.kind === "pmlr_id")?.value}.html`
      : "https://registry.example.test/record"),
    ...(sourceEvidence ? { sourceEvidence } : {})
  };
}

function pmlrSourceEvidence(volume, slug) {
  return {
    artifactHash: `sha256:${"a".repeat(64)}`,
    artifactUrl: `https://proceedings.mlr.press/v${volume}/assets/bib/bibliography.bib`,
    entryKey: `pmlr-v${volume}-${slug}`,
    sourceKind: "official_volume_bibtex",
    volume
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
    assert.deepEqual(first.identifiers, [
      {
        kind: "doi",
        role: "confirmable",
        source: "public_registry",
        value: "10.1000/verified"
      },
      {
        kind: "title_authors_year_hash",
        role: "candidate_alias",
        source: "metadata",
        value: "sha256:42b41d09d804fbbd3e7921ae50a0564104a76155862756c0f35e90b327e7e93a"
      }
    ]);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2").get().count, 2);
    assert.deepEqual(db.prepare(`
      SELECT identifier.literature_id, claim.identifier_id, claim.provider,
             claim.provider_record_id, claim.verification_status
        FROM literature_identity_claims_v2 claim
        JOIN literature_identifiers_v2 identifier ON identifier.id = claim.identifier_id
    `).all(), [{
      identifier_id: db.prepare("SELECT id FROM literature_identifiers_v2 WHERE identifier_kind = 'doi'").get().id,
      literature_id: first.literatureId,
      provider: "crossref",
      provider_record_id: "10.1000/verified",
      verification_status: "confirmed"
    }]);
    assert.deepEqual(new Set(db.prepare("SELECT changed_by FROM literature_record_versions_v2").all().map((row) => row.changed_by)), new Set(["literature_resolver"]));
    assert.deepEqual(await repository.findLiteratureClaims(first.literatureId), [{
      evidence: {
        candidateKey: "crossref:doi:10.1000/verified",
        confirmationBasis: "primary_registry_refetch",
        recordUrl: "https://registry.example.test/record",
        sourceTier: "primary"
      },
      identifier: {
        kind: "doi",
        role: "confirmable",
        source: "public_registry",
        value: "10.1000/verified"
      },
      observedAt: db.prepare("SELECT observed_at FROM literature_identity_claims_v2").get().observed_at,
      provider: "crossref",
      providerRecordId: "10.1000/verified",
      verificationStatus: "confirmed"
    }]);
  } finally {
    db.close();
  }
});

test("SQLite keeps candidate bibliography aliases non-owning while stable identifiers stay unique", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const first = await repository.confirmRefetchedLiterature(owner, candidate({
      documentType: "journal-article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/first" }],
      candidateKey: "crossref:doi:10.1000/first",
      title: "Shared Bibliography"
    }));
    const second = await repository.confirmRefetchedLiterature(owner, candidate({
      documentType: "journal-article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/second" }],
      candidateKey: "crossref:doi:10.1000/second",
      title: "Shared Bibliography"
    }));

    assert.notEqual(second.literatureId, first.literatureId);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2 WHERE identifier_kind = 'title_authors_year_hash'").get().count, 2);
    const bibliographyAlias = db.prepare("SELECT normalized_value FROM literature_identifiers_v2 WHERE identifier_kind = 'title_authors_year_hash' LIMIT 1").get().normalized_value;
    assert.equal(await repository.findLiteratureByIdentifiers([{
      kind: "title_authors_year_hash",
      value: bibliographyAlias
    }]), null);
    assert.throws(() => db.prepare(`
      INSERT INTO literature_identifiers_v2(
        id, literature_id, identifier_kind, identifier_role, normalized_value, is_legacy_alias, created_at
      ) VALUES ('duplicate-doi', ?, 'doi', 'confirmable', '10.1000/first', 0, 'now')
    `).run(second.literatureId), /UNIQUE/);
  } finally {
    db.close();
  }
});

test("SQLite persists OpenReview as primary evidence and DBLP as aggregate evidence", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const openReview = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openreview:openreview_id:OR-ICLR-2026",
      documentType: "conference-paper",
      identifiers: [{ kind: "openreview_id", source: "public_registry", value: "OR-ICLR-2026" }],
      provider: "openreview",
      title: "An ICLR Paper"
    }));
    const dblp = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "dblp:dblp_key:conf/aaai/Lovelace26",
      documentType: "conference-paper",
      identifiers: [{ kind: "dblp_key", source: "public_registry", value: "conf/aaai/Lovelace26" }],
      provider: "dblp",
      title: "An AAAI Paper"
    }));

    assert.notEqual(openReview.literatureId, dblp.literatureId);
    const claims = db.prepare(`
      SELECT claim.provider, identifier.identifier_kind, claim.evidence_json
        FROM literature_identity_claims_v2 claim
        JOIN literature_identifiers_v2 identifier ON identifier.id = claim.identifier_id
       ORDER BY claim.provider
    `).all();
    assert.deepEqual(claims.map((row) => ({
      identifierKind: row.identifier_kind,
      provider: row.provider
    })), [
      { identifierKind: "dblp_key", provider: "dblp" },
      { identifierKind: "openreview_id", provider: "openreview" }
    ]);
    assert.equal(JSON.parse(claims[0].evidence_json).confirmationBasis, "user_selected_refetch");
    assert.equal(JSON.parse(claims[0].evidence_json).sourceTier, "aggregate");
    assert.equal(JSON.parse(claims[1].evidence_json).confirmationBasis, "primary_registry_refetch");
    assert.equal(JSON.parse(claims[1].evidence_json).sourceTier, "primary");
  } finally {
    db.close();
  }
});

test("SQLite persists audited PMLR evidence and separates volumes and preprint versions", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const first = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "pmlr:pmlr_id:v235/shared-paper24a",
      documentType: "conference-paper",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/shared-paper24a" }],
      provider: "pmlr",
      sourceEvidence: pmlrSourceEvidence(235, "shared-paper24a")
    }));
    const second = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "pmlr:pmlr_id:v236/shared-paper24a",
      documentType: "conference-paper",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v236/shared-paper24a" }],
      provider: "pmlr",
      sourceEvidence: pmlrSourceEvidence(236, "shared-paper24a")
    }));
    const preprint = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "arxiv:arxiv_id:2401.01234v1",
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v1" }],
      provider: "arxiv"
    }));

    assert.notEqual(first.literatureId, second.literatureId);
    assert.notEqual(first.literatureId, preprint.literatureId);
    const evidence = JSON.parse(db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE provider_record_id = 'v235/shared-paper24a'").get().evidence_json);
    assert.equal(evidence.confirmationBasis, "primary_registry_refetch");
    assert.equal(evidence.sourceTier, "primary");
    assert.deepEqual(evidence.sourceEvidence, pmlrSourceEvidence(235, "shared-paper24a"));
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "pmlr:pmlr_id:v237/unaudited24a",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v237/unaudited24a" }],
      provider: "pmlr"
    })), /LITERATURE_CONFIRMATION_INVALID/);
  } finally {
    db.close();
  }
});

test("SQLite preserves a content-addressed PMLR volume snapshot for audit replay", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const content = Buffer.from("@InProceedings{pmlr-v235-replayable24a}");
    const artifactHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const verified = candidate({
      candidateKey: "pmlr:pmlr_id:v235/replayable24a",
      documentType: "conference-paper",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/replayable24a" }],
      provider: "pmlr",
      sourceEvidence: {
        artifactHash,
        artifactUrl: "https://proceedings.mlr.press/v235/assets/bib/bibliography.bib",
        entryKey: "pmlr-v235-replayable24a",
        sourceKind: "official_volume_bibtex",
        volume: 235
      }
    });
    Object.defineProperty(verified, "sourceArtifact", {
      enumerable: false,
      value: {
        artifactUrl: verified.sourceEvidence.artifactUrl,
        content,
        mediaType: "application/x-bibtex"
      }
    });

    await repository.confirmRefetchedLiterature(owner, verified);

    const stored = db.prepare("SELECT artifact_hash, artifact_url, content, byte_length FROM literature_source_artifacts_v2").get();
    assert.equal(stored.artifact_hash, artifactHash);
    assert.equal(stored.artifact_url, verified.sourceEvidence.artifactUrl);
    assert.deepEqual(stored.content, content);
    assert.equal(stored.byte_length, content.byteLength);
    assert.throws(() => db.prepare("UPDATE literature_source_artifacts_v2 SET artifact_url = ? WHERE artifact_hash = ?")
      .run("https://proceedings.mlr.press/changed", artifactHash), /literature_source_artifact_is_append_only/);
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
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2").get().count, 3);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identity_claims_v2").get().count, 2);
    const claim = db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE provider = 'semantic_scholar'").get();
    assert.equal(JSON.parse(claim.evidence_json).confirmationBasis, "independent_provider_bibliography");
  } finally {
    db.close();
  }
});

test("SQLite applies the aggregate corroboration rule to DBLP", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const openAlex = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W2026001",
      documentType: "conference-paper",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W2026001" }],
      provider: "openalex"
    }));
    const dblp = await repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
      candidateKey: "dblp:dblp_key:conf/icml/Verified26",
      documentType: "conference-paper",
      identifiers: [{ kind: "dblp_key", source: "public_registry", value: "conf/icml/Verified26" }],
      provider: "dblp"
    }));

    assert.equal(dblp.literatureId, openAlex.literatureId);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 1);
    const claim = db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE provider = 'dblp'").get();
    assert.equal(JSON.parse(claim.evidence_json).confirmationBasis, "independent_provider_bibliography");
  } finally {
    db.close();
  }
});

test("SQLite reuses one version when primary and aggregate providers independently confirm the same bibliography", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const openAlex = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W321",
      documentType: "article",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W321" }],
      provider: "openalex"
    }));
    const crossref = await repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
      candidateKey: "crossref:doi:10.1000/independent",
      documentType: "journal-article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/independent" }],
      provider: "crossref"
    }));

    assert.equal(crossref.literatureId, openAlex.literatureId);
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_records_v2").get().count, 1);
    assert.equal(JSON.parse(db.prepare("SELECT evidence_json FROM literature_identity_claims_v2 WHERE provider = 'crossref'").get().evidence_json).confirmationBasis, "independent_provider_bibliography");
  } finally {
    db.close();
  }
});

test("SQLite binds Crossref, OpenAlex, and Semantic Scholar DOI claims to one identifier", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const crossref = await repository.confirmRefetchedLiterature(owner, candidate());
    const openAlex = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [
        { kind: "openalex_id", source: "public_registry", value: "W123" },
        { kind: "doi", source: "public_registry", value: "10.1000/verified" }
      ],
      provider: "openalex"
    }));
    const semanticScholar = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
      identifiers: [
        { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" },
        { kind: "doi", source: "public_registry", value: "10.1000/verified" }
      ],
      provider: "semantic_scholar"
    }));

    assert.equal(openAlex.literatureId, crossref.literatureId);
    assert.equal(semanticScholar.literatureId, crossref.literatureId);
    const doiIdentifier = db.prepare("SELECT id FROM literature_identifiers_v2 WHERE identifier_kind = 'doi' AND normalized_value = '10.1000/verified'").get();
    assert.deepEqual(db.prepare("SELECT provider, identifier_id FROM literature_identity_claims_v2 ORDER BY provider").all(), [
      { identifier_id: doiIdentifier.id, provider: "crossref" },
      { identifier_id: doiIdentifier.id, provider: "openalex" },
      { identifier_id: doiIdentifier.id, provider: "semantic_scholar" }
    ]);
  } finally {
    db.close();
  }
});

test("SQLite stores independently corroborated aggregate claims in one confirmation transaction", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const record = await repository.confirmRefetchedLiterature(owner, {
      ...candidate({
        candidateKey: "openalex:openalex_id:W123",
        documentType: "article",
        identifiers: [
          { kind: "openalex_id", source: "public_registry", value: "W123" },
          { kind: "doi", source: "public_registry", value: "10.1000/shared" }
        ],
        provider: "openalex"
      }),
      corroborations: [candidate({
        candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
        documentType: "publication",
        identifiers: [
          { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" },
          { kind: "doi", source: "public_registry", value: "10.1000/shared" }
        ],
        provider: "semantic_scholar"
      })]
    });

    assert.equal(record.revision, 1);
    const doiIdentifier = db.prepare("SELECT id FROM literature_identifiers_v2 WHERE identifier_kind = 'doi'").get();
    assert.deepEqual(db.prepare("SELECT provider, identifier_id FROM literature_identity_claims_v2 ORDER BY provider").all(), [
      { identifier_id: doiIdentifier.id, provider: "openalex" },
      { identifier_id: doiIdentifier.id, provider: "semantic_scholar" }
    ]);
  } finally {
    db.close();
  }
});

test("SQLite records a new provider claim without changing an otherwise identical literature revision", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const identifiers = [
      { kind: "openalex_id", source: "public_registry", value: "W777" },
      { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:777" }
    ];
    const first = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W777",
      identifiers,
      provider: "openalex"
    }));
    const second = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:777",
      identifiers: [identifiers[1], identifiers[0]],
      provider: "semantic_scholar"
    }));

    assert.equal(first.revision, 1);
    assert.equal(second.revision, 1);
    assert.deepEqual(db.prepare("SELECT revision, source_provider FROM literature_records_v2").get(), {
      revision: 1,
      source_provider: "openalex"
    });
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identity_claims_v2").get().count, 2);
  } finally {
    db.close();
  }
});

test("SQLite preserves confirmed literature when the repository is reopened", async () => {
  const db = new Database(":memory:");
  try {
    const firstRepository = new SqliteAnnotationCommunityRepository(db);
    const confirmed = await firstRepository.confirmRefetchedLiterature(owner, candidate());

    const reopenedRepository = new SqliteAnnotationCommunityRepository(db);

    assert.deepEqual(
      await reopenedRepository.findLiteratureById(confirmed.literatureId),
      confirmed
    );
    assert.equal(
      db.prepare("SELECT confirmation_status FROM literature_records_v2 WHERE id = ?")
        .get(confirmed.literatureId).confirmation_status,
      "confirmed"
    );
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

test("SQLite rejects fingerprint-only candidates and conflicting bibliography for a stable identifier", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: `openalex:title_authors_year_hash:sha256:${"a".repeat(64)}`,
      identifiers: [{ kind: "title_authors_year_hash", source: "public_registry", value: `sha256:${"a".repeat(64)}` }],
      provider: "openalex"
    })), /LITERATURE_CANDIDATE_NOT_FOUND/);

    await repository.confirmRefetchedLiterature(owner, candidate());
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      title: "A Conflicting Work",
      year: 2024
    })), /LITERATURE_IDENTITY_CONFLICT/);
  } finally {
    db.close();
  }
});

test("SQLite rejects versionless arXiv primaries even when a DOI is also present", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "arxiv:arxiv_id:2401.01234",
      identifiers: [
        { kind: "arxiv_id", source: "public_registry", value: "2401.01234" },
        { kind: "doi", source: "public_registry", value: "10.1000/secondary" }
      ],
      provider: "arxiv"
    })), /LITERATURE_CANDIDATE_NOT_FOUND/);
  } finally {
    db.close();
  }
});

test("SQLite fails closed when a confirmed status has no valid concrete identifier", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const now = "2026-08-11T00:00:00.000Z";
    db.prepare(`INSERT INTO literature_records_v2(
      id, title, authors_json, publication_year, version_kind, record_source,
      source_provider, confirmed_at, revision, confirmation_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'public_registry', ?, ?, 1, 'confirmed', ?, ?)`).run(
      "corrupt-confirmed", "Corrupt Confirmed", JSON.stringify(["Author"]), 2026,
      "publication", "crossref", now, now, now
    );
    db.prepare(`INSERT INTO literature_identifiers_v2(
      id, literature_id, identifier_kind, identifier_role, normalized_value,
      is_legacy_alias, created_at
    ) VALUES (?, ?, 'doi', 'confirmable', ?, 0, ?)`).run(
      "corrupt-doi", "corrupt-confirmed", "not-a-doi", now
    );

    assert.equal(await repository.findLiteratureById("corrupt-confirmed"), null);
    assert.equal(await repository.findLiteratureByIdentifiers([{
      kind: "doi",
      value: "10.1000/not-present"
    }]), null);
    assert.equal(await repository.verifyLiteratureProjection("corrupt-confirmed", 1), null);
  } finally {
    db.close();
  }
});

test("SQLite rejects a compatibility alias as the provider primary identifier", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const fingerprint = `sha256:${"b".repeat(64)}`;
    await assert.rejects(() => repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: `openalex:title_authors_year_hash:${fingerprint}`,
      identifiers: [
        { kind: "title_authors_year_hash", source: "public_registry", value: fingerprint },
        { kind: "openalex_id", source: "public_registry", value: "W123" }
      ],
      provider: "openalex"
    })), /LITERATURE_CANDIDATE_NOT_FOUND/);
  } finally {
    db.close();
  }
});

test("SQLite stores confirmable identifiers and candidate aliases with explicit roles", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const fingerprint = `sha256:${"d".repeat(64)}`;
    await repository.confirmRefetchedLiterature(owner, candidate({
      identifiers: [
        { kind: "doi", source: "public_registry", value: "10.1000/verified" },
        { kind: "title_authors_year_hash", source: "public_registry", value: fingerprint }
      ]
    }));
    assert.deepEqual(db.prepare("SELECT identifier_kind, identifier_role FROM literature_identifiers_v2 ORDER BY identifier_kind").all(), [
      { identifier_kind: "doi", identifier_role: "confirmable" },
      { identifier_kind: "title_authors_year_hash", identifier_role: "candidate_alias" }
    ]);
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
    assert.equal(db.prepare("SELECT count(*) AS count FROM literature_identifiers_v2 WHERE literature_id = ?").get(first.literatureId).count, 4);
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
    db.prepare("UPDATE literature_records_v2 SET confirmation_status = 'legacy_unverified' WHERE id = ?").run(first.literatureId);
    db.prepare(`UPDATE literature_identity_claims_v2 SET evidence_json = ? WHERE identifier_id IN (
      SELECT id FROM literature_identifiers_v2 WHERE literature_id = ?
    )`).run(JSON.stringify({ migration: "sqlite_source_confirmed_identity" }), first.literatureId);

    const refreshed = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "openalex:openalex_id:W123",
      identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W123" }],
      provider: "openalex"
    }));

    assert.equal(refreshed.status, "confirmed");
    const claim = db.prepare(`SELECT evidence_json FROM literature_identity_claims_v2 WHERE identifier_id IN (
      SELECT id FROM literature_identifiers_v2 WHERE literature_id = ?
    )`).get(first.literatureId);
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
      candidateKey: "arxiv:arxiv_id:2401.01234v1",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v1" }],
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

test("SQLite creates an evidenced preprint relation when the target version is confirmed later", async () => {
  const db = new Database(":memory:");
  try {
    const repository = new SqliteAnnotationCommunityRepository(db);
    const preprint = await repository.confirmRefetchedLiterature(owner, {
      ...candidate({
        candidateKey: "arxiv:arxiv_id:2401.01234v1",
        documentType: "preprint",
        identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v1" }],
        provider: "arxiv"
      }),
      relations: [{
        direction: "from_current",
        evidence: { sourceField: "arxiv:doi" },
        relationType: "is_preprint_of",
        targetIdentifier: { kind: "doi", value: "10.1000/publication" }
      }]
    });
    const publication = await repository.confirmRefetchedLiterature(owner, candidate({
      candidateKey: "crossref:doi:10.1000/publication",
      documentType: "publication",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }]
    }));

    assert.notEqual(preprint.literatureId, publication.literatureId);
    assert.deepEqual((await repository.findLiteratureRelations(preprint.literatureId)).map((relation) => ({
      ...relation,
      createdAt: "timestamp"
    })), [{
      createdAt: "timestamp",
      evidence: {
        candidateKey: "arxiv:arxiv_id:2401.01234v1",
        sourceField: "arxiv:doi",
        targetIdentifier: { kind: "doi", value: "10.1000/publication" }
      },
      fromLiteratureId: preprint.literatureId,
      provider: "arxiv",
      relationType: "is_preprint_of",
      toLiteratureId: publication.literatureId,
      verificationStatus: "confirmed"
    }]);
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
        { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:123" },
        { kind: "doi", source: "public_registry", value: "10.1000/publication" },
        { kind: "arxiv_id", source: "public_registry", value: "2401.01234v1" }
      ],
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:123",
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
  const artifacts = [];
  const records = new Map();
  const identifiers = [];
  const claims = [];
  const relations = [];
  const versions = [];
  const client = {
    async query(sql, values = []) {
      const query = sql.trim();
      if (query.startsWith("BEGIN ") || query === "COMMIT" || query === "ROLLBACK" || query.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (query.includes("FROM literature_identifiers") && query.includes("identifier_kind = ANY")) {
        return { rows: identifiers.filter((item) => values[0].includes(item.identifier_kind)) };
      }
      if (query.startsWith("SELECT literature_id FROM literature_identifiers")) {
        return { rows: identifiers.filter((item) => values[0].includes(item.literature_id)).map((item) => ({ literature_id: item.literature_id })) };
      }
      if (query.startsWith("SELECT DISTINCT identifier.literature_id")) {
        return {
          rows: claims.filter((claim) => claim.provider !== values[0] &&
            (values[1].includes(values[0]) || values[1].includes(claim.provider)))
            .filter((claim) => records.get(claim.literature_id)?.publication_year === values[2])
            .map((claim) => ({ literature_id: claim.literature_id }))
        };
      }
      if (query.startsWith("SELECT identifier.literature_id, claim.identifier_id")) {
        return { rows: claims.filter((item) => item.provider === values[0] && item.provider_record_id === values[1]) };
      }
      if (query.startsWith("SELECT * FROM literature_records WHERE id = $1")) {
        const record = records.get(values[0]);
        return { rows: record ? [{ ...record }] : [] };
      }
      if (query.startsWith("INSERT INTO literature_records(")) {
        const now = values[6];
        records.set(values[0], {
          authors: JSON.parse(values[2]), confirmed_at: now, confirmation_status: "confirmed", id: values[0],
          publication_year: values[3], record_source: "public_registry",
          revision: 1, source_provider: values[5], title: values[1], updated_at: now,
          version_kind: values[4]
        });
        return { rows: [] };
      }
      if (query.startsWith("UPDATE literature_records SET title")) {
        const record = records.get(values[0]);
        records.set(values[0], {
          ...record,
          authors: JSON.parse(values[2]),
          confirmed_at: values[6],
          confirmation_status: "confirmed",
          publication_year: values[3],
          record_source: "public_registry",
          revision: values[7],
          source_provider: values[5],
          title: values[1],
          updated_at: values[8],
          version_kind: values[4]
        });
        return { rows: [] };
      }
      if (query.startsWith("SELECT identifier_kind AS kind")) {
        return { rows: identifiers.filter((item) => item.literature_id === values[0]).map((item) => ({ kind: item.identifier_kind, source: "public_registry", value: item.normalized_value })) };
      }
      if (query.startsWith("SELECT id, identifier_kind AS kind")) {
        return { rows: identifiers.filter((item) => item.literature_id === values[0]).map((item) => ({ id: item.id, kind: item.identifier_kind, value: item.normalized_value })) };
      }
      if (query.startsWith("SELECT identity_kind AS kind")) return { rows: [] };
      if (query.startsWith("INSERT INTO literature_identifiers")) {
        const duplicateOwner = identifiers.some((item) => item.literature_id === values[1] &&
          item.identifier_kind === values[2] && item.normalized_value === values[4]);
        const duplicateConfirmable = values[3] === "confirmable" && identifiers.some((item) =>
          item.identifier_role === "confirmable" && item.identifier_kind === values[2] && item.normalized_value === values[4]);
        if (!duplicateOwner && !duplicateConfirmable) {
          identifiers.push({
            id: values[0],
            identifier_kind: values[2],
            identifier_role: values[3],
            literature_id: values[1],
            normalized_value: values[4]
          });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_identity_claims")) {
        const existing = claims.find((item) => item.provider === values[2] && item.provider_record_id === values[3]);
        const identifier = identifiers.find((item) => item.id === values[1]);
        if (existing) {
          if (existing.literature_id === values[6]) {
            existing.identifier_id = values[1];
            existing.evidence = JSON.parse(values[4]);
            existing.observed_at = values[5];
          }
        } else {
          claims.push({
            evidence: JSON.parse(values[4]),
            identifier_id: values[1],
            literature_id: identifier.literature_id,
            observed_at: values[5],
            provider: values[2],
            provider_record_id: values[3],
            verification_status: "confirmed"
          });
        }
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO literature_source_artifacts")) {
        if (!artifacts.some((artifact) => artifact.artifact_hash === values[0])) {
          artifacts.push({
            artifact_hash: values[0],
            artifact_url: values[1],
            byte_length: values[4],
            content: values[3],
            media_type: values[2]
          });
        }
        return { rows: [] };
      }
      if (query.startsWith("SELECT claim.provider, claim.evidence, identifier.literature_id")) {
        return { rows: claims.filter((claim) => Array.isArray(claim.evidence?.relations)) };
      }
      if (query.startsWith("SELECT claim.provider, claim.provider_record_id")) {
        return { rows: claims.filter((claim) => claim.literature_id === values[0]).map((claim) => {
          const identifier = identifiers.find((item) => item.id === claim.identifier_id);
          return {
            ...claim,
            identifier_kind: identifier.identifier_kind,
            identifier_role: identifier.identifier_role,
            normalized_value: identifier.normalized_value
          };
        }) };
      }
      if (query.startsWith("SELECT literature.id") && query.includes("identifier.identifier_kind")) {
        const identifier = identifiers.find((item) => item.identifier_kind === values[0] && item.normalized_value === values[1]);
        return { rows: identifier && records.get(identifier.literature_id)?.confirmation_status === "confirmed" ? [{ id: identifier.literature_id }] : [] };
      }
      if (query.startsWith("INSERT INTO literature_relations")) {
        if (!relations.some((item) => item.from_literature_id === values[1] && item.to_literature_id === values[2] && item.relation_type === values[3])) {
          relations.push({
            evidence: JSON.parse(values[5]),
            from_literature_id: values[1],
            provider: values[4],
            relation_type: values[3],
            to_literature_id: values[2]
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
  return { artifacts, claims, identifiers, records, relations, repository: new PostgresAnnotationCommunityRepository(pool), versions };
}

test("PostgreSQL confirmation stores one identifier owner and one provider claim", async () => {
  const harness = postgresHarness();
  const record = await harness.repository.confirmRefetchedLiterature(owner, candidate());

  assert.equal(record.status, "confirmed");
  assert.equal(record.revision, 1);
  assert.equal(harness.records.size, 1);
  assert.deepEqual(harness.identifiers.map(({ id: _id, ...identifier }) => identifier), [
    {
      identifier_kind: "doi",
      identifier_role: "confirmable",
      literature_id: record.literatureId,
      normalized_value: "10.1000/verified"
    },
    {
      identifier_kind: "title_authors_year_hash",
      identifier_role: "candidate_alias",
      literature_id: record.literatureId,
      normalized_value: "sha256:42b41d09d804fbbd3e7921ae50a0564104a76155862756c0f35e90b327e7e93a"
    }
  ]);
  assert.deepEqual(harness.claims.map(({ identifier_id: _identifierId, ...claim }) => claim), [{
    evidence: {
      candidateKey: "crossref:doi:10.1000/verified",
      confirmationBasis: "primary_registry_refetch",
      recordUrl: "https://registry.example.test/record",
      sourceTier: "primary"
    },
    literature_id: record.literatureId,
    observed_at: harness.claims[0].observed_at,
    provider: "crossref",
    provider_record_id: "10.1000/verified",
    verification_status: "confirmed"
  }]);
  assert.deepEqual(harness.versions, [{
    changedBy: "literature_resolver",
    literatureId: record.literatureId,
    revision: 1
  }]);
  assert.equal(harness.versions[0].changedBy, "literature_resolver");
  assert.deepEqual((await harness.repository.findLiteratureClaims(record.literatureId)).map((claim) => ({
    identifier: claim.identifier,
    provider: claim.provider,
    providerRecordId: claim.providerRecordId,
    verificationStatus: claim.verificationStatus
  })), [{
    identifier: {
      kind: "doi",
      role: "confirmable",
      source: "public_registry",
      value: "10.1000/verified"
    },
    provider: "crossref",
    providerRecordId: "10.1000/verified",
    verificationStatus: "confirmed"
  }]);
});

test("PostgreSQL stores audited PMLR evidence as a primary claim", async () => {
  const harness = postgresHarness();
  const sourceEvidence = pmlrSourceEvidence(235, "verified24a");
  const record = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "pmlr:pmlr_id:v235/verified24a",
    documentType: "conference-paper",
    identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/verified24a" }],
    provider: "pmlr",
    sourceEvidence
  }));

  assert.equal(record.status, "confirmed");
  assert.equal(harness.claims[0].evidence.sourceTier, "primary");
  assert.deepEqual(harness.claims[0].evidence.sourceEvidence, sourceEvidence);
});

test("PostgreSQL preserves a content-addressed PMLR volume snapshot", async () => {
  const harness = postgresHarness();
  const content = Buffer.from("@InProceedings{pmlr-v235-replayable24a}");
  const artifactHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const sourceEvidence = {
    ...pmlrSourceEvidence(235, "replayable24a"),
    artifactHash
  };
  const verified = candidate({
    candidateKey: "pmlr:pmlr_id:v235/replayable24a",
    documentType: "conference-paper",
    identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/replayable24a" }],
    provider: "pmlr",
    sourceEvidence
  });
  Object.defineProperty(verified, "sourceArtifact", {
    enumerable: false,
    value: {
      artifactUrl: sourceEvidence.artifactUrl,
      content,
      mediaType: "application/x-bibtex"
    }
  });

  await harness.repository.confirmRefetchedLiterature(owner, verified);

  assert.deepEqual(harness.artifacts, [{
    artifact_hash: artifactHash,
    artifact_url: sourceEvidence.artifactUrl,
    byte_length: content.byteLength,
    content,
    media_type: "application/x-bibtex"
  }]);
});

test("PostgreSQL rejects a compatibility alias as the provider primary identifier", async () => {
  const harness = postgresHarness();
  const fingerprint = `sha256:${"b".repeat(64)}`;
  await assert.rejects(() => harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: `openalex:title_authors_year_hash:${fingerprint}`,
    identifiers: [
      { kind: "title_authors_year_hash", source: "public_registry", value: fingerprint },
      { kind: "openalex_id", source: "public_registry", value: "W123" }
    ],
    provider: "openalex"
  })), /LITERATURE_CANDIDATE_NOT_FOUND/);
});

test("PostgreSQL stores confirmable identifiers and candidate aliases with explicit roles", async () => {
  const harness = postgresHarness();
  const fingerprint = `sha256:${"d".repeat(64)}`;
  await harness.repository.confirmRefetchedLiterature(owner, candidate({
    identifiers: [
      { kind: "doi", source: "public_registry", value: "10.1000/verified" },
      { kind: "title_authors_year_hash", source: "public_registry", value: fingerprint }
    ]
  }));
  assert.deepEqual(harness.identifiers.map((identifier) => ({
    kind: identifier.identifier_kind,
    role: identifier.identifier_role
  })).sort((left, right) => left.kind.localeCompare(right.kind)), [
    { kind: "doi", role: "confirmable" },
    { kind: "title_authors_year_hash", role: "candidate_alias" }
  ]);
});

test("PostgreSQL keeps bibliography aliases non-owning and rejects versionless arXiv primaries", async () => {
  const harness = postgresHarness();
  const first = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "crossref:doi:10.1000/first",
    documentType: "journal-article",
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/first" }],
    title: "Shared Bibliography"
  }));
  const second = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "crossref:doi:10.1000/second",
    documentType: "journal-article",
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/second" }],
    title: "Shared Bibliography"
  }));
  const bibliographyAliases = harness.identifiers.filter((identifier) =>
    identifier.identifier_kind === "title_authors_year_hash");

  assert.notEqual(second.literatureId, first.literatureId);
  assert.equal(bibliographyAliases.length, 2);
  assert.equal(await harness.repository.findLiteratureByIdentifiers([{
    kind: "title_authors_year_hash",
    value: bibliographyAliases[0].normalized_value
  }]), null);
  await assert.rejects(() => harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "arxiv:arxiv_id:2401.01234",
    identifiers: [
      { kind: "arxiv_id", source: "public_registry", value: "2401.01234" },
      { kind: "doi", source: "public_registry", value: "10.1000/secondary" }
    ],
    provider: "arxiv"
  })), /LITERATURE_CANDIDATE_NOT_FOUND/);
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
  assert.equal(harness.identifiers.length, 3);
  assert.equal(harness.claims.length, 2);
});

test("PostgreSQL applies the aggregate corroboration rule to DBLP", async () => {
  const harness = postgresHarness();
  const openAlex = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W2026001",
    documentType: "conference-paper",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W2026001" }],
    provider: "openalex"
  }));
  const dblp = await harness.repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
    candidateKey: "dblp:dblp_key:conf/icml/Verified26",
    documentType: "conference-paper",
    identifiers: [{ kind: "dblp_key", source: "public_registry", value: "conf/icml/Verified26" }],
    provider: "dblp"
  }));

  assert.equal(dblp.literatureId, openAlex.literatureId);
  assert.equal(harness.records.size, 1);
  assert.equal(harness.claims.find((claim) => claim.provider === "dblp").evidence.confirmationBasis, "independent_provider_bibliography");
});

test("PostgreSQL reuses one version when primary and aggregate providers independently confirm the same bibliography", async () => {
  const harness = postgresHarness();
  const openAlex = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W321",
    documentType: "article",
    identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W321" }],
    provider: "openalex"
  }));
  const crossref = await harness.repository.confirmRefetchedLiterature({ id: "another-owner" }, candidate({
    candidateKey: "crossref:doi:10.1000/independent",
    documentType: "journal-article",
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/independent" }],
    provider: "crossref"
  }));

  assert.equal(crossref.literatureId, openAlex.literatureId);
  assert.equal(harness.records.size, 1);
  assert.equal(harness.claims.find((claim) => claim.provider === "crossref").evidence.confirmationBasis, "independent_provider_bibliography");
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

test("PostgreSQL binds Crossref, OpenAlex, and Semantic Scholar DOI claims to one identifier", async () => {
  const harness = postgresHarness();
  const crossref = await harness.repository.confirmRefetchedLiterature(owner, candidate());
  const openAlex = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [
      { kind: "openalex_id", source: "public_registry", value: "W123" },
      { kind: "doi", source: "public_registry", value: "10.1000/verified" }
    ],
    provider: "openalex"
  }));
  const semanticScholar = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
    identifiers: [
      { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" },
      { kind: "doi", source: "public_registry", value: "10.1000/verified" }
    ],
    provider: "semantic_scholar"
  }));

  assert.equal(openAlex.literatureId, crossref.literatureId);
  assert.equal(semanticScholar.literatureId, crossref.literatureId);
  const doiIdentifier = harness.identifiers.find((identifier) => identifier.identifier_kind === "doi");
  assert.deepEqual(harness.claims.map((claim) => ({
    identifierId: claim.identifier_id,
    provider: claim.provider
  })).sort((left, right) => left.provider.localeCompare(right.provider)), [
    { identifierId: doiIdentifier.id, provider: "crossref" },
    { identifierId: doiIdentifier.id, provider: "openalex" },
    { identifierId: doiIdentifier.id, provider: "semantic_scholar" }
  ]);
});

test("PostgreSQL stores independently corroborated aggregate claims in one confirmation transaction", async () => {
  const harness = postgresHarness();
  const record = await harness.repository.confirmRefetchedLiterature(owner, {
    ...candidate({
      candidateKey: "openalex:openalex_id:W123",
      documentType: "article",
      identifiers: [
        { kind: "openalex_id", source: "public_registry", value: "W123" },
        { kind: "doi", source: "public_registry", value: "10.1000/shared" }
      ],
      provider: "openalex"
    }),
    corroborations: [candidate({
      candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
      documentType: "publication",
      identifiers: [
        { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:456" },
        { kind: "doi", source: "public_registry", value: "10.1000/shared" }
      ],
      provider: "semantic_scholar"
    })]
  });

  assert.equal(record.revision, 1);
  const doiIdentifier = harness.identifiers.find((identifier) => identifier.identifier_kind === "doi");
  assert.deepEqual(harness.claims.map((claim) => ({ identifierId: claim.identifier_id, provider: claim.provider })), [
    { identifierId: doiIdentifier.id, provider: "openalex" },
    { identifierId: doiIdentifier.id, provider: "semantic_scholar" }
  ]);
});

test("PostgreSQL records a new provider claim without changing an otherwise identical literature revision", async () => {
  const harness = postgresHarness();
  const identifiers = [
    { kind: "openalex_id", source: "public_registry", value: "W777" },
    { kind: "semantic_scholar_id", source: "public_registry", value: "corpus:777" }
  ];
  const first = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "openalex:openalex_id:W777",
    identifiers,
    provider: "openalex"
  }));
  const second = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:777",
    identifiers: [identifiers[1], identifiers[0]],
    provider: "semantic_scholar"
  }));

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(harness.records.values().next().value.source_provider, "openalex");
  assert.equal(harness.claims.length, 2);
});

test("PostgreSQL backfills an evidenced preprint relation when the target is confirmed later", async () => {
  const harness = postgresHarness();
  const preprint = await harness.repository.confirmRefetchedLiterature(owner, {
    ...candidate({
      candidateKey: "arxiv:arxiv_id:2401.01234v1",
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v1" }],
      provider: "arxiv"
    }),
    relations: [{
      direction: "from_current",
      evidence: { sourceField: "arxiv:doi" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "doi", value: "10.1000/publication" }
    }]
  });
  const publication = await harness.repository.confirmRefetchedLiterature(owner, candidate({
    candidateKey: "crossref:doi:10.1000/publication",
    documentType: "publication",
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }]
  }));

  assert.deepEqual(harness.relations, [{
    evidence: {
      candidateKey: "arxiv:arxiv_id:2401.01234v1",
      sourceField: "arxiv:doi",
      targetIdentifier: { kind: "doi", value: "10.1000/publication" }
    },
    from_literature_id: preprint.literatureId,
    provider: "arxiv",
    relation_type: "is_preprint_of",
    to_literature_id: publication.literatureId
  }]);
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
  harness.records.get(openAlex.literatureId).confirmation_status = "legacy_unverified";
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

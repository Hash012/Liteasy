import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { literatureRecordSchema } from "@intuecho/contracts";
import { desktopAnnotationPublicationDigest, SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";
import { createIntuechoApp } from "./server.mjs";
import { IdentityVerificationError } from "./identityVerifier.mjs";

const identities = new Map([
  ["user-token", { id: "user-1", name: "林立", initials: "LL" }],
  ["same-name-token", { id: "user-2", name: "林立", initials: "LL" }],
  ["third-token", { id: "user-3", name: "第三位研究者", initials: "第三" }],
  ["fourth-token", { id: "user-4", name: "第四位研究者", initials: "第四" }]
]);
const userHeader = { authorization: "Bearer user-token" };
const sameNameHeader = { authorization: "Bearer same-name-token" };
const thirdHeader = { authorization: "Bearer third-token" };
const fourthHeader = { authorization: "Bearer fourth-token" };
const adminHeader = { authorization: "Bearer admin-token" };
const desktopHeader = { authorization: "Bearer desktop-token" };
const otherDesktopHeader = { authorization: "Bearer other-desktop-token" };
const literatureServiceHeader = { authorization: "Bearer literature-service-token" };

async function identityVerifier(token) {
  const identity = identities.get(token);
  if (!identity) throw new IdentityVerificationError("INVALID_SESSION", "登录会话无效或已过期。", 401);
  return identity;
}

async function adminIdentityVerifier(token) {
  if (token !== "admin-token") {
    throw new IdentityVerificationError("ADMIN_AUTH_REQUIRED", "需要平台管理员登录。", 401);
  }
  return { id: "admin-1", name: "平台管理员", initials: "平台" };
}

async function desktopIdentityVerifier(token) {
  if (token === "desktop-token") return identities.get("user-token");
  if (token === "other-desktop-token") return identities.get("same-name-token");
  throw new IdentityVerificationError("INVALID_SESSION_AUDIENCE", "当前会话不适用于 Intuecho。", 403);
}

async function literatureServiceIdentityVerifier(token) {
  if (token === "literature-service-token") {
    return { clientId: "liteasy-literature-service", id: "liteasy-literature-service" };
  }
  throw new IdentityVerificationError("INVALID_SESSION_AUDIENCE", "当前会话不适用于 Intuecho。", 403);
}

function insertFixture(db) {
  db.prepare("INSERT INTO topics (id, name, description, guide, follower_count) VALUES (?, ?, ?, ?, ?)")
    .run("topic-1", "可靠性", "讨论证据边界。", "由社区共同维护。", 0);
  db.prepare("INSERT INTO works (id, topic_id, title, authors, year, venue, identifier, abstract) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("work-1", "topic-1", "A Reliable Paper", "Author", 2025, "Venue", "doi:1", "Abstract");
  db.prepare("INSERT INTO posts (id, topic_id, work_id, title, body, author_id, author_name, author_initials, page, excerpt, anchor_hash, helpful, misleading, created_at, withdrawn_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
    .run("post-1", "topic-1", "work-1", "证据边界", "一条真实测试帖子。", "author-1", "作者甲", "A", 2, "source", "sha256:source", 1, 0, "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO comments (id, post_id, body, author_id, author_name, author_initials, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("comment-1", "post-1", "一条测试讨论。", "author-2", "作者乙", "B", "2026-01-01T01:00:00.000Z");
  const now = "2026-08-09T00:00:00.000Z";
  db.prepare(`INSERT INTO literature_records_v2(id, title, authors_json, publication_year, version_kind, record_source, source_provider, confirmed_at, revision, confirmation_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'public_registry', 'crossref', ?, 1, 'confirmed', ?, ?)`)
    .run("literature-1", "A Reliable Paper", JSON.stringify(["Author"]), 2025, "journal_article", now, now, now);
  db.prepare("INSERT INTO literature_identifiers_v2(id, literature_id, identifier_kind, identifier_role, normalized_value, is_legacy_alias, created_at) VALUES (?, ?, 'doi', 'confirmable', ?, 0, ?)")
    .run("identifier-fixture-1", "literature-1", "10.1000/reliable", now);
  db.prepare("INSERT INTO literature_identity_claims_v2(id, identifier_id, provider, provider_record_id, verification_status, evidence_json, observed_at, created_at) VALUES (?, ?, 'crossref', ?, 'confirmed', '{}', ?, ?)")
    .run("claim-fixture-1", "identifier-fixture-1", "10.1000/reliable", now, now);
}

async function withApp(run, {
  adminIdentityVerifier: selectedAdminIdentityVerifier = adminIdentityVerifier,
  authorizeOrganizationAccess,
  authorizeOrganizationInvitation,
  authorizeOrganizationVisibility,
  listOrganizations,
  desktopIdentityVerifier: selectedDesktopIdentityVerifier = desktopIdentityVerifier,
  fixture = true,
  identityVerifier: selectedIdentityVerifier = identityVerifier,
  literatureServiceIdentityVerifier: selectedLiteratureServiceIdentityVerifier = literatureServiceIdentityVerifier,
  literatureRateLimiter,
  literatureResolver
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "intuecho-test-"));
  const databasePath = join(directory, "test.db");
  const { app, db } = await createIntuechoApp({
    adminIdentityVerifier: selectedAdminIdentityVerifier,
    authorizeOrganizationAccess,
    authorizeOrganizationInvitation,
    authorizeOrganizationVisibility,
    listOrganizations,
    databasePath,
    desktopIdentityVerifier: selectedDesktopIdentityVerifier,
    identityVerifier: selectedIdentityVerifier,
    literatureServiceIdentityVerifier: selectedLiteratureServiceIdentityVerifier,
    literatureRateLimiter,
    literatureResolver
  });
  if (fixture) insertFixture(db);
  try {
    await run(app, db, databasePath);
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function literatureResolver(overrides = {}) {
  return {
    async confirm(owner, input) {
      return {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/reliable" }],
        literatureId: "literature-1",
        provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
        revision: 1,
        status: "confirmed",
        title: `Confirmed for ${owner.id}`
      };
    },
    async resolve(owner, input) {
      return {
        candidate: {
          candidateKey: "crossref:doi:10.1000/reliable",
          provider: "crossref",
          record: {
            authors: ["Ada Lovelace"],
            identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/reliable" }],
            title: `Reliable for ${owner.id}`
          }
        },
        status: "exact",
        unavailableProviders: []
      };
    },
    async relations(literatureId) {
      return {
        claims: [{
          evidence: { confirmationBasis: "primary_registry_refetch", sourceTier: "primary" },
          identifier: { kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/reliable" },
          observedAt: "2026-08-09T00:00:00.000Z",
          provider: "crossref",
          providerRecordId: "10.1000/reliable",
          verificationStatus: "confirmed"
        }],
        literatureId,
        versions: []
      };
    },
    ...overrides
  };
}

test("public literature routes accept Web sessions while rejecting anonymous and Desktop sessions", async () => {
  await withApp(async (app) => {
    const anonymous = await app.inject({
      method: "POST",
      payload: { purpose: "forum_compose", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error, "AUTH_REQUIRED");

    const web = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { purpose: "forum_compose", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(web.statusCode, 200, web.body);
    assert.equal(web.json().status, "exact");
    assert.equal(web.json().candidate.record.title, "Reliable for user-1");

    const desktop = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(desktop.statusCode, 401, desktop.body);
    assert.equal(desktop.json().error, "INVALID_SESSION");

    const confirmed = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { candidateKey: "crossref:doi:10.1000/reliable", mode: "candidate" },
      url: "/v1/literature:confirm"
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().literature.provenance.mode, "public_registry");
    assert.equal(confirmed.json().literature.status, "confirmed");

    const relations = await app.inject({
      headers: userHeader,
      method: "GET",
      url: "/v1/literature/literature-1/relations"
    });
    assert.equal(relations.statusCode, 200, relations.body);
    assert.equal(relations.json().claims[0].providerRecordId, "10.1000/reliable");
    assert.deepEqual(relations.json().versions, []);
  }, { literatureResolver: literatureResolver() });
});

test("internal literature routes use one service actor without receiving a Liteasy user", async () => {
  const calls = [];
  await withApp(async (app) => {
    const resolved = await app.inject({
      headers: literatureServiceHeader,
      method: "POST",
      payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/reliable" },
      url: "/v1/internal/literature:resolve"
    });
    assert.equal(resolved.statusCode, 200, resolved.body);

    const confirmed = await app.inject({
      headers: literatureServiceHeader,
      method: "POST",
      payload: { candidateKey: "crossref:doi:10.1000/reliable", mode: "candidate" },
      url: "/v1/internal/literature:confirm"
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);

    const relations = await app.inject({
      headers: literatureServiceHeader,
      method: "GET",
      url: "/v1/internal/literature/literature-1/relations"
    });
    assert.equal(relations.statusCode, 200, relations.body);
    assert.deepEqual(calls.map((call) => call.operation), ["resolve", "confirm", "relations"]);
    assert.deepEqual(calls.slice(0, 2).map((call) => call.owner), [
      { id: "liteasy-literature-service" },
      { id: "liteasy-literature-service" }
    ]);
    assert.equal(JSON.stringify(calls).includes("user-1"), false);
  }, {
    literatureResolver: {
      async confirm(owner, input) {
        calls.push({ input, operation: "confirm", owner });
        return literatureResolver().confirm(owner, input);
      },
      async relations(literatureId) {
        calls.push({ literatureId, operation: "relations" });
        return { literatureId, versions: [] };
      },
      async resolve(owner, input) {
        calls.push({ input, operation: "resolve", owner });
        return literatureResolver().resolve(owner, input);
      }
    }
  });
});

test("literature routes project invalid requests and resolver failures without provider details", async () => {
  await withApp(async (app) => {
    const invalid = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { purpose: "forum_compose" },
      url: "/v1/literature:resolve"
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "INVALID_LITERATURE_QUERY");

    const unavailable = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { candidateKey: "crossref:doi:10.1000/reliable", mode: "candidate" },
      url: "/v1/literature:confirm"
    });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().error, "LITERATURE_PROVIDER_UNAVAILABLE");
    assert.equal(unavailable.body.includes("server-only-key"), false);
  }, {
    literatureResolver: literatureResolver({
      async confirm() {
        const error = new Error("provider failed with server-only-key");
        error.code = "LITERATURE_PROVIDER_UNAVAILABLE";
        throw error;
      }
    })
  });
});

test("literature routes accept thirty calls then reject only that user and operation", async () => {
  await withApp(async (app) => {
    for (let call = 0; call < 30; call += 1) {
      const response = await app.inject({
        headers: userHeader,
        method: "POST",
        payload: { purpose: "forum_compose", query: "10.1000/reliable" },
        url: "/v1/literature:resolve"
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const limited = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { purpose: "forum_compose", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error, "LITERATURE_RATE_LIMITED");

    const confirm = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { candidateKey: "intuecho:literature-1", mode: "candidate" },
      url: "/v1/literature:confirm"
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
  }, { literatureResolver: literatureResolver() });
});

function annotationPayload(overrides = {}) {
  const identity = {
    id: "doi:10.1000/reliable",
    kind: "doi",
    source: "metadata",
    value: "10.1000/reliable"
  };
  return {
    annotationId: "annotation-1",
    body: "这条批注解释了证据边界。",
    createdAt: "2026-08-07T01:00:00.000Z",
    excerpt: "source evidence",
    paperIdentity: { primary: identity },
    queueKey: "paper-1:annotation-1",
    scope: { kind: "pdf_passage", page: 2, rects: [] },
    status: "pending_public",
    targets: [{
      anchorHash: "sha256:source",
      excerpt: "source evidence",
      kind: "source_passage",
      literature: { literatureId: "literature-1" },
      page: 2,
      rects: []
    }],
    updatedAt: "2026-08-07T01:00:00.000Z",
    ...overrides
  };
}

function publicationOperation(overrides = {}) {
  return {
    annotationId: "desktop-annotation-1",
    body: "这条桌面批注只引用已确认的文献记录。",
    literatureId: "literature-publication-1",
    operation: "upsert",
    queueKey: "paper-publication-1:desktop-annotation-1",
    revision: 1,
    sourcePassage: {
      anchorHash: "sha256:publication-source",
      excerpt: "A source passage retained by the desktop annotation.",
      page: 3,
      rects: []
    },
    updatedAt: "2026-08-09T01:00:00.000Z",
    ...overrides
  };
}

function insertConfirmedPublicationLiterature(db, literatureId = "literature-publication-1") {
  const now = "2026-08-09T00:00:00.000Z";
  db.prepare(`INSERT INTO literature_records_v2(
    id, title, authors_json, publication_year, version_kind, record_source,
    source_provider, confirmed_at, revision, confirmation_status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'public_registry', 'crossref', ?, 1, 'confirmed', ?, ?)`)
    .run(literatureId, "Server Confirmed Publication Literature", JSON.stringify(["Confirmed Author"]), 2026, "journal_article", now, now, now);
  db.prepare("INSERT INTO literature_identifiers_v2(id, literature_id, identifier_kind, identifier_role, normalized_value, is_legacy_alias, created_at) VALUES (?, ?, 'doi', 'confirmable', ?, 0, ?)")
    .run(`identifier-${literatureId}`, literatureId, "10.1000/confirmed-publication", now);
  return literatureId;
}

function postgresPublicationHarness({ missingLiteratureIds = [] } = {}) {
  const annotations = new Map();
  const missingLiterature = new Set(missingLiteratureIds);
  const publications = new Map();
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values });
      if (normalized.includes("SELECT 1 FROM account_deletion_jobs")) return { rows: [] };
      if (normalized.startsWith("SELECT * FROM desktop_annotation_publications")) {
        return { rows: publications.has(`${values[0]}:${values[1]}`) ? [publications.get(`${values[0]}:${values[1]}`)] : [] };
      }
      if (normalized.startsWith("SELECT * FROM literature_records")) {
        if (missingLiterature.has(values[0])) return { rows: [] };
        const now = new Date("2026-08-09T00:00:00.000Z");
        return { rows: [{ authors: ["Confirmed Author"], confirmation_status: "confirmed", confirmed_at: now, created_at: now, id: values[0], publication_year: 2026, record_source: "public_registry", revision: 1, source_provider: "crossref", title: "Confirmed Literature", updated_at: now, version_kind: "journal_article" }] };
      }
      if (normalized.startsWith("SELECT 1 FROM literature_records")) return { rows: [{ exists: 1 }] };
      if (normalized.startsWith("SELECT identifier_kind AS kind")) return { rows: [{ kind: "doi", source: "public_registry", value: "10.1000/confirmed-publication" }] };
      if (normalized.startsWith("SELECT education_stage")) return { rows: [] };
      if (normalized.startsWith("SELECT institution_name AS name")) return { rows: [] };
      if (normalized.startsWith("INSERT INTO annotations(")) {
        annotations.set(values[0], { body: values[1], id: values[0], revision: 1, share_to_plaza: true, visibility: "public" });
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT revision FROM annotations")) {
        const annotation = annotations.get(values[0]);
        return { rows: annotation ? [{ revision: annotation.revision }] : [] };
      }
      if (normalized.startsWith("UPDATE annotations SET body")) {
        annotations.set(values[0], { ...annotations.get(values[0]), body: values[1], revision: Number(values[5]), share_to_plaza: true, visibility: "public" });
        return { rows: [] };
      }
      if (normalized.startsWith("UPDATE annotations SET visibility")) {
        annotations.set(values[0], { ...annotations.get(values[0]), revision: Number(values[1]), share_to_plaza: false, visibility: "private" });
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT tags.id AS tag_id")) return { rows: [] };
      if (normalized.startsWith("INSERT INTO desktop_annotation_publications")) {
        const hasDigest = values.length === 9;
        publications.set(`${values[0]}:${values[1]}`, {
          annotation_id: values[3],
          operation_digest: hasDigest ? values[6] : null,
          owner_id: values[0],
          queue_key: values[1],
          remote_revision: Number(values[hasDigest ? 7 : 6]),
          source_annotation_id: values[2],
          source_revision: Number(values[4]),
          source_updated_at: new Date(values[5]),
          state: "published",
          synced_at: new Date(values[hasDigest ? 8 : 7])
        });
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return {
    annotations,
    publications,
    queries,
    repository: new PostgresAnnotationCommunityRepository({ async connect() { return client; } })
  };
}

function annotationV2Payload(overrides = {}) {
  const literature = { literatureId: "literature-1" };
  return {
    body: "这条批注解释了证据边界。",
    shareToPlaza: true,
    tags: ["证据"],
    targets: [{ kind: "whole_document", literature }],
    visibility: "public",
    ...overrides
  };
}

test("a new runtime database contains no demo or fixture content", async () => {
  await withApp(async (app) => {
    const topics = await app.inject({ method: "GET", url: "/v1/topics" });
    assert.equal(topics.statusCode, 200);
    assert.deepEqual(topics.json(), []);
  }, { fixture: false });
});

test("exposes only source-refetched confirmation and keeps versions append-only", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const owner = { id: "literature-owner", name: "Ada Lovelace", initials: "AL" };
  assert.equal(repository.confirmLiterature, undefined);
  const first = await repository.confirmRefetchedLiterature(owner, {
    candidateKey: "crossref:doi:10.1000/confirmed",
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/confirmed" }],
      title: "Confirmed Record",
      year: 1843
    }
  });
  assert.equal(first.provenance.mode, "public_registry");
  assert.equal((await repository.findLiteratureByIdentifiers(first.identifiers)).literatureId, first.literatureId);
  assert.equal((await repository.findLiteratureById(first.literatureId)).literatureId, first.literatureId);
  const version = db.prepare("SELECT revision, snapshot_json FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").get(first.literatureId);
  assert.equal(version.revision, 1);
  assert.equal(JSON.parse(version.snapshot_json).title, "Confirmed Record");
  assert.throws(
    () => db.prepare("UPDATE literature_record_versions_v2 SET changed_by = ? WHERE literature_id = ? AND revision = 1").run("tampered", first.literatureId),
    /literature_record_version_is_append_only/
  );
  assert.throws(
    () => db.prepare("DELETE FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").run(first.literatureId),
    /literature_record_version_is_append_only/
  );

  assert.equal(literatureRecordSchema.safeParse(first).success, true);
  db.close();
});

test("accepts only valid refetched candidates and resolves canonical targets", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const owner = { id: "candidate-owner", name: "Ada Lovelace", initials: "AL" };
  await assert.rejects(
    () => repository.confirmRefetchedLiterature(owner, {
      candidateKey: "candidate_1",
      provider: "crossref",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/canonical" }],
        title: "Spoofed Candidate",
        year: 1843
      }
    }),
    (error) => error?.code === "LITERATURE_CANDIDATE_NOT_FOUND"
  );
  const confirmed = await repository.confirmRefetchedLiterature(owner, {
    candidateKey: "crossref:doi:10.1000/canonical",
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/canonical" }],
      title: "Canonical Candidate",
      year: 1843
    }
  });
  const target = db.prepare("SELECT id FROM literature_records_v2 WHERE id = ?").get(confirmed.literatureId);
  assert.ok(target);
  assert.equal((await repository.syncDesktopAnnotations(owner, [{
    annotationId: "canonical-target-annotation",
    body: "canonical target",
    createdAt: "2026-08-09T00:00:00.000Z",
    queueKey: "canonical-target-queue",
    targets: [{ kind: "whole_document", literature: { literatureId: confirmed.literatureId } }],
    updatedAt: "2026-08-09T00:00:00.000Z"
  }]))[0].status, "synced");
  db.close();
});

test("hydrates canonical literature display metadata on annotation reads and title search", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const owner = { id: "hydration-owner", name: "Hydration Owner", initials: "HO" };
  const literature = await repository.confirmRefetchedLiterature(owner, {
    candidateKey: "crossref:doi:10.1000/hydrated",
    provider: "crossref",
    record: {
      authors: ["Canonical Author"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/hydrated" }],
      title: "Durable Canonical Title",
      year: 2026
    }
  });
  const annotation = await repository.createAnnotation(owner, {
    body: "The body does not repeat the title.",
    shareToPlaza: true,
    tags: [],
    targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }],
    visibility: "public"
  });
  assert.deepEqual(annotation.targets[0].literature.literatureRecord, literature);
  const feed = await repository.plaza(owner, { query: "Durable Canonical Title" });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].targets[0].literature.literatureRecord.title, "Durable Canonical Title");
  assert.deepEqual(JSON.parse(db.prepare("SELECT target_json FROM annotation_targets_v2 WHERE annotation_id = ?").get(annotation.id).target_json), {
    kind: "whole_document",
    literature: { literatureId: literature.literatureId }
  });
  await repository.updateAnnotation(annotation.id, owner, { body: "Updated without rewriting its target." });
  const version = JSON.parse(db.prepare("SELECT snapshot_json FROM annotation_versions_v2 WHERE annotation_id = ?").get(annotation.id).snapshot_json);
  assert.equal(version.targets[0].literature.literatureRecord, undefined);
  db.close();
});

test("does not create legacy identity storage on a clean database and removes manual confirmation", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  assert.equal(repository.confirmLiterature, undefined);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'literature_identities_v2'").get(), undefined);
  db.close();
});

test("legacy annotation routes reject metadata identity writes", async () => {
  await withApp(async (app, db) => {
    const created = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({
        targets: [{
          kind: "whole_document",
          literature: {
            identity: { id: "doi:10.1000/route-verified", kind: "doi", source: "metadata", value: "10.1000/route-verified" },
            metadata: { authors: ["Spoofed Author"], title: "Spoofed Verified Title", year: 1900 }
          }
        }]
      }),
      url: "/v1/annotations"
    });
    assert.equal(created.statusCode, 400, created.body);

    const synced = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: {
        annotations: [{
          annotationId: "legacy-canonical-protection",
          body: "Legacy sync must not rewrite canonical literature.",
          createdAt: "2026-08-09T01:00:00.000Z",
          queueKey: "legacy-canonical-protection",
          status: "pending_public",
          targets: [{
            kind: "whole_document",
            literature: {
              identity: { id: "doi:10.1000/route-manual", kind: "doi", source: "metadata", value: "10.1000/route-manual" },
              metadata: { authors: ["Spoofed Author"], title: "Spoofed Manual Title", year: 1901 }
            }
          }],
          updatedAt: "2026-08-09T01:00:00.000Z"
        }]
      },
      url: "/v1/thin-reading/annotations:sync"
    });
    assert.equal(synced.statusCode, 400, synced.body);
    assert.deepEqual(db.prepare("SELECT record_source, revision FROM literature_records_v2 WHERE id = ?").get("literature-1"), {
      record_source: "public_registry",
      revision: 1
    });
  });
});

test("annotation routes reject unsafe rectangle fields without persisting annotations or targets", async () => {
  await withApp(async (app, db) => {
    const payload = annotationV2Payload({
      targets: [{
        anchorHash: "sha256:unsafe-rectangle",
        excerpt: "Unsafe nested payloads must not cross the annotation boundary.",
        kind: "source_passage",
        literature: annotationV2Payload().targets[0].literature,
        page: 2,
        rects: [{ fullText: "must not persist", height: 40, left: 12, top: 24, width: 180 }]
      }]
    });
    const response = await app.inject({
      headers: userHeader,
      method: "POST",
      payload,
      url: "/v1/annotations"
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, "INVALID_ANNOTATION");
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2").get().count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_targets_v2").get().count, 0);
  });
});

test("derives desktop publication targets from confirmed literature instead of caller metadata", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const literatureId = insertConfirmedPublicationLiterature(db, "literature-trust-boundary");
  const [created] = repository.applyDesktopAnnotationPublications({
    id: "publication-owner",
    initials: "PO",
    name: "Publication Owner"
  }, [publicationOperation({
    literatureId,
    sourcePassage: {
      anchorHash: "sha256:trusted-source",
      excerpt: "Only canonical passage fields cross the repository boundary.",
      kind: "derived_passage",
      literature: { literatureId: "spoofed-literature" },
      page: 5,
      provenance: { provider: "spoofed-provider" },
      rects: [],
      title: "Spoofed title"
    }
  })]);
  assert.equal(created.state, "published");
  const target = JSON.parse(db.prepare("SELECT target_json FROM annotation_targets_v2 WHERE annotation_id = ?").get(created.remoteAnnotationId).target_json);
  assert.deepEqual(target, {
    anchorHash: "sha256:trusted-source",
    excerpt: "Only canonical passage fields cross the repository boundary.",
    kind: "source_passage",
    literature: { literatureId },
    page: 5,
    rects: []
  });
  db.close();
});

test("rejects divergent same-version desktop publications in SQLite", () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const literatureId = insertConfirmedPublicationLiterature(db, "literature-version-conflict");
  const author = { id: "publication-owner", initials: "PO", name: "Publication Owner" };
  const initial = publicationOperation({ literatureId, updatedAt: "2026-08-09T01:00:00.0000Z" });
  const [created] = repository.applyDesktopAnnotationPublications(author, [initial]);
  const [divergentUpsert] = repository.applyDesktopAnnotationPublications(author, [{
    ...initial,
    body: "A different body at the same source version.",
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(divergentUpsert.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const [divergentRetract] = repository.applyDesktopAnnotationPublications(author, [{
    annotationId: initial.annotationId,
    operation: "retract",
    queueKey: initial.queueKey,
    remoteAnnotationId: created.remoteAnnotationId,
    revision: initial.revision,
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(divergentRetract.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const batchInitial = publicationOperation({ annotationId: "batch-annotation", literatureId, queueKey: "batch-queue" });
  const batch = repository.applyDesktopAnnotationPublications(author, [batchInitial, { ...batchInitial, body: "Divergent intra-batch body." }]);
  assert.equal(batch[0].state, "published");
  assert.equal(batch[1].error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal(db.prepare("SELECT body FROM annotations_v2 WHERE id = ?").get(batch[0].remoteAnnotationId).body, batchInitial.body);
  assert.match(db.prepare("SELECT operation_digest FROM desktop_annotation_publications_v2 WHERE owner_id = ? AND queue_key = ?").get(author.id, initial.queueKey).operation_digest, /^[a-f0-9]{64}$/);
  db.close();
});

test("rejects divergent same-version desktop publications in PostgreSQL", async () => {
  const instance = postgresPublicationHarness();
  const author = { id: "publication-owner", initials: "PO", name: "Publication Owner" };
  const initial = publicationOperation({ updatedAt: "2026-08-09T01:00:00.0000Z" });
  const [created] = await instance.repository.applyDesktopAnnotationPublications(author, [initial]);
  const [divergentUpsert] = await instance.repository.applyDesktopAnnotationPublications(author, [{
    ...initial,
    body: "A different body at the same source version.",
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(divergentUpsert.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const [divergentRetract] = await instance.repository.applyDesktopAnnotationPublications(author, [{
    annotationId: initial.annotationId,
    operation: "retract",
    queueKey: initial.queueKey,
    remoteAnnotationId: created.remoteAnnotationId,
    revision: initial.revision,
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(divergentRetract.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const batchInitial = publicationOperation({ annotationId: "batch-annotation", queueKey: "batch-queue" });
  const batch = await instance.repository.applyDesktopAnnotationPublications(author, [batchInitial, { ...batchInitial, body: "Divergent intra-batch body." }]);
  assert.equal(batch[0].state, "published");
  assert.equal(batch[1].error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal(instance.annotations.get(batch[0].remoteAnnotationId).body, batchInitial.body);
  assert.match(instance.publications.get(`${author.id}:${initial.queueKey}`).operation_digest, /^[a-f0-9]{64}$/);
});

test("SQLite desktop publication batches preserve domain failures while committing valid operations", () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const literatureId = insertConfirmedPublicationLiterature(db, "literature-mixed-sqlite");
  const author = { id: "mixed-sqlite-owner", initials: "MS", name: "Mixed SQLite Owner" };
  const results = repository.applyDesktopAnnotationPublications(author, [
    publicationOperation({ annotationId: "mixed-sqlite-a", literatureId, queueKey: "mixed-sqlite-a" }),
    publicationOperation({ annotationId: "mixed-sqlite-missing", literatureId: "missing-literature", queueKey: "mixed-sqlite-missing" }),
    publicationOperation({ annotationId: "mixed-sqlite-b", literatureId, queueKey: "mixed-sqlite-b" })
  ]);

  assert.deepEqual(results.map((result) => result.state ?? result.error), ["published", "LITERATURE_NOT_FOUND", "published"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM desktop_annotation_publications_v2 WHERE owner_id = ?").get(author.id).count, 2);
  db.close();
});

test("PostgreSQL desktop publication batches preserve domain failures while committing valid operations", async () => {
  const instance = postgresPublicationHarness({ missingLiteratureIds: ["missing-literature"] });
  const author = { id: "mixed-postgres-owner", initials: "MP", name: "Mixed PostgreSQL Owner" };
  const results = await instance.repository.applyDesktopAnnotationPublications(author, [
    publicationOperation({ annotationId: "mixed-postgres-a", queueKey: "mixed-postgres-a" }),
    publicationOperation({ annotationId: "mixed-postgres-missing", literatureId: "missing-literature", queueKey: "mixed-postgres-missing" }),
    publicationOperation({ annotationId: "mixed-postgres-b", queueKey: "mixed-postgres-b" })
  ]);

  assert.deepEqual(results.map((result) => result.state ?? result.error), ["published", "LITERATURE_NOT_FOUND", "published"]);
  assert.equal(instance.publications.size, 2);
});

test("SQLite rolls back an entire desktop publication batch after a late database failure", () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const literatureId = insertConfirmedPublicationLiterature(db, "literature-rollback-sqlite");
  const author = { id: "rollback-sqlite-owner", initials: "RS", name: "Rollback SQLite Owner" };
  db.exec(`
    CREATE TRIGGER fail_late_desktop_publication_v2
    BEFORE INSERT ON desktop_annotation_publications_v2
    WHEN NEW.queue_key = 'rollback-sqlite-b'
    BEGIN
      SELECT RAISE(ABORT, 'injected_late_publication_failure');
    END;
  `);

  assert.throws(() => repository.applyDesktopAnnotationPublications(author, [
    publicationOperation({ annotationId: "rollback-sqlite-a", literatureId, queueKey: "rollback-sqlite-a" }),
    publicationOperation({ annotationId: "rollback-sqlite-b", literatureId, queueKey: "rollback-sqlite-b" })
  ]), /injected_late_publication_failure/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM desktop_annotation_publications_v2 WHERE owner_id = ?").get(author.id).count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2 WHERE author_id = ?").get(author.id).count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_targets_v2").get().count, 0);
  db.close();
});

test("PostgreSQL repository does not expose a manual confirmation method", () => {
  const repository = new PostgresAnnotationCommunityRepository({});
  assert.equal(repository.confirmLiterature, undefined);
  assert.equal(typeof repository.confirmRefetchedLiterature, "function");
});

test("replays PostgreSQL desktop publications when updated timestamps identify the same instant", async () => {
  const queries = [];
  const replayOperation = publicationOperation({
    revision: 2,
    updatedAt: "2026-08-09T02:00:00.0000Z"
  });
  const prior = {
    annotation_id: "annotation-remote-1",
    operation_digest: desktopAnnotationPublicationDigest(replayOperation),
    owner_id: "user-1",
    queue_key: "paper-publication-1:desktop-annotation-1",
    remote_revision: 2,
    source_annotation_id: "desktop-annotation-1",
    source_revision: 2,
    source_updated_at: new Date("2026-08-09T02:00:00.000Z"),
    state: "published",
    synced_at: new Date("2026-08-09T02:00:01.000Z")
  };
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT * FROM desktop_annotation_publications")) return { rows: [prior] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({
    async connect() { return client; }
  });
  const [replayed] = await repository.applyDesktopAnnotationPublications({ id: "user-1" }, [replayOperation]);
  assert.deepEqual(replayed, {
    annotationId: "desktop-annotation-1",
    queueKey: "paper-publication-1:desktop-annotation-1",
    remoteAnnotationId: "annotation-remote-1",
    remoteRevision: 2,
    state: "published",
    syncedAt: "2026-08-09T02:00:01.000Z"
  });
  assert.equal(queries.some((sql) => sql.startsWith("UPDATE annotations")), false);
});

test("acquires PostgreSQL desktop publication locks in canonical order while preserving result order", async () => {
  const locks = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("pg_advisory_xact_lock")) locks.push({ sql, value: values[0] });
      if (sql.includes("account_deletion_jobs")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM desktop_annotation_publications")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM literature_records")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({
    async connect() { return client; }
  });
  const results = await repository.applyDesktopAnnotationPublications({ id: "publication-owner" }, [
    publicationOperation({ annotationId: "annotation-z", queueKey: "queue-z" }),
    publicationOperation({ annotationId: "annotation-a", queueKey: "queue-a" })
  ]);
  assert.deepEqual(locks.map((lock) => lock.value), [
    "intuecho-account-deletion:publication-owner",
    "desktop-publication:publication-owner:queue-a",
    "desktop-publication:publication-owner:queue-z"
  ]);
  assert.match(locks[0].sql, /hashtextextended\(\$1, 0\)/);
  assert.deepEqual(results.map((result) => result.queueKey), ["queue-z", "queue-a"]);
});

test("rejects PostgreSQL desktop publications for a deleted owner before taking queue locks", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("account_deletion_jobs")) return { rows: [{ subject_id: "deleted-owner" }] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresAnnotationCommunityRepository({ async connect() { return client; } });
  const [result] = await repository.applyDesktopAnnotationPublications({ id: "deleted-owner" }, [publicationOperation()]);
  assert.equal(result.error, "ANNOTATION_PUBLICATION_OWNER_DELETED");
  assert.equal(queries.some((query) => query.values.includes("desktop-publication:deleted-owner:paper-publication-1:desktop-annotation-1")), false);
});

test("does not serialize untouched PostgreSQL legacy rows as canonical literature", async () => {
  const legacyRow = {
    authors: ["Legacy Author"],
    confirmation_status: "legacy_unverified",
    id: "legacy-postgres",
    publication_year: 2020,
    record_source: "legacy_metadata",
    version_kind: null
  };
  const pool = {
    async query(sql) {
      if (sql.includes("identifier_kind = ANY")) {
        return { rows: [{ identifier_kind: "doi", normalized_value: "10.1000/legacy", literature_id: "legacy-postgres" }] };
      }
      if (sql.startsWith("SELECT * FROM literature_records")) return { rows: [legacyRow] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const repository = new PostgresAnnotationCommunityRepository(pool);
  assert.equal(await repository.findLiteratureByIdentifiers([{ kind: "doi", value: "10.1000/legacy" }]), null);
  assert.equal(await repository.findLiteratureById("legacy-postgres"), null);
});

test("public reads are anonymous while writes require a Bearer session", async () => {
  await withApp(async (app) => {
    const topic = await app.inject({ method: "GET", url: "/v1/topics/topic-1" });
    assert.equal(topic.statusCode, 200);
    assert.equal(topic.json().posts[0].viewer_is_author, false);

    const missing = await app.inject({ method: "POST", url: "/v1/topics/topic-1/follow" });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error, "AUTH_REQUIRED");
    assert.ok(missing.json().traceId);

    const legacyHeader = await app.inject({ method: "POST", url: "/v1/topics/topic-1/follow", headers: { "x-intuecho-user": "demo-user" } });
    assert.equal(legacyHeader.statusCode, 401);
  });
});

test("development CORS allows only the configured Web and desktop origins", async () => {
  await withApp(async (app) => {
    const desktop = await app.inject({
      headers: {
        "access-control-request-headers": "authorization,content-type,idempotency-key",
        "access-control-request-method": "POST",
        origin: "http://127.0.0.1:1420"
      },
      method: "OPTIONS",
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(desktop.statusCode, 204);
    assert.equal(desktop.headers["access-control-allow-origin"], "http://127.0.0.1:1420");

    const untrusted = await app.inject({
      headers: {
        "access-control-request-method": "POST",
        origin: "https://untrusted.example"
      },
      method: "OPTIONS",
      url: "/v1/pdf-annotations:sync"
    });
    assert.notEqual(untrusted.headers["access-control-allow-origin"], "https://untrusted.example");
  });
});

test("invalid authorization and invalid sessions return stable errors", async () => {
  await withApp(async (app) => {
    const malformed = await app.inject({ method: "GET", url: "/v1/topics", headers: { authorization: "Basic abc" } });
    assert.equal(malformed.statusCode, 401);
    assert.equal(malformed.json().error, "INVALID_AUTHORIZATION");
    assert.ok(malformed.json().traceId);

    const invalid = await app.inject({ method: "GET", url: "/v1/topics", headers: { authorization: "Bearer invalid" } });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.json().error, "INVALID_SESSION");
    assert.ok(invalid.json().traceId);
  });
});

test("unknown identity failures cannot expose internal details through statusCode", async (context) => {
  context.mock.method(console, "error", () => {});
  await withApp(async (app) => {
    const response = await app.inject({
      headers: { authorization: "Bearer opaque-token" },
      method: "GET",
      url: "/v1/topics"
    });
    const payload = response.json();

    assert.equal(response.statusCode, 503);
    assert.equal(payload.error, "IDENTITY_SERVICE_UNAVAILABLE");
    assert.equal(payload.message, "身份服务暂时不可用，请稍后重试。");
    assert.ok(payload.traceId);
    assert.doesNotMatch(JSON.stringify(payload), /SELECT users|\/srv\/identity|sk-secret/);
  }, {
    identityVerifier: async () => {
      throw Object.assign(
        new Error("SELECT users failed at /srv/identity with sk-secret"),
        { statusCode: 418 }
      );
    }
  });
});

test("contextual drafts publish with a stable author id", async () => {
  await withApp(async (app, db) => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/drafts/contextual",
      headers: userHeader,
      payload: { topicId: "topic-1", workId: "work-1", page: 2, excerpt: "source evidence", anchorHash: "sha256:source", language: "zh-CN", citationEnabled: true }
    });
    assert.equal(create.statusCode, 201);
    const { draftId } = create.json();

    const save = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "发布后的正文内容。", tags: ["证据"], citationEnabled: true } });
    assert.equal(save.statusCode, 200);
    const publish = await app.inject({ method: "POST", url: "/v1/posts", headers: userHeader, payload: { draftId } });
    assert.equal(publish.statusCode, 201);

    const row = db.prepare("SELECT author_id, author_name FROM posts WHERE id = ?").get(publish.json().postId);
    assert.deepEqual(row, { author_id: "user-1", author_name: "林立" });
    const mine = await app.inject({ method: "GET", url: "/v1/me/posts", headers: userHeader });
    assert.equal(mine.json().posts.length, 1);
    assert.equal(mine.json().posts[0].viewer_is_author, true);
  });
});

test("desktop draft handoffs require the desktop audience and remain bound to one subject", async () => {
  await withApp(async (app, db) => {
    const rejectedWebAudience = await app.inject({
      method: "POST",
      url: "/v1/integrations/desktop/draft-handoffs",
      headers: userHeader,
      payload: { context: { topicId: "topic-1", language: "zh-CN" } }
    });
    assert.equal(rejectedWebAudience.statusCode, 403);
    assert.equal(rejectedWebAudience.json().error, "INVALID_SESSION_AUDIENCE");

    const created = await app.inject({
      method: "POST",
      url: "/v1/integrations/desktop/draft-handoffs",
      headers: desktopHeader,
      payload: {
        context: {
          anchorHash: "sha256:source",
          citationEnabled: true,
          excerpt: "source evidence",
          language: "zh-CN",
          page: 2,
          topicId: "topic-1",
          workId: "work-1"
        },
        update: { body: "来自桌面选中文段的草稿。", citationEnabled: true, tags: ["证据"] }
      }
    });
    assert.equal(created.statusCode, 201);
    const { handoffId } = created.json();

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/draft-handoffs/${handoffId}/consume`,
      headers: sameNameHeader
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error, "HANDOFF_FORBIDDEN");

    const consumed = await app.inject({
      method: "POST",
      url: `/v1/draft-handoffs/${handoffId}/consume`,
      headers: userHeader
    });
    assert.equal(consumed.statusCode, 200);
    assert.equal(consumed.json().replayed, false);
    const draft = db.prepare("SELECT owner_id, body, citation_enabled FROM drafts WHERE id = ?")
      .get(consumed.json().draftId);
    assert.deepEqual(draft, { owner_id: "user-1", body: "来自桌面选中文段的草稿。", citation_enabled: 1 });

    const replay = await app.inject({
      method: "POST",
      url: `/v1/draft-handoffs/${handoffId}/consume`,
      headers: userHeader
    });
    assert.deepEqual(replay.json(), { draftId: consumed.json().draftId, replayed: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM drafts").get().count, 1);
  });
});

test("desktop draft handoffs return stable missing-context and expiry errors", async () => {
  await withApp(async (app, db) => {
    const missingTopic = await app.inject({
      method: "POST",
      url: "/v1/integrations/desktop/draft-handoffs",
      headers: desktopHeader,
      payload: { context: { topicId: "missing", language: "zh-CN" } }
    });
    assert.equal(missingTopic.statusCode, 404);
    assert.equal(missingTopic.json().error, "TOPIC_NOT_FOUND");

    const created = await app.inject({
      method: "POST",
      url: "/v1/integrations/desktop/draft-handoffs",
      headers: desktopHeader,
      payload: { context: { topicId: "topic-1", language: "zh-CN" } }
    });
    const { handoffId } = created.json();
    db.prepare("UPDATE desktop_draft_handoffs SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", handoffId);

    const expired = await app.inject({
      method: "POST",
      url: `/v1/draft-handoffs/${handoffId}/consume`,
      headers: userHeader
    });
    assert.equal(expired.statusCode, 410);
    assert.equal(expired.json().error, "HANDOFF_EXPIRED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM drafts").get().count, 0);
  });
});

test("desktop annotation handoffs carry stable literature targets without a topic or work mapping", async () => {
  await withApp(async (app) => {
    const payload = annotationV2Payload({ body: "", tags: [] });
    const created = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload,
      url: "/v1/integrations/desktop/annotation-handoffs"
    });
    assert.equal(created.statusCode, 201, created.body);
    const handoffId = created.json().handoffId;

    const forbidden = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: {},
      url: `/v1/annotation-handoffs/${handoffId}/consume`
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error, "HANDOFF_FORBIDDEN");

    const consumed = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: {},
      url: `/v1/annotation-handoffs/${handoffId}/consume`
    });
    assert.equal(consumed.statusCode, 200, consumed.body);
    assert.equal(consumed.json().draft.targets[0].literature.literatureId, "literature-1");
    assert.equal(consumed.json().draft.topicId, undefined);
    assert.equal(consumed.json().replayed, false);

    const replayed = await app.inject({ headers: userHeader, method: "POST", payload: {}, url: `/v1/annotation-handoffs/${handoffId}/consume` });
    assert.equal(replayed.json().replayed, true);
  });
});

test("community annotation sync is idempotent per user and recommendations use exact paper identity", async () => {
  await withApp(async (app, db) => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/annotations:sync",
      headers: desktopHeader,
      payload: { annotations: [annotationPayload()] }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().results[0].status, "synced");
    const remoteId = first.json().results[0].intuechoAnnotationId;

    const updated = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/annotations:sync",
      headers: desktopHeader,
      payload: { annotations: [annotationPayload({ body: "更新后的公开批注。", updatedAt: "2026-08-07T02:00:00.000Z" })] }
    });
    assert.equal(updated.json().results[0].intuechoAnnotationId, remoteId);
    assert.equal(db.prepare("SELECT body FROM annotations_v2 WHERE id = ?").get(remoteId).body, "更新后的公开批注。");

    const otherUser = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/annotations:sync",
      headers: otherDesktopHeader,
      payload: { annotations: [annotationPayload({ body: "另一位用户的批注。" })] }
    });
    assert.equal(otherUser.statusCode, 200);
    assert.notEqual(otherUser.json().results[0].intuechoAnnotationId, remoteId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM desktop_annotation_syncs_v2 WHERE queue_key = ?").get("paper-1:annotation-1").count, 2);

    const recommendations = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/recommendations:query",
      headers: desktopHeader,
      payload: {
        scope: {
          kind: "document",
          literatureId: "literature-1"
        }
      }
    });
    assert.equal(recommendations.statusCode, 200);
    assert.equal(recommendations.json().recommendations.length, 2);
    assert.ok(recommendations.json().recommendations.every((item) => item.literatureId === "literature-1"));

    const unrelated = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/recommendations:query",
      headers: desktopHeader,
      payload: {
        scope: {
          kind: "document",
          literatureId: "literature-other"
        }
      }
    });
    assert.deepEqual(unrelated.json(), { recommendations: [] });
  });
});

test("desktop publication operations keep confirmed literature metadata server-owned across replay, update, retract, and owners", async () => {
  await withApp(async (app, db) => {
    const literatureId = insertConfirmedPublicationLiterature(db);
    const createdResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({ literatureId, updatedAt: "2026-08-09T01:00:00.0000Z" })] },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(createdResponse.statusCode, 200, createdResponse.body);
    const created = createdResponse.json().results[0];
    assert.equal(created.state, "published");
    assert.equal(created.remoteRevision, 1);

    const storedTarget = JSON.parse(db.prepare("SELECT target_json FROM annotation_targets_v2 WHERE annotation_id = ?").get(created.remoteAnnotationId).target_json);
    assert.deepEqual(storedTarget.literature, { literatureId });
    assert.equal(db.prepare("SELECT title FROM literature_records_v2 WHERE id = ?").get(literatureId).title, "Server Confirmed Publication Literature");

    const replayResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({ literatureId })] },
      url: "/v1/pdf-annotations:sync"
    });
    const replayed = replayResponse.json().results[0];
    assert.equal(replayResponse.statusCode, 200, replayResponse.body);
    assert.equal(replayed.remoteAnnotationId, created.remoteAnnotationId);
    assert.equal(replayed.remoteRevision, created.remoteRevision);

    const updateResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({
        body: "新版桌面批注。",
        literatureId,
        revision: 2,
        updatedAt: "2026-08-09T02:00:00.000Z"
      })] },
      url: "/v1/pdf-annotations:sync"
    });
    const updated = updateResponse.json().results[0];
    assert.equal(updated.remoteAnnotationId, created.remoteAnnotationId);
    assert.equal(updated.remoteRevision, created.remoteRevision + 1);

    const staleResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({
        body: "过期桌面批注。",
        literatureId,
        updatedAt: "2026-08-09T03:00:00.000Z"
      })] },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(staleResponse.statusCode, 200, staleResponse.body);
    assert.equal(staleResponse.json().results[0].error, "STALE_ANNOTATION_PUBLICATION");
    assert.equal(db.prepare("SELECT body FROM annotations_v2 WHERE id = ?").get(created.remoteAnnotationId).body, "新版桌面批注。");

    const staleTimestampResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({
        body: "时间倒退的桌面批注。",
        literatureId,
        revision: 3,
        updatedAt: "2026-08-09T01:30:00.000Z"
      })] },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(staleTimestampResponse.statusCode, 200, staleTimestampResponse.body);
    assert.equal(staleTimestampResponse.json().results[0].error, "STALE_ANNOTATION_PUBLICATION");
    assert.equal(db.prepare("SELECT body FROM annotations_v2 WHERE id = ?").get(created.remoteAnnotationId).body, "新版桌面批注。");

    const retractOperation = {
      annotationId: "desktop-annotation-1",
      operation: "retract",
      queueKey: "paper-publication-1:desktop-annotation-1",
      remoteAnnotationId: created.remoteAnnotationId,
      revision: 4,
      updatedAt: "2026-08-09T04:00:00.000Z"
    };
    const retractResponse = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [retractOperation] },
      url: "/v1/pdf-annotations:sync"
    });
    const retracted = retractResponse.json().results[0];
    assert.equal(retracted.state, "retracted");
    assert.equal(db.prepare("SELECT visibility, share_to_plaza FROM annotations_v2 WHERE id = ?").get(created.remoteAnnotationId).visibility, "private");
    assert.equal(db.prepare("SELECT visibility, share_to_plaza FROM annotations_v2 WHERE id = ?").get(created.remoteAnnotationId).share_to_plaza, 0);

    const repeatedRetract = await app.inject({
      headers: desktopHeader,
      method: "POST",
      payload: { operations: [retractOperation] },
      url: "/v1/pdf-annotations:sync"
    });
    assert.deepEqual(repeatedRetract.json().results[0], retracted);

    const otherOwner = await app.inject({
      headers: otherDesktopHeader,
      method: "POST",
      payload: { operations: [publicationOperation({ literatureId })] },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(otherOwner.statusCode, 200, otherOwner.body);
    assert.notEqual(otherOwner.json().results[0].remoteAnnotationId, created.remoteAnnotationId);
  });
});

test("annotation community publishes multi-target annotations, derived passages, replies and plaza filters", async () => {
  await withApp(async (app) => {
    const profile = await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: {
        educationStage: "博士研究生",
        institutions: [{ name: "证据研究院" }]
      },
      url: "/v1/me/academic-profile"
    });
    assert.equal(profile.statusCode, 200, profile.body);

    const base = annotationV2Payload();
    const derived = {
      derivedContent: {
        artifactId: "artifact-1",
        excerpt: "薄读生成的证据边界说明",
        nodeId: "node-1",
        version: "projection-v1"
      },
      evidence: [{
        anchorHash: "sha256:source-evidence",
        excerpt: "source evidence",
        literature: base.targets[0].literature,
        page: 2,
        rects: []
      }],
      kind: "derived_passage",
      literature: base.targets[0].literature
    };
    const created = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ tags: ["观点", "证据"], targets: [base.targets[0], derived] }),
      url: "/v1/annotations"
    });
    assert.equal(created.statusCode, 201, created.body);
    const annotation = created.json().annotation;
    assert.equal(annotation.targets.length, 2);
    assert.equal(annotation.targets.find((target) => target.kind === "derived_passage").evidence.length, 1);
    assert.deepEqual(annotation.author.profile, {
      educationStage: "博士研究生",
      institutions: [{ name: "证据研究院" }]
    });

    const reply = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: {
        body: "这是针对原批注的回复。",
        publishAsAnnotation: false,
        tags: [],
        targets: []
      },
      url: `/v1/annotations/${annotation.id}/replies`
    });
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal(reply.json().reply.parentAnnotationId, annotation.id);
    assert.equal(reply.json().annotation, null);

    await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { educationStage: "博士研究生", institutions: [{ name: "证据研究院" }] },
      url: "/v1/me/academic-profile"
    });

    const promotedReply = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: {
        body: "观点：带原文证据的回复也成为独立批注。",
        publishAsAnnotation: true,
        tags: ["证据"],
        targets: [base.targets[0]]
      },
      url: `/v1/annotations/${annotation.id}/replies`
    });
    assert.equal(promotedReply.statusCode, 201, promotedReply.body);
    assert.equal(promotedReply.json().reply.derivedAnnotationId, promotedReply.json().annotation.id);
    assert.equal(promotedReply.json().annotation.originalReply.status, "available");

    const replies = await app.inject({ method: "GET", url: `/v1/annotations/${annotation.id}/replies` });
    assert.equal(replies.statusCode, 200);
    assert.equal(replies.json().replies.length, 2);

    const rated = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { rating: 5 },
      url: `/v1/annotations/${annotation.id}/rating`
    });
    assert.deepEqual(rated.json(), { ratingAverage: 5, ratingCount: 1, viewerRating: 5 });
    const selfRating = await app.inject({ headers: userHeader, method: "PUT", payload: { rating: 4 }, url: `/v1/annotations/${annotation.id}/rating` });
    assert.equal(selfRating.statusCode, 403);
    assert.equal(selfRating.json().error, "SELF_RATING_FORBIDDEN");

    const withdrawn = await app.inject({ headers: userHeader, method: "DELETE", url: `/v1/annotations/${annotation.id}` });
    assert.equal(withdrawn.statusCode, 200);
    const retained = await app.inject({ method: "GET", url: `/v1/annotations/${promotedReply.json().annotation.id}` });
    assert.equal(retained.statusCode, 200, retained.body);
    assert.equal(retained.json().annotation.originalReply.status, "parent_deleted");

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/plaza?institution=%E8%AF%81%E6%8D%AE%E7%A0%94%E7%A9%B6%E9%99%A2&documentType=journal_article&educationStage=%E5%8D%9A%E5%A3%AB%E7%A0%94%E7%A9%B6%E7%94%9F&query=%2F%E8%A7%82%E7%82%B9"
    });
    assert.equal(filtered.statusCode, 200, filtered.body);
    assert.deepEqual(filtered.json().annotations.map((item) => item.id), [promotedReply.json().annotation.id]);
  });
});

test("reply projections inherit every parent visibility without entering a broader feed", async () => {
  await withApp(async (app) => {
    const target = annotationV2Payload().targets[0];
    const follow = async (headers, targetUserId) => app.inject({
      headers,
      method: "POST",
      payload: { targetUserId },
      url: "/v1/follows"
    });
    assert.equal((await follow(userHeader, "user-2")).statusCode, 200);
    assert.equal((await follow(sameNameHeader, "user-1")).statusCode, 200);
    assert.equal((await follow(sameNameHeader, "user-3")).statusCode, 200);
    assert.equal((await follow(thirdHeader, "user-2")).statusCode, 200);

    const scopes = [
      { expectedViewer: {}, name: "public", replyHeaders: sameNameHeader, shareToPlaza: true },
      {
        expectedViewer: sameNameHeader,
        name: "organization",
        organizationId: "org-1",
        replyHeaders: sameNameHeader,
        shareToPlaza: false
      },
      { expectedViewer: sameNameHeader, name: "mutual_followers", replyHeaders: sameNameHeader, shareToPlaza: false },
      { expectedViewer: userHeader, name: "private", replyHeaders: userHeader, shareToPlaza: false }
    ];
    const projections = [];
    for (const scope of scopes) {
      const parent = await app.inject({
        headers: userHeader,
        method: "POST",
        payload: annotationV2Payload({
          body: `${scope.name} parent`,
          organizationId: scope.organizationId,
          shareToPlaza: scope.name === "public",
          visibility: scope.name
        }),
        url: "/v1/annotations"
      });
      assert.equal(parent.statusCode, 201, parent.body);
      const projected = await app.inject({
        headers: scope.replyHeaders,
        method: "POST",
        payload: {
          body: `${scope.name} projected reply`,
          publishAsAnnotation: true,
          tags: ["scope"],
          targets: [target]
        },
        url: `/v1/annotations/${parent.json().annotation.id}/replies`
      });
      assert.equal(projected.statusCode, 201, projected.body);
      assert.equal(projected.json().annotation.visibility, scope.name);
      assert.equal(projected.json().annotation.organizationId, scope.organizationId ?? null);
      assert.equal(projected.json().annotation.shareToPlaza, scope.shareToPlaza);
      assert.equal(projected.json().reply.derivedAnnotationState, "published");
      projections.push({ id: projected.json().annotation.id, scope });

      const visible = await app.inject({
        headers: scope.expectedViewer,
        method: "GET",
        url: `/v1/annotations/${projected.json().annotation.id}`
      });
      assert.equal(visible.statusCode, 200, visible.body);
      if (scope.name !== "public") {
        const anonymous = await app.inject({ method: "GET", url: `/v1/annotations/${projected.json().annotation.id}` });
        assert.equal(anonymous.statusCode, 404, anonymous.body);
        const broadened = await app.inject({
          headers: scope.replyHeaders,
          method: "PUT",
          payload: { shareToPlaza: true, visibility: "public" },
          url: `/v1/annotations/${projected.json().annotation.id}`
        });
        assert.equal(broadened.statusCode, 400, broadened.body);
        assert.equal(broadened.json().error, "REPLY_VISIBILITY_MISMATCH");
      }
      if (scope.name === "mutual_followers") {
        assert.equal((await app.inject({
          headers: thirdHeader,
          method: "GET",
          url: `/v1/annotations/${parent.json().annotation.id}`
        })).statusCode, 404);
        assert.equal((await app.inject({
          headers: thirdHeader,
          method: "GET",
          url: `/v1/annotations/${projected.json().annotation.id}`
        })).statusCode, 404);
      }
    }

    const plaza = await app.inject({ method: "GET", url: "/v1/plaza" });
    assert.equal(plaza.statusCode, 200, plaza.body);
    const projectedInPlaza = new Set(plaza.json().annotations.map((annotation) => annotation.id));
    assert.deepEqual(
      projections.filter(({ id }) => projectedInPlaza.has(id)).map(({ scope }) => scope.name),
      ["public"]
    );
  }, {
    authorizeOrganizationAccess: async ({ organizationId, userId }) => ({
      allowed: organizationId === "org-1" && new Set(["user-1", "user-2"]).has(userId),
      role: userId === "user-2" ? "admin" : "member"
    }),
    authorizeOrganizationVisibility: async ({ organizationId, userId }) =>
      organizationId === "org-1" && new Set(["user-1", "user-2"]).has(userId)
  });
});

test("reply scope locks and transitive root audiences prevent stale or nested disclosure", async () => {
  await withApp(async (app, db) => {
    const target = annotationV2Payload().targets[0];
    const follow = (headers, targetUserId) => app.inject({
      headers,
      method: "POST",
      payload: { targetUserId },
      url: "/v1/follows"
    });
    for (const [headers, targetUserId] of [
      [userHeader, "user-2"], [sameNameHeader, "user-1"],
      [userHeader, "user-3"], [thirdHeader, "user-1"],
      [fourthHeader, "user-2"], [sameNameHeader, "user-4"],
      [fourthHeader, "user-3"], [thirdHeader, "user-4"]
    ]) {
      assert.equal((await follow(headers, targetUserId)).statusCode, 200);
    }

    const mutualRoot = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Root audience A", shareToPlaza: false, visibility: "mutual_followers" }),
      url: "/v1/annotations"
    });
    const projectionB = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Projection B", publishAsAnnotation: true, tags: [], targets: [target] },
      url: `/v1/annotations/${mutualRoot.json().annotation.id}/replies`
    });
    assert.equal(projectionB.statusCode, 201, projectionB.body);
    const projectionC = await app.inject({
      headers: thirdHeader,
      method: "POST",
      payload: { body: "Nested projection C", publishAsAnnotation: true, tags: [], targets: [target] },
      url: `/v1/annotations/${projectionB.json().annotation.id}/replies`
    });
    assert.equal(projectionC.statusCode, 201, projectionC.body);
    const nestedId = projectionC.json().annotation.id;
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${nestedId}` })).statusCode, 200);
    assert.equal((await app.inject({ headers: fourthHeader, method: "GET", url: `/v1/annotations/${nestedId}` })).statusCode, 404);
    const fourthFeed = await app.inject({ headers: fourthHeader, method: "GET", url: "/v1/me/following-annotations" });
    assert.equal(fourthFeed.statusCode, 200, fourthFeed.body);
    assert.equal(fourthFeed.json().annotations.some((annotation) => annotation.id === nestedId), false);
    assert.equal((await app.inject({ headers: fourthHeader, method: "PUT", payload: { rating: 5 }, url: `/v1/annotations/${nestedId}/rating` })).statusCode, 404);
    assert.equal((await app.inject({ headers: fourthHeader, method: "POST", url: `/v1/annotations/${nestedId}/save` })).statusCode, 404);
    assert.equal((await app.inject({
      headers: fourthHeader,
      method: "POST",
      payload: { body: "Must not attach outside root audience", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${nestedId}/replies`
    })).statusCode, 404);

    db.prepare("UPDATE annotations_v2 SET source_reply_id = ? WHERE id = ?").run("missing-source-reply", nestedId);
    assert.equal((await app.inject({ headers: thirdHeader, method: "GET", url: `/v1/annotations/${nestedId}` })).statusCode, 404);

    const publicParent = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Public scope lock" }),
      url: "/v1/annotations"
    });
    assert.equal((await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Pure reply locks parent scope", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${publicParent.json().annotation.id}/replies`
    })).statusCode, 201);
    const narrowed = await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { organizationId: null, shareToPlaza: false, visibility: "private" },
      url: `/v1/annotations/${publicParent.json().annotation.id}`
    });
    assert.equal(narrowed.statusCode, 409, narrowed.body);
    assert.equal(narrowed.json().error, "ANNOTATION_SCOPE_LOCKED_BY_REPLIES");

    const organizationParent = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Organization scope lock", organizationId: "org-scope-a", shareToPlaza: false, visibility: "organization" }),
      url: "/v1/annotations"
    });
    assert.equal((await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Organization reply locks reassignment", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${organizationParent.json().annotation.id}/replies`
    })).statusCode, 201);
    const reassigned = await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { organizationId: "org-scope-b" },
      url: `/v1/annotations/${organizationParent.json().annotation.id}`
    });
    assert.equal(reassigned.statusCode, 409, reassigned.body);
    assert.equal(reassigned.json().error, "ANNOTATION_SCOPE_LOCKED_BY_REPLIES");

    const staleParent = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Stale pure reply parent" }),
      url: "/v1/annotations"
    });
    const staleReply = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Publish only against current parent scope", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${staleParent.json().annotation.id}/replies`
    });
    db.prepare("UPDATE annotations_v2 SET visibility = 'private', share_to_plaza = 0 WHERE id = ?").run(staleParent.json().annotation.id);
    const stalePublication = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: [], targets: [target] },
      url: `/v1/replies/${staleReply.json().reply.id}/publication`
    });
    assert.equal(stalePublication.statusCode, 400, stalePublication.body);
    assert.equal(stalePublication.json().error, "REPLY_VISIBILITY_MISMATCH");
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2 WHERE source_reply_id = ?").get(staleReply.json().reply.id).count, 0);
  }, {
    authorizeOrganizationVisibility: async ({ organizationId, userId }) =>
      new Set(["org-scope-a", "org-scope-b"]).has(organizationId) && new Set(["user-1", "user-2"]).has(userId)
  });
});

test("linked organization and platform moderation preserve withdrawal provenance", async () => {
  await withApp(async (app, db) => {
    const target = annotationV2Payload().targets[0];
    const createProjection = async (body) => {
      const parent = await app.inject({
        headers: userHeader,
        method: "POST",
        payload: annotationV2Payload({ body: `${body} parent`, organizationId: "org-moderation", shareToPlaza: false, visibility: "organization" }),
        url: "/v1/annotations"
      });
      const projected = await app.inject({
        headers: sameNameHeader,
        method: "POST",
        payload: { body, publishAsAnnotation: true, tags: [], targets: [target] },
        url: `/v1/annotations/${parent.json().annotation.id}/replies`
      });
      assert.equal(projected.statusCode, 201, projected.body);
      return { parentId: parent.json().annotation.id, ...projected.json() };
    };
    const organizationModerate = (annotationId, action) => app.inject({
      headers: thirdHeader,
      method: "POST",
      payload: { action, reason: `${action} through organization governance` },
      url: `/v1/annotations/${annotationId}/organization-moderation`
    });
    const platformModerate = (annotationId, action) => app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { action, reason: `${action} through platform governance` },
      url: `/v1/admin/annotations/${annotationId}/moderate`
    });

    const governed = await createProjection("Organization linked reply");
    assert.equal((await organizationModerate(governed.annotation.id, "withdraw")).statusCode, 200);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${governed.annotation.id}/replies` })).statusCode, 404);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${governed.parentId}/replies` })).json().replies.length, 0);
    assert.deepEqual(
      db.prepare("SELECT action, linked_reply_id FROM annotation_moderation_audit_v2 WHERE annotation_id = ? ORDER BY created_at").all(governed.annotation.id),
      [{ action: "withdraw", linked_reply_id: governed.reply.id }]
    );
    assert.equal((await organizationModerate(governed.annotation.id, "restore")).statusCode, 200);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${governed.parentId}/replies` })).json().replies.length, 1);

    const platformGoverned = await createProjection("Platform withdrawal superseded by author");
    assert.equal((await platformModerate(platformGoverned.annotation.id, "withdraw")).statusCode, 200);
    const authorWithdrawal = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: false },
      url: `/v1/replies/${platformGoverned.reply.id}/publication`
    });
    assert.equal(authorWithdrawal.statusCode, 200, authorWithdrawal.body);
    const platformRestore = await platformModerate(platformGoverned.annotation.id, "restore");
    assert.equal(platformRestore.statusCode, 409, platformRestore.body);
    assert.equal(platformRestore.json().error, "ANNOTATION_MODERATION_CONFLICT");
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${platformGoverned.parentId}/replies` })).json().replies.length, 0);

    const directlyWithdrawn = await createProjection("Platform withdrawal superseded by direct author withdrawal");
    assert.equal((await platformModerate(directlyWithdrawn.annotation.id, "withdraw")).statusCode, 200);
    assert.equal((await app.inject({
      headers: sameNameHeader,
      method: "DELETE",
      url: `/v1/annotations/${directlyWithdrawn.annotation.id}`
    })).statusCode, 200);
    assert.equal(
      db.prepare("SELECT moderated_by FROM annotation_replies_v2 WHERE id = ?").get(directlyWithdrawn.reply.id).moderated_by,
      "author:user-2"
    );
    assert.equal((await platformModerate(directlyWithdrawn.annotation.id, "restore")).statusCode, 409);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${directlyWithdrawn.parentId}/replies` })).json().replies.length, 0);

    const userWithdrawn = await createProjection("User withdrawal cannot gain organization restore");
    assert.equal((await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: false },
      url: `/v1/replies/${userWithdrawn.reply.id}/publication`
    })).statusCode, 200);
    assert.equal((await organizationModerate(userWithdrawn.annotation.id, "restore")).statusCode, 409);

    const platformOnly = await createProjection("Platform withdrawal cannot gain organization restore");
    assert.equal((await platformModerate(platformOnly.annotation.id, "withdraw")).statusCode, 200);
    assert.equal((await organizationModerate(platformOnly.annotation.id, "restore")).statusCode, 409);
  }, {
    authorizeOrganizationAccess: async ({ organizationId, userId }) => ({
      allowed: organizationId === "org-moderation" && new Set(["user-1", "user-2", "user-3"]).has(userId),
      role: userId === "user-3" ? "admin" : "member"
    }),
    authorizeOrganizationVisibility: async ({ organizationId, userId }) =>
      organizationId === "org-moderation" && new Set(["user-1", "user-2", "user-3"]).has(userId)
  });
});

test("reply publication, editing, moderation, deletion, and engagement preserve canonical lifecycle boundaries", async () => {
  await withApp(async (app, db) => {
    const target = annotationV2Payload().targets[0];
    const parentResponse = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Lifecycle parent" }),
      url: "/v1/annotations"
    });
    assert.equal(parentResponse.statusCode, 201, parentResponse.body);
    const parent = parentResponse.json().annotation;
    const pure = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Only in the thread", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${parent.id}/replies`
    });
    assert.equal(pure.statusCode, 201, pure.body);
    assert.equal(pure.json().annotation, null);
    assert.equal(pure.json().reply.derivedAnnotationId, null);
    assert.equal(pure.json().reply.derivedAnnotationState, "none");
    const replyId = pure.json().reply.id;

    const lateParentResponse = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Late publication parent" }),
      url: "/v1/annotations"
    });
    assert.equal(lateParentResponse.statusCode, 201, lateParentResponse.body);
    const lateParent = lateParentResponse.json().annotation;
    const editedBeforePublication = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Edited before projection", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${lateParent.id}/replies`
    });
    assert.equal(editedBeforePublication.statusCode, 201, editedBeforePublication.body);
    const editedBeforePublicationId = editedBeforePublication.json().reply.id;
    assert.equal((await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "Edited before projection body" },
      url: `/v1/replies/${editedBeforePublicationId}`
    })).statusCode, 200);
    const lateProjection = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: [], targets: [target] },
      url: `/v1/replies/${editedBeforePublicationId}/publication`
    });
    assert.equal(lateProjection.statusCode, 200, lateProjection.body);
    assert.equal(lateProjection.json().reply.revision, 2);
    assert.equal(lateProjection.json().annotation.revision, 1);

    const implicitProjection = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Targets cannot implicitly publish", tags: [], targets: [target] },
      url: `/v1/annotations/${parent.id}/replies`
    });
    assert.equal(implicitProjection.statusCode, 400, implicitProjection.body);
    assert.equal(implicitProjection.json().error, "INVALID_REPLY");
    const invalidPublication = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: [], targets: [] },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(invalidPublication.statusCode, 400, invalidPublication.body);
    assert.equal(invalidPublication.json().error, "INVALID_REPLY_PUBLICATION");
    const unauthorizedPublication = await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { published: true, tags: [], targets: [target] },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(unauthorizedPublication.statusCode, 403, unauthorizedPublication.body);
    assert.equal(unauthorizedPublication.json().error, "NOT_REPLY_AUTHOR");

    const published = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: ["evidence"], targets: [target] },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(published.statusCode, 200, published.body);
    assert.equal(published.json().reply.derivedAnnotationState, "published");
    assert.equal(published.json().annotation.body, "Only in the thread");
    assert.equal(published.json().annotation.shareToPlaza, true);
    const derivedId = published.json().annotation.id;

    await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { educationStage: "博士研究生", institutions: [{ name: "证据研究院" }] },
      url: "/v1/me/academic-profile"
    });
    const edited = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "Canonical reply body after editing" },
      url: `/v1/replies/${replyId}`
    });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().reply.revision, 2);
    assert.deepEqual(edited.json().reply.author.profile, {
      educationStage: "博士研究生",
      institutions: [{ name: "证据研究院" }]
    });
    const derivedAfterEdit = await app.inject({
      headers: sameNameHeader,
      method: "GET",
      url: `/v1/annotations/${derivedId}`
    });
    assert.equal(derivedAfterEdit.statusCode, 200, derivedAfterEdit.body);
    assert.equal(derivedAfterEdit.json().annotation.body, "Canonical reply body after editing");
    assert.equal(derivedAfterEdit.json().annotation.revision, 2);
    assert.deepEqual(derivedAfterEdit.json().annotation.author.profile, edited.json().reply.author.profile);
    assert.deepEqual(
      db.prepare("SELECT revision, body FROM annotation_replies_v2 WHERE id = ?").get(replyId),
      { body: "Canonical reply body after editing", revision: 2 }
    );
    assert.deepEqual(
      db.prepare("SELECT revision, body FROM annotations_v2 WHERE id = ?").get(derivedId),
      { body: "Canonical reply body after editing", revision: 2 }
    );
    const replySnapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM annotation_reply_versions_v2 WHERE reply_id = ?").get(replyId).snapshot_json);
    const annotationSnapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM annotation_versions_v2 WHERE annotation_id = ?").get(derivedId).snapshot_json);
    assert.equal(replySnapshot.body, "Only in the thread");
    assert.equal(annotationSnapshot.body, "Only in the thread");

    const directBodyEdit = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "Projection must not become canonical" },
      url: `/v1/annotations/${derivedId}`
    });
    assert.equal(directBodyEdit.statusCode, 400, directBodyEdit.body);
    assert.equal(directBodyEdit.json().error, "DERIVED_BODY_READ_ONLY");
    const directMetadataEdit = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { tags: ["direct metadata revision"] },
      url: `/v1/annotations/${derivedId}`
    });
    assert.equal(directMetadataEdit.statusCode, 200, directMetadataEdit.body);
    assert.equal(directMetadataEdit.json().annotation.revision, 3);

    const withdrawnPublication = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: false },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(withdrawnPublication.statusCode, 200, withdrawnPublication.body);
    assert.equal(withdrawnPublication.json().annotation, null);
    assert.equal(withdrawnPublication.json().reply.derivedAnnotationState, "withdrawn");
    let thread = await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` });
    assert.equal(thread.statusCode, 200, thread.body);
    assert.equal(thread.json().replies[0].id, replyId);
    assert.equal(thread.json().replies[0].derivedAnnotationState, "withdrawn");

    const restoredPublication = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: ["restored"], targets: [target] },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(restoredPublication.statusCode, 200, restoredPublication.body);
    assert.equal(restoredPublication.json().annotation.id, derivedId);
    assert.equal(restoredPublication.json().annotation.revision, 4);
    assert.equal(restoredPublication.json().reply.derivedAnnotationState, "published");

    const userWithdrawal = await app.inject({ headers: sameNameHeader, method: "DELETE", url: `/v1/annotations/${derivedId}` });
    assert.equal(userWithdrawal.statusCode, 200, userWithdrawal.body);
    thread = await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` });
    assert.equal(thread.json().replies[0].derivedAnnotationState, "withdrawn");
    const moderationRestoreOfUserWithdrawal = await app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { action: "restore", reason: "User withdrawal is not a platform moderation action" },
      url: `/v1/admin/annotations/${derivedId}/moderate`
    });
    assert.equal(moderationRestoreOfUserWithdrawal.statusCode, 409, moderationRestoreOfUserWithdrawal.body);
    assert.equal(moderationRestoreOfUserWithdrawal.json().error, "ANNOTATION_MODERATION_CONFLICT");
    const userRestored = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: ["restored"], targets: [target] },
      url: `/v1/replies/${replyId}/publication`
    });
    assert.equal(userRestored.statusCode, 200, userRestored.body);
    assert.equal(userRestored.json().annotation.revision, 5);

    const editedAfterMetadataChanges = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "Canonical reply remains editable after projection metadata changes" },
      url: `/v1/replies/${replyId}`
    });
    assert.equal(editedAfterMetadataChanges.statusCode, 200, editedAfterMetadataChanges.body);
    assert.equal(editedAfterMetadataChanges.json().reply.revision, 3);
    const derivedAfterMetadataChanges = await app.inject({
      headers: sameNameHeader,
      method: "GET",
      url: `/v1/annotations/${derivedId}`
    });
    assert.equal(derivedAfterMetadataChanges.statusCode, 200, derivedAfterMetadataChanges.body);
    assert.equal(derivedAfterMetadataChanges.json().annotation.body, editedAfterMetadataChanges.json().reply.body);
    assert.equal(derivedAfterMetadataChanges.json().annotation.revision, 6);

    const parentBeforeEngagement = await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${parent.id}` });
    const sourceBeforeEngagement = db.prepare("SELECT body, revision FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    assert.equal((await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { rating: 5 },
      url: `/v1/annotations/${derivedId}/rating`
    })).statusCode, 200);
    assert.equal((await app.inject({ headers: userHeader, method: "POST", url: `/v1/annotations/${derivedId}/save` })).statusCode, 200);
    const projectionReply = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { body: "Reply to the independent projection", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${derivedId}/replies`
    });
    assert.equal(projectionReply.statusCode, 201, projectionReply.body);
    assert.deepEqual(
      db.prepare("SELECT body, revision FROM annotation_replies_v2 WHERE id = ?").get(replyId),
      sourceBeforeEngagement
    );
    const parentAfterEngagement = await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${parent.id}` });
    assert.equal(parentAfterEngagement.json().annotation.ratingCount, parentBeforeEngagement.json().annotation.ratingCount);
    assert.equal(parentAfterEngagement.json().annotation.viewerSaved, parentBeforeEngagement.json().annotation.viewerSaved);
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` })).json().replies.length, 1);
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${derivedId}/replies` })).json().replies.length, 1);

    const moderate = (action) => app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { action, reason: `${action} linked reply through platform moderation` },
      url: `/v1/admin/annotations/${derivedId}/moderate`
    });
    const moderated = await moderate("withdraw");
    assert.equal(moderated.statusCode, 200, moderated.body);
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` })).json().replies.length, 0);
    const moderatedReply = db.prepare("SELECT moderated_at, moderation_reason, moderated_by FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    assert.ok(moderatedReply.moderated_at);
    assert.equal(moderatedReply.moderated_by, "platform:admin-1");
    assert.match(moderatedReply.moderation_reason, /linked reply/);
    assert.deepEqual(
      db.prepare("SELECT annotation_id, linked_reply_id, action FROM annotation_moderation_audit_v2 WHERE annotation_id = ? ORDER BY created_at").all(derivedId),
      [{ action: "withdraw", annotation_id: derivedId, linked_reply_id: replyId }]
    );
    const restored = await moderate("restore");
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` })).json().replies[0].id, replyId);
    assert.deepEqual(
      db.prepare("SELECT moderated_at, moderation_reason, moderated_by FROM annotation_replies_v2 WHERE id = ?").get(replyId),
      { moderated_at: null, moderated_by: null, moderation_reason: null }
    );
    assert.deepEqual(
      db.prepare("SELECT linked_reply_id, action FROM annotation_moderation_audit_v2 WHERE annotation_id = ? ORDER BY created_at").all(derivedId),
      [{ action: "withdraw", linked_reply_id: replyId }, { action: "restore", linked_reply_id: replyId }]
    );

    const unauthorizedDeletion = await app.inject({ headers: userHeader, method: "DELETE", url: `/v1/replies/${replyId}` });
    assert.equal(unauthorizedDeletion.statusCode, 403, unauthorizedDeletion.body);
    assert.equal(unauthorizedDeletion.json().error, "NOT_REPLY_AUTHOR");
    const deleted = await app.inject({ headers: sameNameHeader, method: "DELETE", url: `/v1/replies/${replyId}` });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json(), { ok: true, replyId });
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${parent.id}/replies` })).json().replies.length, 0);
    assert.equal((await app.inject({ headers: sameNameHeader, method: "GET", url: `/v1/annotations/${derivedId}` })).statusCode, 404);
    assert.ok(db.prepare("SELECT deleted_at FROM annotation_replies_v2 WHERE id = ?").get(replyId).deleted_at);
    const deletedRestore = await moderate("restore");
    assert.equal(deletedRestore.statusCode, 409, deletedRestore.body);
    assert.equal(deletedRestore.json().error, "ANNOTATION_MODERATION_CONFLICT");
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${derivedId}` })).statusCode, 404);

    const parentForDeletion = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Parent deletion context" }),
      url: "/v1/annotations"
    });
    const projectedBeforeParentDeletion = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Projection survives its parent", publishAsAnnotation: true, tags: [], targets: [target] },
      url: `/v1/annotations/${parentForDeletion.json().annotation.id}/replies`
    });
    assert.equal(projectedBeforeParentDeletion.statusCode, 201, projectedBeforeParentDeletion.body);
    assert.equal((await app.inject({
      headers: userHeader,
      method: "DELETE",
      url: `/v1/annotations/${parentForDeletion.json().annotation.id}`
    })).statusCode, 200);
    const retainedProjection = await app.inject({
      method: "GET",
      url: `/v1/annotations/${projectedBeforeParentDeletion.json().annotation.id}`
    });
    assert.equal(retainedProjection.statusCode, 200, retainedProjection.body);
    assert.deepEqual(retainedProjection.json().annotation.originalReply, {
      replyId: projectedBeforeParentDeletion.json().reply.id,
      status: "parent_deleted"
    });
    const parentDeletedDerivedId = projectedBeforeParentDeletion.json().annotation.id;
    const moderateParentDeletedProjection = (action) => app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { action, reason: `${action} a projection whose parent was deleted` },
      url: `/v1/admin/annotations/${parentDeletedDerivedId}/moderate`
    });
    assert.equal((await moderateParentDeletedProjection("withdraw")).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${parentDeletedDerivedId}` })).statusCode, 404);
    assert.equal((await moderateParentDeletedProjection("restore")).statusCode, 200);
    const restoredParentDeletedProjection = await app.inject({ method: "GET", url: `/v1/annotations/${parentDeletedDerivedId}` });
    assert.equal(restoredParentDeletedProjection.statusCode, 200, restoredParentDeletedProjection.body);
    assert.equal(restoredParentDeletedProjection.json().annotation.originalReply.status, "parent_deleted");
  });
});

test("reply body and derived projection edits roll back together after a late database failure", async () => {
  await withApp(async (app, db) => {
    const parent = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "Rollback parent" }),
      url: "/v1/annotations"
    });
    const projected = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: {
        body: "Rollback source body",
        publishAsAnnotation: true,
        tags: [],
        targets: annotationV2Payload().targets
      },
      url: `/v1/annotations/${parent.json().annotation.id}/replies`
    });
    assert.equal(projected.statusCode, 201, projected.body);
    const replyId = projected.json().reply.id;
    const derivedId = projected.json().annotation.id;
    db.exec(`
      CREATE TRIGGER reject_projection_body_update
      BEFORE UPDATE OF body ON annotations_v2
      WHEN OLD.id = '${derivedId}'
      BEGIN
        SELECT RAISE(ABORT, 'forced_projection_update_failure');
      END;
    `);
    const failed = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "This body must roll back" },
      url: `/v1/replies/${replyId}`
    });
    assert.equal(failed.statusCode, 500, failed.body);
    assert.deepEqual(
      db.prepare("SELECT body, revision FROM annotation_replies_v2 WHERE id = ?").get(replyId),
      { body: "Rollback source body", revision: 1 }
    );
    assert.deepEqual(
      db.prepare("SELECT body, revision FROM annotations_v2 WHERE id = ?").get(derivedId),
      { body: "Rollback source body", revision: 1 }
    );
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_reply_versions_v2 WHERE reply_id = ?").get(replyId).count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_versions_v2 WHERE annotation_id = ?").get(derivedId).count, 0);
  });
});

test("SQLite reply lifecycle rechecks state after asynchronous organization authorization", async () => {
  let nextAuthorizationGate = null;
  let nextAccessGate = null;
  const pauseNextAuthorization = () => {
    let release;
    let started;
    const released = new Promise((resolve) => { release = resolve; });
    const waiting = new Promise((resolve) => { started = resolve; });
    nextAuthorizationGate = { release, released, started };
    return { release, waiting };
  };
  const pauseNextAccessAuthorization = () => {
    let release;
    let started;
    const released = new Promise((resolve) => { release = resolve; });
    const waiting = new Promise((resolve) => { started = resolve; });
    nextAccessGate = { release, released, started };
    return { release, waiting };
  };
  await withApp(async (app, db) => {
    const createOrganizationParent = async (body) => {
      const response = await app.inject({
        headers: userHeader,
        method: "POST",
        payload: annotationV2Payload({
          body,
          organizationId: "org-race",
          shareToPlaza: false,
          visibility: "organization"
        }),
        url: "/v1/annotations"
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().annotation;
    };
    const createPureReply = async (parentId, body) => {
      const response = await app.inject({
        headers: sameNameHeader,
        method: "POST",
        payload: { body, publishAsAnnotation: false, tags: [], targets: [] },
        url: `/v1/annotations/${parentId}/replies`
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().reply;
    };

    const withdrawnParent = await createOrganizationParent("Organization parent withdrawn during authorization");
    const createGate = pauseNextAuthorization();
    const pendingCreate = app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Must not attach to stale parent", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${withdrawnParent.id}/replies`
    });
    await createGate.waiting;
    assert.equal((await app.inject({ headers: userHeader, method: "DELETE", url: `/v1/annotations/${withdrawnParent.id}` })).statusCode, 200);
    createGate.release();
    const staleCreate = await pendingCreate;
    assert.equal(staleCreate.statusCode, 404, staleCreate.body);
    assert.equal(staleCreate.json().error, "PARENT_ANNOTATION_NOT_FOUND");
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_replies_v2 WHERE parent_annotation_id = ?").get(withdrawnParent.id).count, 0);

    const updateParent = await createOrganizationParent("Organization parent for stale update");
    const replyForUpdate = await createPureReply(updateParent.id, "Reply deleted during update authorization");
    const updateGate = pauseNextAuthorization();
    const pendingUpdate = app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { body: "Stale update must not commit" },
      url: `/v1/replies/${replyForUpdate.id}`
    });
    await updateGate.waiting;
    assert.equal((await app.inject({ headers: sameNameHeader, method: "DELETE", url: `/v1/replies/${replyForUpdate.id}` })).statusCode, 200);
    updateGate.release();
    const staleUpdate = await pendingUpdate;
    assert.equal(staleUpdate.statusCode, 404, staleUpdate.body);
    assert.equal(staleUpdate.json().error, "REPLY_NOT_FOUND");
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_reply_versions_v2 WHERE reply_id = ?").get(replyForUpdate.id).count, 0);

    const publicationParent = await createOrganizationParent("Organization parent for stale publication");
    const replyForPublication = await createPureReply(publicationParent.id, "Reply deleted during publication authorization");
    const publicationGate = pauseNextAuthorization();
    const pendingPublication = app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { published: true, tags: [], targets: annotationV2Payload().targets },
      url: `/v1/replies/${replyForPublication.id}/publication`
    });
    await publicationGate.waiting;
    assert.equal((await app.inject({ headers: sameNameHeader, method: "DELETE", url: `/v1/replies/${replyForPublication.id}` })).statusCode, 200);
    publicationGate.release();
    const stalePublication = await pendingPublication;
    assert.equal(stalePublication.statusCode, 404, stalePublication.body);
    assert.equal(stalePublication.json().error, "REPLY_NOT_FOUND");
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2 WHERE source_reply_id = ?").get(replyForPublication.id).count, 0);

    const readDuringMove = await createOrganizationParent("Organization annotation moved during read authorization");
    const readGate = pauseNextAuthorization();
    const pendingRead = app.inject({ headers: sameNameHeader, method: "GET", url: `/v1/annotations/${readDuringMove.id}` });
    await readGate.waiting;
    db.prepare("UPDATE annotations_v2 SET organization_id = 'org-moved' WHERE id = ?").run(readDuringMove.id);
    readGate.release();
    const staleRead = await pendingRead;
    assert.equal(staleRead.statusCode, 404, staleRead.body);

    const updateDuringWithdrawal = await createOrganizationParent("Organization annotation withdrawn during metadata update");
    const metadataGate = pauseNextAuthorization();
    const pendingMetadataUpdate = app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { body: "Must not commit behind a stale 404" },
      url: `/v1/annotations/${updateDuringWithdrawal.id}`
    });
    await metadataGate.waiting;
    db.prepare("UPDATE annotations_v2 SET withdrawn_at = ? WHERE id = ?").run(new Date().toISOString(), updateDuringWithdrawal.id);
    metadataGate.release();
    const staleMetadataUpdate = await pendingMetadataUpdate;
    assert.equal(staleMetadataUpdate.statusCode, 404, staleMetadataUpdate.body);
    assert.deepEqual(
      db.prepare("SELECT body, revision FROM annotations_v2 WHERE id = ?").get(updateDuringWithdrawal.id),
      { body: "Organization annotation withdrawn during metadata update", revision: 1 }
    );

    const moderationDuringMove = await createOrganizationParent("Organization annotation moved during moderation authorization");
    const moderationGate = pauseNextAccessAuthorization();
    const pendingModeration = app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { action: "withdraw", reason: "Old organization admin must not commit after reassignment." },
      url: `/v1/annotations/${moderationDuringMove.id}/organization-moderation`
    });
    await moderationGate.waiting;
    db.prepare("UPDATE annotations_v2 SET organization_id = 'org-moved' WHERE id = ?").run(moderationDuringMove.id);
    moderationGate.release();
    const staleModeration = await pendingModeration;
    assert.equal(staleModeration.statusCode, 404, staleModeration.body);
    assert.equal(db.prepare("SELECT withdrawn_at FROM annotations_v2 WHERE id = ?").get(moderationDuringMove.id).withdrawn_at, null);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2 WHERE annotation_id = ?").get(moderationDuringMove.id).count, 0);

    const moderationDuringRevision = await createOrganizationParent("Organization annotation revised during moderation authorization");
    const revisionGate = pauseNextAccessAuthorization();
    const pendingRevisionModeration = app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { action: "withdraw", reason: "Revision changed while authorization was pending." },
      url: `/v1/annotations/${moderationDuringRevision.id}/organization-moderation`
    });
    await revisionGate.waiting;
    db.prepare("UPDATE annotations_v2 SET body = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
      .run("Changed while authorization was pending", new Date().toISOString(), moderationDuringRevision.id);
    revisionGate.release();
    const staleRevisionModeration = await pendingRevisionModeration;
    assert.equal(staleRevisionModeration.statusCode, 404, staleRevisionModeration.body);
    assert.equal(db.prepare("SELECT withdrawn_at FROM annotations_v2 WHERE id = ?").get(moderationDuringRevision.id).withdrawn_at, null);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2 WHERE annotation_id = ?").get(moderationDuringRevision.id).count, 0);

    const nestedRoot = await createOrganizationParent("Organization root for nested reply authorization");
    const nestedProjectionResponse = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Nested organization projection", publishAsAnnotation: true, tags: [], targets: annotationV2Payload().targets },
      url: `/v1/annotations/${nestedRoot.id}/replies`
    });
    assert.equal(nestedProjectionResponse.statusCode, 201, nestedProjectionResponse.body);
    const nestedProjection = nestedProjectionResponse.json().annotation;
    const nestedCreateGate = pauseNextAuthorization();
    const pendingNestedReply = app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "Must not attach to stale root", publishAsAnnotation: false, tags: [], targets: [] },
      url: `/v1/annotations/${nestedProjection.id}/replies`
    });
    await nestedCreateGate.waiting;
    db.prepare("UPDATE annotations_v2 SET organization_id = 'org-moved' WHERE id = ?").run(nestedRoot.id);
    nestedCreateGate.release();
    const staleNestedReply = await pendingNestedReply;
    assert.equal(staleNestedReply.statusCode, 404, staleNestedReply.body);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_replies_v2 WHERE parent_annotation_id = ?").get(nestedProjection.id).count, 0);
  }, {
    authorizeOrganizationAccess: async ({ organizationId, userId }) => {
      if (nextAccessGate) {
        const gate = nextAccessGate;
        nextAccessGate = null;
        gate.started();
        await gate.released;
      }
      return {
        allowed: organizationId === "org-race" && new Set(["user-1", "user-2"]).has(userId),
        role: userId === "user-2" ? "admin" : "member"
      };
    },
    authorizeOrganizationVisibility: async ({ organizationId, userId }) => {
      if (nextAuthorizationGate) {
        const gate = nextAuthorizationGate;
        nextAuthorizationGate = null;
        gate.started();
        await gate.released;
      }
      return organizationId === "org-race" && new Set(["user-1", "user-2"]).has(userId);
    }
  });
});

test("annotation authors appeal platform tags and administrators resolve them with append-only evidence", async () => {
  await withApp(async (app, db) => {
    const created = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload(),
      url: "/v1/annotations"
    });
    const annotationId = created.json().annotation.id;
    const now = "2026-08-07T02:00:00.000Z";
    db.prepare("INSERT INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, confidence, classifier_version, assigned_at, updated_at) VALUES (?, ?, ?, 'platform', 'active', 0.81, 'local-semantic-v1', ?, ?)")
      .run(annotationId, "观点", "观点", now, now);

    const appealed = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { reason: "这个标签把方法说明错误分类为观点。" },
      url: `/v1/annotations/${annotationId}/tags/${encodeURIComponent("观点")}/appeals`
    });
    assert.equal(appealed.statusCode, 201, appealed.body);
    assert.equal(db.prepare("SELECT state FROM annotation_tags_v2 WHERE annotation_id = ? AND tag_slug = '观点'").get(annotationId).state, "appealed");

    const listed = await app.inject({ headers: adminHeader, method: "GET", url: "/v1/admin/annotation-tag-appeals" });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().appeals[0].annotationId, annotationId);
    assert.equal(listed.json().appeals[0].tag, "观点");

    const resolved = await app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { decision: "accepted", reason: "复核原文后确认平台分类不准确。" },
      url: `/v1/admin/annotation-tag-appeals/${appealed.json().appealId}/resolve`
    });
    assert.equal(resolved.statusCode, 200, resolved.body);
    assert.equal(db.prepare("SELECT state FROM annotation_tags_v2 WHERE annotation_id = ? AND tag_slug = '观点'").get(annotationId).state, "removed");
    assert.deepEqual(
      db.prepare("SELECT decision, admin_user_id FROM annotation_tag_appeal_audit_v2").get(),
      { admin_user_id: "admin-1", decision: "accepted" }
    );
    assert.match(db.prepare("SELECT trace_id FROM annotation_tag_appeal_audit_v2").get().trace_id, /^req-/);
    const replay = await app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { decision: "accepted", reason: "再次尝试不应重复写入审核记录。" },
      url: `/v1/admin/annotation-tag-appeals/${appealed.json().appealId}/resolve`
    });
    assert.equal(replay.statusCode, 409);
  });
});

test("administrators govern the annotation entity instead of the legacy post model", async () => {
  await withApp(async (app, db) => {
    const created = await app.inject({ headers: userHeader, method: "POST", payload: annotationV2Payload(), url: "/v1/annotations" });
    const annotationId = created.json().annotation.id;
    const listed = await app.inject({ headers: adminHeader, method: "GET", url: "/v1/admin/annotations" });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().annotations[0].id, annotationId);
    const withdrawn = await app.inject({
      headers: adminHeader,
      method: "POST",
      payload: { action: "withdraw", reason: "批注违反已经确认的社区治理规则。" },
      url: `/v1/admin/annotations/${annotationId}/moderate`
    });
    assert.equal(withdrawn.statusCode, 200, withdrawn.body);
    assert.ok(db.prepare("SELECT withdrawn_at FROM annotations_v2 WHERE id = ?").get(annotationId).withdrawn_at);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2 WHERE annotation_id = ?").get(annotationId).count, 1);
  });
});

test("annotation visibility is enforced and organization access fails closed", async () => {
  await withApp(async (app) => {
    const privateAnnotation = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ shareToPlaza: false, visibility: "private" }),
      url: "/v1/annotations"
    });
    assert.equal(privateAnnotation.statusCode, 201, privateAnnotation.body);
    const id = privateAnnotation.json().annotation.id;
    assert.equal((await app.inject({ method: "GET", url: `/v1/annotations/${id}` })).statusCode, 404);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${id}` })).statusCode, 200);
    const unauthorizedReply = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: {
        body: "无权查看原批注的用户不能挂接回复。",
        publishAsAnnotation: false,
        tags: [],
        targets: []
      },
      url: `/v1/annotations/${id}/replies`
    });
    assert.equal(unauthorizedReply.statusCode, 404, unauthorizedReply.body);
    assert.equal(unauthorizedReply.json().error, "PARENT_ANNOTATION_NOT_FOUND");

    const organization = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ organizationId: "org-1", shareToPlaza: false, visibility: "organization" }),
      url: "/v1/annotations"
    });
    assert.equal(organization.statusCode, 403);
    assert.equal(organization.json().error, "ORGANIZATION_ACCESS_DENIED");
  });

  await withApp(async (app) => {
    const organization = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ organizationId: "org-1", shareToPlaza: false, visibility: "organization" }),
      url: "/v1/annotations"
    });
    assert.equal(organization.statusCode, 201, organization.body);
    const id = organization.json().annotation.id;
    assert.equal((await app.inject({ headers: sameNameHeader, method: "GET", url: `/v1/annotations/${id}` })).statusCode, 200);
  }, {
    authorizeOrganizationVisibility: async ({ organizationId, userId }) =>
      organizationId === "org-1" && new Set(["user-1", "user-2"]).has(userId)
  });
});

test("current organization owners and admins govern organization annotations with audit evidence", async () => {
  await withApp(async (app, db) => {
    const created = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: annotationV2Payload({ organizationId: "org-1", shareToPlaza: false, visibility: "organization" }),
      url: "/v1/annotations"
    });
    const annotationId = created.json().annotation.id;
    const moderate = (action) => app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { action, reason: "组织管理员根据当前社区规则执行内容治理。" },
      url: `/v1/annotations/${annotationId}/organization-moderation`
    });
    assert.equal((await moderate("withdraw")).statusCode, 200);
    const organizationFeed = await app.inject({ headers: sameNameHeader, method: "GET", url: "/v1/me/organization-annotations" });
    assert.equal(organizationFeed.statusCode, 200, organizationFeed.body);
    assert.equal(organizationFeed.json().organizations[0].annotations[0].withdrawnAt !== null, true);
    assert.equal(organizationFeed.json().organizations[0].annotations[0].viewerCanModerate, true);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${annotationId}` })).statusCode, 404);
    assert.equal((await moderate("restore")).statusCode, 200);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: `/v1/annotations/${annotationId}` })).statusCode, 200);
    assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2 WHERE annotation_id = ? AND admin_user_id = 'user-2'").get(annotationId).count, 2);
  }, {
    authorizeOrganizationAccess: async ({ organizationId, userId }) => ({
      allowed: organizationId === "org-1" && new Set(["user-1", "user-2"]).has(userId),
      role: userId === "user-2" ? "admin" : "member"
    }),
    authorizeOrganizationVisibility: async ({ organizationId, userId }) => organizationId === "org-1" && new Set(["user-1", "user-2"]).has(userId),
    listOrganizations: async (userId) => userId === "user-2" ? [{ name: "证据研究组织", organizationId: "org-1", role: "admin" }] : []
  });
});

test("direct messages require a current mutual follow and organization invitations are authoritative", async () => {
  const invitations = [];
  await withApp(async (app) => {
    const published = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "关注动态中的公开研究批注" }),
      url: "/v1/annotations"
    });
    assert.equal(published.statusCode, 201, published.body);
    const privateAnnotation = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "不应进入关注动态的私人批注", shareToPlaza: false, visibility: "private" }),
      url: "/v1/annotations"
    });
    const mutualAnnotation = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: annotationV2Payload({ body: "只对互关用户展示的研究批注", shareToPlaza: false, visibility: "mutual_followers" }),
      url: "/v1/annotations"
    });
    assert.equal(privateAnnotation.statusCode, 201, privateAnnotation.body);
    assert.equal(mutualAnnotation.statusCode, 201, mutualAnnotation.body);
    const follow = (headers, targetUserId) => app.inject({
      headers,
      method: "POST",
      payload: { targetUserId },
      url: "/v1/follows"
    });
    assert.equal((await follow(userHeader, "user-2")).statusCode, 200);
    const followingFeed = await app.inject({ headers: userHeader, method: "GET", url: "/v1/me/following-annotations" });
    assert.equal(followingFeed.statusCode, 200, followingFeed.body);
    assert.deepEqual(followingFeed.json().annotations.map((annotation) => annotation.id), [published.json().annotation.id]);
    assert.equal((await follow(sameNameHeader, "user-1")).json().mutual, true);
    const mutualFeed = await app.inject({ headers: userHeader, method: "GET", url: "/v1/me/following-annotations" });
    assert.deepEqual(new Set(mutualFeed.json().annotations.map((annotation) => annotation.id)), new Set([
      published.json().annotation.id,
      mutualAnnotation.json().annotation.id
    ]));
    const conversation = await app.inject({ headers: userHeader, method: "POST", payload: { participantId: "user-2" }, url: "/v1/conversations" });
    assert.equal(conversation.statusCode, 201, conversation.body);
    const conversationId = conversation.json().id;

    const invitation = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { body: "加入研究组", invitation: { organizationId: "org-1", role: "member" }, kind: "organization_invitation" },
      url: `/v1/conversations/${conversationId}/messages`
    });
    assert.equal(invitation.statusCode, 201, invitation.body);
    assert.equal(invitation.json().message.invitation.invitationId, "invite-1");
    assert.equal(invitations.length, 1);

    const conversations = await app.inject({ headers: userHeader, method: "GET", url: "/v1/conversations" });
    assert.equal(conversations.statusCode, 200, conversations.body);
    assert.equal(conversations.json().conversations.length, 1);
    assert.equal(conversations.json().conversations[0].participant.id, "user-2");
    assert.equal(conversations.json().conversations[0].lastMessage.kind, "organization_invitation");
    assert.equal(conversations.json().conversations[0].canSend, true);
    assert.equal(conversations.json().conversations[0].unreadCount, 0);

    const recipientHistory = await app.inject({ headers: sameNameHeader, method: "GET", url: `/v1/conversations/${conversationId}/messages` });
    assert.equal(recipientHistory.statusCode, 200, recipientHistory.body);
    const recipientInbox = await app.inject({ headers: sameNameHeader, method: "GET", url: "/v1/conversations" });
    assert.equal(recipientInbox.json().conversations[0].unreadCount, 1, "reading message history must not implicitly advance read state");
    const markedRead = await app.inject({
      headers: sameNameHeader,
      method: "PUT",
      payload: { messageId: invitation.json().message.id },
      url: `/v1/conversations/${conversationId}/read`
    });
    assert.equal(markedRead.statusCode, 200, markedRead.body);
    assert.deepEqual(markedRead.json(), { lastReadMessageId: invitation.json().message.id, unreadCount: 0 });
    assert.equal((await app.inject({ headers: sameNameHeader, method: "GET", url: "/v1/conversations" })).json().conversations[0].unreadCount, 0);

    const reply = await app.inject({
      headers: sameNameHeader,
      method: "POST",
      payload: { body: "我会核对这份邀请", kind: "text" },
      url: `/v1/conversations/${conversationId}/messages`
    });
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal((await app.inject({ headers: userHeader, method: "GET", url: "/v1/conversations" })).json().conversations[0].unreadCount, 1);
    const invalidRead = await app.inject({
      headers: userHeader,
      method: "PUT",
      payload: { messageId: "message_from_another_conversation" },
      url: `/v1/conversations/${conversationId}/read`
    });
    assert.equal(invalidRead.statusCode, 400);
    assert.equal(invalidRead.json().error, "INVALID_READ_STATE");

    await follow(sameNameHeader, "user-1");
    const blocked = await app.inject({
      headers: userHeader,
      method: "POST",
      payload: { body: "这条消息不应发送", kind: "text" },
      url: `/v1/conversations/${conversationId}/messages`
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error, "MUTUAL_FOLLOW_REQUIRED");
    const history = await app.inject({ headers: userHeader, method: "GET", url: `/v1/conversations/${conversationId}/messages` });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().messages.length, 2);
    const readonlyConversations = await app.inject({ headers: userHeader, method: "GET", url: "/v1/conversations" });
    assert.equal(readonlyConversations.json().conversations[0].canSend, false);
  }, {
    authorizeOrganizationInvitation: async (input) => {
      invitations.push(input);
      return { invitationId: "invite-1" };
    }
  });
});

test("users with the same display name cannot withdraw each other's posts", async () => {
  await withApp(async (app, db) => {
    db.prepare("INSERT INTO posts (id, topic_id, body, author_id, author_name, author_initials, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("owned-post", "topic-1", "owned", "user-1", "林立", "LL", "2026-01-02T00:00:00.000Z");

    const forbidden = await app.inject({ method: "DELETE", url: "/v1/posts/owned-post", headers: sameNameHeader });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error, "NOT_POST_AUTHOR");

    const withdrawn = await app.inject({ method: "DELETE", url: "/v1/posts/owned-post", headers: userHeader });
    assert.equal(withdrawn.statusCode, 200);
  });
});

test("platform admins moderate posts through an isolated audience and audit every action", async () => {
  await withApp(async (app, db) => {
    const ordinarySession = await app.inject({
      method: "GET",
      url: "/v1/admin/posts",
      headers: userHeader
    });
    assert.equal(ordinarySession.statusCode, 401);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/posts",
      headers: adminHeader
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().posts[0].id, "post-1");

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/admin/posts/post-1/moderate",
      headers: adminHeader,
      payload: { action: "withdraw", reason: "Confirmed policy violation" }
    });
    assert.equal(withdrawn.statusCode, 200);
    assert.ok(db.prepare("SELECT withdrawn_at FROM posts WHERE id = 'post-1'").get().withdrawn_at);

    const restored = await app.inject({
      method: "POST",
      url: "/v1/admin/posts/post-1/moderate",
      headers: adminHeader,
      payload: { action: "restore", reason: "Appeal accepted after review" }
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(db.prepare("SELECT withdrawn_at FROM posts WHERE id = 'post-1'").get().withdrawn_at, null);
    assert.deepEqual(
      db.prepare("SELECT action, admin_user_id FROM moderation_audit ORDER BY rowid").all(),
      [
        { action: "withdraw", admin_user_id: "admin-1" },
        { action: "restore", admin_user_id: "admin-1" }
      ]
    );
  });
});

test("following, saving, signals, and comments are scoped to the verified user", async () => {
  await withApp(async (app) => {
    const follow = await app.inject({ method: "POST", url: "/v1/topics/topic-1/follow", headers: userHeader });
    assert.deepEqual(follow.json(), { following: true, followerCount: 1 });
    const save = await app.inject({ method: "POST", url: "/v1/posts/post-1/save", headers: userHeader });
    assert.deepEqual(save.json(), { saved: true });
    const signal = await app.inject({ method: "POST", url: "/v1/posts/post-1/signals", headers: userHeader, payload: { signal: "helpful" } });
    assert.equal(signal.statusCode, 200);
    assert.equal(signal.json().selectedSignal, "helpful");

    const createComment = await app.inject({ method: "POST", url: "/v1/posts/post-1/comments", headers: userHeader, payload: { body: "补充证据链。" } });
    assert.equal(createComment.statusCode, 201);
    assert.equal(createComment.json().comment.author_id, "user-1");

    const saved = await app.inject({ method: "GET", url: "/v1/me/saved", headers: userHeader });
    assert.equal(saved.json().posts[0].id, "post-1");
    const otherSaved = await app.inject({ method: "GET", url: "/v1/me/saved", headers: sameNameHeader });
    assert.deepEqual(otherSaved.json().posts, []);
  });
});

test("old forum databases gain nullable author id columns without losing rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intuecho-migration-"));
  const databasePath = join(directory, "old.db");
  const oldDb = new Database(databasePath);
  oldDb.exec(`
    CREATE TABLE posts (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, work_id TEXT, title TEXT, body TEXT NOT NULL, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, page INTEGER, excerpt TEXT, anchor_hash TEXT, helpful INTEGER NOT NULL DEFAULT 0, misleading INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, withdrawn_at TEXT);
    CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, body TEXT NOT NULL, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO posts (id, topic_id, body, author_name, author_initials, created_at) VALUES ('legacy', 'topic', 'body', 'name', 'N', '2026-01-01');
  `);
  oldDb.close();

  const { app, db } = await createIntuechoApp({
    adminIdentityVerifier,
    databasePath,
    identityVerifier
  });
  try {
    assert.ok(db.prepare("PRAGMA table_info(posts)").all().some((column) => column.name === "author_id"));
    assert.ok(db.prepare("PRAGMA table_info(comments)").all().some((column) => column.name === "author_id"));
    assert.equal(db.prepare("SELECT body FROM posts WHERE id = 'legacy'").get().body, "body");
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

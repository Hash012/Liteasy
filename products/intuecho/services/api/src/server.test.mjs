import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { literatureRecordSchema } from "@intuecho/contracts";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";
import { createIntuechoApp } from "./server.mjs";
import { IdentityVerificationError } from "./identityVerifier.mjs";

const identities = new Map([
  ["user-token", { id: "user-1", name: "林立", initials: "LL" }],
  ["same-name-token", { id: "user-2", name: "林立", initials: "LL" }]
]);
const userHeader = { authorization: "Bearer user-token" };
const sameNameHeader = { authorization: "Bearer same-name-token" };
const adminHeader = { authorization: "Bearer admin-token" };
const desktopHeader = { authorization: "Bearer desktop-token" };
const otherDesktopHeader = { authorization: "Bearer other-desktop-token" };

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

function insertFixture(db) {
  db.prepare("INSERT INTO topics (id, name, description, guide, follower_count) VALUES (?, ?, ?, ?, ?)")
    .run("topic-1", "可靠性", "讨论证据边界。", "由社区共同维护。", 0);
  db.prepare("INSERT INTO works (id, topic_id, title, authors, year, venue, identifier, abstract) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("work-1", "topic-1", "A Reliable Paper", "Author", 2025, "Venue", "doi:1", "Abstract");
  db.prepare("INSERT INTO posts (id, topic_id, work_id, title, body, author_id, author_name, author_initials, page, excerpt, anchor_hash, helpful, misleading, created_at, withdrawn_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
    .run("post-1", "topic-1", "work-1", "证据边界", "一条真实测试帖子。", "author-1", "作者甲", "A", 2, "source", "sha256:source", 1, 0, "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO comments (id, post_id, body, author_id, author_name, author_initials, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("comment-1", "post-1", "一条测试讨论。", "author-2", "作者乙", "B", "2026-01-01T01:00:00.000Z");
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
        identifiers: [{ kind: "doi", source: input.mode === "manual" ? "manual" : "public_registry", value: "10.1000/reliable" }],
        literatureId: "literature-1",
        provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: input.mode === "manual" ? "manual" : "public_registry" },
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
    ...overrides
  };
}

test("literature routes accept authenticated Web and desktop audiences while rejecting anonymous requests", async () => {
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
    assert.equal(desktop.statusCode, 200, desktop.body);
    assert.equal(desktop.json().status, "exact");
  }, { literatureResolver: literatureResolver() });
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
      literature: {
        identity,
        metadata: { authors: ["Author"], documentType: "journal_article", title: "A Reliable Paper", year: 2025 }
      },
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
    id, title, authors_json, publication_year, document_type, record_source,
    source_provider, confirmed_at, revision, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?, 1, ?, ?)`)
    .run(literatureId, "Server Confirmed Publication Literature", JSON.stringify(["Confirmed Author"]), 2026, "journal_article", now, now, now);
  db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, 'doi', ?, 'manual', ?)")
    .run(literatureId, "10.1000/confirmed-publication", now);
  return literatureId;
}

function annotationV2Payload(overrides = {}) {
  const literature = {
    identity: {
      id: "doi:10.1000/reliable",
      kind: "doi",
      source: "metadata",
      value: "10.1000/reliable"
    },
    metadata: {
      authors: ["Author"],
      documentType: "journal_article",
      title: "A Reliable Paper",
      year: 2025
    }
  };
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

test("persists manual literature provenance, immutable corrections, and identity conflicts", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const owner = { id: "literature-owner", name: "Ada Lovelace", initials: "AL" };
  const first = await repository.confirmLiterature(owner, {
    mode: "manual",
    record: {
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      title: "Manual Record",
      year: 1843
    }
  });
  assert.equal(first.provenance.mode, "manual");
  assert.equal((await repository.findLiteratureByIdentifiers(first.identifiers)).literatureId, first.literatureId);
  assert.equal((await repository.findLiteratureById(first.literatureId)).literatureId, first.literatureId);
  const concurrent = await Promise.all([
    repository.confirmLiterature(owner, {
      mode: "manual",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
        title: "Manual Record",
        year: 1843
      }
    }),
    repository.confirmLiterature(owner, {
      mode: "manual",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
        title: "Manual Record",
        year: 1843
      }
    })
  ]);
  assert.deepEqual(concurrent.map((item) => item.literatureId), [first.literatureId, first.literatureId]);
  await repository.confirmLiterature(owner, {
    mode: "manual",
    record: {
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      title: "Corrected Manual Record",
      year: 1843
    }
  });
  const version = db.prepare("SELECT revision, snapshot_json FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").get(first.literatureId);
  assert.equal(version.revision, 1);
  assert.equal(JSON.parse(version.snapshot_json).title, "Manual Record");
  assert.throws(
    () => db.prepare("UPDATE literature_record_versions_v2 SET changed_by = ? WHERE literature_id = ? AND revision = 1").run("tampered", first.literatureId),
    /literature_record_version_is_append_only/
  );
  assert.throws(
    () => db.prepare("DELETE FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = 1").run(first.literatureId),
    /literature_record_version_is_append_only/
  );

  const second = await repository.confirmLiterature(owner, {
    mode: "manual",
    record: {
      authors: ["Grace Hopper"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/other" }],
      title: "Other Record",
      year: 1952
    }
  });
  await assert.rejects(
    () => repository.confirmLiterature(owner, {
      mode: "manual",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [
          { kind: "doi", source: "manual", value: "10.1000/manual" },
          { kind: "doi", source: "manual", value: "10.1000/other" }
        ],
        title: "Conflict",
        year: 1843
      }
    }),
    (error) => error?.code === "LITERATURE_IDENTITY_CONFLICT"
  );
  const firstAfterConflict = await repository.findLiteratureByIdentifiers(first.identifiers);
  assert.equal(firstAfterConflict.title, "Corrected Manual Record");
  assert.equal(firstAfterConflict.provenance.mode, "manual");
  assert.equal(firstAfterConflict.identifiers.every((identifier) => identifier.source === "manual"), true);
  assert.equal(literatureRecordSchema.safeParse(firstAfterConflict).success, true);
  assert.equal((await repository.findLiteratureByIdentifiers(second.identifiers)).literatureId, second.literatureId);
  db.close();
});

test("separates manual confirmation from refetched candidates and resolves canonical targets", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  const owner = { id: "candidate-owner", name: "Ada Lovelace", initials: "AL" };
  await assert.rejects(
    () => repository.confirmLiterature(owner, {
      mode: "candidate",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/spoof" }],
        title: "Spoofed Candidate",
        year: 1843
      }
    }),
    (error) => error?.code === "LITERATURE_CONFIRMATION_INVALID"
  );
  await assert.rejects(
    () => repository.confirmLiterature(owner, {
      mode: "public_registry",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/spoof" }],
        title: "Spoofed Candidate",
        year: 1843
      }
    }),
    (error) => error?.code === "LITERATURE_CONFIRMATION_INVALID"
  );
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

test("reuses legacy normalized DOI values and preserves untouched legacy provenance", async () => {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, record_source, revision, created_at, updated_at) VALUES (?, ?, ?, 'legacy_metadata', 1, ?, ?)")
    .run("legacy-record", "Legacy DOI", JSON.stringify(["A. Author"]), "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, 'doi', ?, 'metadata', ?)")
    .run("legacy-record", "https://doi.org/10.1000/legacy", "2026-08-09T00:00:00.000Z");
  assert.equal(await repository.findLiteratureByIdentifiers([{ kind: "doi", value: "10.1000/legacy" }]), null);
  assert.equal(await repository.findLiteratureById("legacy-record"), null);
  const untouched = await repository.searchStoredLiterature("Legacy DOI", 10);
  assert.deepEqual(untouched, []);
  assert.equal(db.prepare("SELECT identity_source FROM literature_identities_v2 WHERE literature_id = ?").get("legacy-record").identity_source, "metadata");
  const confirmed = await repository.confirmLiterature({ id: "legacy-owner" }, {
    mode: "manual",
    record: {
      authors: ["A. Author"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/legacy" }],
      title: "Corrected Legacy DOI"
    }
  });
  assert.equal(confirmed.provenance.mode, "manual");
  assert.equal(confirmed.literatureId, "legacy-record");
  assert.equal(confirmed.identifiers.every((identifier) => identifier.source === "manual"), true);
  assert.equal(db.prepare("SELECT identity_source FROM literature_identities_v2 WHERE literature_id = ?").get("legacy-record").identity_source, "manual");
  db.close();
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

test("acquires PostgreSQL literature identity locks in canonical key order", async () => {
  const lockKeys = [];
  const row = {
    authors: [],
    confirmed_at: new Date("2026-08-09T00:00:00.000Z"),
    created_at: new Date("2026-08-09T00:00:00.000Z"),
    document_type: null,
    id: "literature_lock_order",
    record_source: "manual",
    revision: 1,
    source_provider: null,
    title: "Lock order",
    updated_at: new Date("2026-08-09T00:00:00.000Z"),
    publication_year: null
  };
  const client = {
    async query(sql, values = []) {
      if (sql.includes("pg_advisory_xact_lock")) lockKeys.push(values[0]);
      if (sql.startsWith("SELECT * FROM literature_records")) return { rows: [row] };
      if (sql.startsWith("SELECT identity_kind AS kind")) return { rows: [] };
      if (sql.includes("SELECT literature_id FROM literature_identities")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const repository = new PostgresAnnotationCommunityRepository(pool);
  await repository.confirmLiterature({ id: "lock-owner" }, {
    mode: "manual",
    record: {
      authors: ["Lock Owner"],
      identifiers: [
        { kind: "doi", source: "manual", value: "10.1000/z" },
        { kind: "arxiv_id", source: "manual", value: "2401.0001" }
      ],
      title: "Lock order"
    }
  });
  assert.deepEqual(lockKeys, ["arxiv_id:2401.0001", "doi:10.1000/z"]);
});

test("replays PostgreSQL desktop publications when updated timestamps identify the same instant", async () => {
  const queries = [];
  const prior = {
    annotation_id: "annotation-remote-1",
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
  const [replayed] = await repository.applyDesktopAnnotationPublications({ id: "user-1" }, [publicationOperation({
    revision: 2,
    updatedAt: "2026-08-09T02:00:00.0000Z"
  })]);
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
  const lockKeys = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("pg_advisory_xact_lock")) lockKeys.push(values[0]);
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
  assert.deepEqual(lockKeys, [
    "desktop-publication:publication-owner:queue-a",
    "desktop-publication:publication-owner:queue-z"
  ]);
  assert.deepEqual(results.map((result) => result.queueKey), ["queue-z", "queue-a"]);
});

test("does not serialize untouched PostgreSQL legacy rows as canonical literature", async () => {
  const legacyRow = {
    authors: ["Legacy Author"],
    document_type: null,
    id: "legacy-postgres",
    publication_year: 2020,
    record_source: "legacy_metadata"
  };
  const pool = {
    async query(sql) {
      if (sql.includes("identity_kind = ANY")) {
        return { rows: [{ identity_kind: "doi", identity_value: "https://doi.org/10.1000/legacy", literature_id: "legacy-postgres" }] };
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
    assert.equal(consumed.json().draft.targets[0].literature.identity.value, "10.1000/reliable");
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
      url: "/v1/pdf-annotations:sync",
      headers: desktopHeader,
      payload: { annotations: [annotationPayload()] }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().results[0].status, "synced");
    const remoteId = first.json().results[0].intuechoAnnotationId;

    const updated = await app.inject({
      method: "POST",
      url: "/v1/pdf-annotations:sync",
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
          paperIdentity: {
            id: "doi:10.1000/reliable",
            kind: "doi",
            source: "metadata",
            value: "10.1000/reliable"
          }
        }
      }
    });
    assert.equal(recommendations.statusCode, 200);
    assert.equal(recommendations.json().recommendations.length, 2);
    assert.ok(recommendations.json().recommendations.every((item) => item.paperIdentity.id === "doi:10.1000/reliable"));

    const unrelated = await app.inject({
      method: "POST",
      url: "/v1/thin-reading/recommendations:query",
      headers: desktopHeader,
      payload: {
        scope: {
          kind: "document",
          paperIdentity: {
            id: "doi:10.1000/other",
            kind: "doi",
            source: "metadata",
            value: "10.1000/other"
          }
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
        shareToPlaza: false,
        tags: [],
        targets: [],
        visibility: "public"
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
        shareToPlaza: true,
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
        shareToPlaza: false,
        tags: [],
        targets: [],
        visibility: "private"
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

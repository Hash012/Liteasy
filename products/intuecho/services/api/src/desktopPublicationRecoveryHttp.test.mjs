import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { thinReadingSyncPayload } from "@intuecho/contracts";
import { SqliteAnnotationCommunityRepository, desktopAnnotationPublicationDigest } from "./annotationCommunitySqlite.mjs";
import { createIntuechoApp } from "./server.mjs";
import { createProductionIntuechoApp } from "./productionApp.mjs";
import { IdentityVerificationError } from "./identityVerifier.mjs";
import { ProductionIdentityError } from "./productionIdentity.mjs";

const timestamp = "2026-10-03T01:00:00.000Z";
const headers = { authorization: "Bearer synthetic-desktop" };
const otherHeaders = { authorization: "Bearer synthetic-other-desktop" };
const webHeaders = { authorization: "Bearer synthetic-web" };
const identities = new Map([
  ["synthetic-desktop", { audience: "liteasy-desktop", id: "synthetic-owner", name: "Synthetic Owner", initials: "SO" }],
  ["synthetic-other-desktop", { audience: "liteasy-desktop", id: "synthetic-other", name: "Synthetic Owner", initials: "SO" }],
  ["synthetic-web", { audience: "intuecho-web", id: "synthetic-owner", name: "Synthetic Owner", initials: "SO" }]
]);

async function setup(t, entrypoint) {
  const audienceChecks = [];
  let app;
  let db;
  const directory = await mkdtemp(join(tmpdir(), "intuecho-recovery-http-"));
  t.after(async () => { if (app) await app.close(); if (db) db.close(); await rm(directory, { recursive: true, force: true }); });
  if (entrypoint === "development") {
    const verifier = (audience) => async (token) => {
      audienceChecks.push(audience);
      const identity = identities.get(token);
      if (identity?.audience !== audience) throw new IdentityVerificationError("INVALID_SESSION_AUDIENCE", "Synthetic wrong audience", 403);
      return identity;
    };
    ({ app, db } = await createIntuechoApp({ databasePath: join(directory, "community.sqlite"), identityVerifier: verifier("intuecho-web"), desktopIdentityVerifier: verifier("liteasy-desktop") }));
  } else {
    db = new Database(":memory:");
    app = await createProductionIntuechoApp({
      annotationCommunityRepository: new SqliteAnnotationCommunityRepository(db), repository: {}, literatureResolver: {},
      readiness: {}, identityVerifier: { async verifyAuthorizationHeader(header, audience) {
        audienceChecks.push(audience);
        const identity = identities.get(header.replace(/^Bearer /u, ""));
        if (identity?.audience !== audience) throw new ProductionIdentityError("invalid_session_audience", 403);
        return { audience, subject: identity.id, name: identity.name };
      } }
    }, { allowedOrigins: [], database: { sslMode: "disable" }, environment: "test",
      identity: { issuer: "http://identity.invalid", webClientId: "intuecho-web" },
      literatureProjection: { audience: "intuecho-internal", clientId: "synthetic-service" } });
  }
  db.prepare(`INSERT INTO literature_records_v2(id,title,authors_json,publication_year,version_kind,record_source,source_provider,
    confirmed_at,revision,confirmation_status,created_at,updated_at) VALUES ('literature-1','Synthetic source','[]',2026,
    'journal_article','public_registry','crossref',?,1,'confirmed',?,?)`).run(timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO literature_identifiers_v2(id,literature_id,identifier_kind,identifier_role,normalized_value,is_legacy_alias,created_at)
    VALUES ('identifier-1','literature-1','doi','confirmable','10.1000/synthetic-http',0,?)`).run(timestamp);
  db.prepare(`INSERT INTO literature_identity_claims_v2(id,identifier_id,provider,provider_record_id,verification_status,evidence_json,observed_at,created_at)
    VALUES ('claim-1','identifier-1','crossref','10.1000/synthetic-http','confirmed','{}',?,?)`).run(timestamp, timestamp);
  const requests = [];
  async function send(url, payload, { loseResponse = false, authorization = headers } = {}) {
    requests.push({ url, payload });
    const response = await app.inject({ method: "POST", url, headers: authorization, payload });
    assert.equal(response.statusCode, 200, response.body);
    // Discard the completed HTTP result after the real SQLite transaction. The
    // simulated client must recover its remote ID from a later read-only route.
    if (loseResponse) throw new Error("synthetic_response_lost_after_commit");
    return response.json();
  }
  return { app, db, send, requests, audienceChecks };
}

for (const entrypoint of ["development", "production"]) {
  test(`${entrypoint} HTTP recovers lost PDF create and retract responses by read-only ledger lookup`, async (t) => {
    const { db, send, requests, audienceChecks } = await setup(t, entrypoint);
    const reviewed = await send("/v1/integrations/desktop/publication-profile", {});
    assert.equal(reviewed.author.id, "synthetic-owner");
    const original = { annotationId: "pdf-local", queueKey: "pdf:local", revision: 1, operation: "upsert", updatedAt: timestamp,
      body: "Original synthetic PDF note", literatureId: "literature-1", expectedAuthorProfileRevision: reviewed.profile.revision,
      sourcePassage: { anchorHash: "synthetic-anchor", excerpt: "Original synthetic excerpt", rects: [] } };
    await assert.rejects(() => send("/v1/pdf-annotations:sync", { operations: [original] }, { loseResponse: true }), /response_lost_after_commit/u);
    assert.equal(db.prepare("SELECT count(*) n FROM annotations_v2").get().n, 1);
    const query = { annotationId: original.annotationId, queueKey: original.queueKey, revision: original.revision,
      updatedAt: original.updatedAt, operationDigest: desktopAnnotationPublicationDigest(original) };
    const before = db.serialize();
    const wrongOwner = await send("/v1/pdf-annotations:lookup", { queries: [query] }, { authorization: otherHeaders });
    assert.equal(wrongOwner.results[0].status, "not_found");
    const recovered = (await send("/v1/pdf-annotations:lookup", { queries: [query] })).results[0];
    assert.equal(recovered.status, "matched");
    assert.equal(recovered.receipt.state, "published");
    assert.deepEqual(db.serialize(), before);
    const retract = { annotationId: original.annotationId, queueKey: original.queueKey, revision: 2, operation: "retract",
      remoteAnnotationId: recovered.receipt.remoteAnnotationId, updatedAt: "2026-10-03T02:00:00.000Z" };
    await assert.rejects(() => send("/v1/pdf-annotations:sync", { operations: [retract] }, { loseResponse: true }), /response_lost_after_commit/u);
    const withdrawn = (await send("/v1/pdf-annotations:lookup", { queries: [{ annotationId: retract.annotationId, queueKey: retract.queueKey,
      revision: retract.revision, updatedAt: retract.updatedAt, operationDigest: desktopAnnotationPublicationDigest(retract) }] })).results[0];
    assert.equal(withdrawn.status, "matched");
    assert.equal(withdrawn.receipt.state, "retracted");
    assert.deepEqual(db.prepare("SELECT body,visibility,share_to_plaza,revision FROM annotations_v2").get(),
      { body: original.body, visibility: "private", share_to_plaza: 0, revision: 2 });
    assert.equal(requests.flatMap((request) => request.payload.operations ?? []).filter((operation) => operation.operation === "upsert").length, 1);
    assert.equal(requests.flatMap((request) => request.payload.operations ?? []).filter((operation) => operation.operation === "retract").length, 1);
    assert.equal(requests.filter((request) => request.url.endsWith(":lookup")).some((request) => /Original synthetic/u.test(JSON.stringify(request.payload))), false);
    assert.equal(audienceChecks.every((audience) => audience === "liteasy-desktop"), true);
  });

  test(`${entrypoint} HTTP withdraws an unknown thin-reading create without re-sending the original body`, async (t) => {
    const { db, send, requests } = await setup(t, entrypoint);
    const reviewed = await send("/v1/integrations/desktop/publication-profile", {});
    const original = { annotationId: "thin-local", queueKey: "artifact:thin-local", status: "pending_public", createdAt: timestamp, updatedAt: timestamp,
      body: "Original synthetic thin note", expectedAuthorProfileRevision: reviewed.profile.revision,
      targets: [{ kind: "source_passage", literature: { literatureId: "literature-1" }, anchorHash: "synthetic-anchor", excerpt: "Synthetic evidence", rects: [] }] };
    await assert.rejects(() => send("/v1/thin-reading/annotations:sync", { annotations: [original] }, { loseResponse: true }), /response_lost_after_commit/u);
    const query = { annotationId: original.annotationId, queueKey: original.queueKey, updatedAt: original.updatedAt,
      payloadDigest: createHash("sha256").update(thinReadingSyncPayload(original)).digest("hex") };
    const before = db.serialize();
    assert.equal((await send("/v1/thin-reading/annotations:lookup", { queries: [query] }, { authorization: otherHeaders })).results[0].status, "not_found");
    const recovered = (await send("/v1/thin-reading/annotations:lookup", { queries: [query] })).results[0];
    assert.equal(recovered.status, "matched");
    assert.deepEqual(db.serialize(), before);
    const retract = { annotationId: original.annotationId, queueKey: original.queueKey, revision: recovered.publicationRevision + 1,
      operation: "retract", remoteAnnotationId: recovered.remoteAnnotationId, updatedAt: "2026-10-03T02:00:00.000Z" };
    assert.equal((await send("/v1/pdf-annotations:sync", { operations: [retract] })).results[0].state, "retracted");
    assert.deepEqual(db.prepare("SELECT body,visibility,share_to_plaza,revision FROM annotations_v2").get(),
      { body: original.body, visibility: "private", share_to_plaza: 0, revision: 2 });
    assert.equal(requests.filter((request) => request.url === "/v1/thin-reading/annotations:sync").length, 1);
    assert.equal(requests.flatMap((request) => request.payload.operations ?? []).some((operation) => operation.operation === "upsert"), false);
  });

  test(`${entrypoint} HTTP rejects Web audience on both publication lookups and profile read`, async (t) => {
    const { app, audienceChecks } = await setup(t, entrypoint);
    for (const url of ["/v1/pdf-annotations:lookup", "/v1/thin-reading/annotations:lookup", "/v1/integrations/desktop/publication-profile"]) {
      const response = await app.inject({ method: "POST", url, headers: webHeaders, payload: {} });
      assert.equal(response.statusCode, 403, response.body);
      assert.match(response.body, /audience/iu);
      const unauthenticated = await app.inject({ method: "POST", url, payload: {} });
      assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    }
    assert.deepEqual(audienceChecks, ["liteasy-desktop", "liteasy-desktop", "liteasy-desktop"]);
  });
}

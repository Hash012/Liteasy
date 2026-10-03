import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { communityCommandPayload } from "@intuecho/contracts";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { registerAnnotationCommunityRoutes } from "./annotationCommunityRoutes.mjs";

test("HTTP lost-response recovery is read-only and old content edits fail with 428", async () => {
  const db = new Database(":memory:"); const app = Fastify();
  const repository = new SqliteAnnotationCommunityRepository(db);
  const actor = { id: "http-command-actor", name: "Synthetic", initials: "SY" };
  const literature = await repository.confirmRefetchedLiterature(actor, { candidateKey: "crossref:doi:10.1000/http-command", provider: "crossref", record: { title: "HTTP command fixture", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/http-command" }], year: 2026 } });
  const identity = (request) => ({ ...actor, id: request.headers["x-synthetic-actor"] ?? actor.id });
  registerAnnotationCommunityRoutes(app, repository, { currentUser: identity, requireUser: identity });
  try {
    const input = { body: "Synthetic response lost after commit", visibility: "public", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
    input.command = { protocolVersion: 1, operationId: randomUUID(), bodyDigest: createHash("sha256").update(communityCommandPayload("create_annotation", null, input)).digest("hex") };
    // Server commits; client deliberately discards its response.
    assert.equal((await app.inject({ method: "POST", url: "/v1/annotations", payload: input })).statusCode, 201);
    const before = db.serialize();
    const lookupUrl = `/v1/community-commands/create_annotation/${input.command.operationId}`;
    const lookup = await app.inject({ method: "GET", url: lookupUrl });
    assert.equal(lookup.statusCode, 200); assert.equal(lookup.json().status, "committed");
    assert.deepEqual(db.serialize(), before);
    assert.deepEqual((await app.inject({ method: "GET", url: lookupUrl, headers: { "x-synthetic-actor": "other" } })).json(), { status: "not_found" });
    const id = lookup.json().result.annotation.id;
    assert.equal((await app.inject({ method: "PUT", url: `/v1/annotations/${id}`, payload: { body: "Unversioned" } })).statusCode, 428);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/annotations/${id}`, payload: { body: "Current", expectedRevision: 1 } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/annotations/${id}`, payload: { body: "Stale", expectedRevision: 1 } })).statusCode, 409);
  } finally { await app.close(); db.close(); }
});

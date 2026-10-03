import assert from "node:assert/strict";
import test from "node:test";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";
import { PostgresPersonalizationRepository } from "./personalizationRepository.mjs";
import { PostgresRecommendationRepository } from "./recommendationRepository.mjs";
import { PostgresAgentArtifactRepository } from "./agentArtifactRepository.mjs";

const subject = "deleted_user";
const scope = { scopeType: "user", scopeId: subject };
const input = { actorId: subject, expectedRevision: 0, expectedVersion: 0, idempotencyKey: "late-write-0001", traceId: "late-write" };
const artifact = {
  agent: { runId: "run_1", status: "completed" },
  artifactId: "artifact_1", artifactType: "tree", createdAt: "2026-10-03T00:00:00.000Z",
  title: "Late result", version: "liteasy.agent-artifact/v1"
};
const pdfInput = { ...input, fileName: "Paper.pdf", documentId: "document_1" };
const stagedPdf = {
  byteLength: 10, contentHash: "a".repeat(64), storageKey: "documents/.staging/upload_1",
  securityScan: { contentHash: "a".repeat(64), scannedAt: "2026-10-03T00:00:00.000Z", scanner: "test", version: "1" }
};

function deletedAccountPool() {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM account_deletion_jobs")) return { rows: [{ subject_id: subject }] };
      if (sql.includes("FROM personalization_states")) return { rows: [{ enabled: true, version: 0 }] };
      if (sql.includes("revision FROM library_scope_revisions")) return { rows: [{ revision: 0 }] };
      if (sql.includes("UPDATE library_scope_revisions")) return { rows: [{ revision: 1 }] };
      if (sql.includes("INSERT INTO library_folders")) return { rows: [{ folder_id: "folder_1", created_at: new Date(), updated_at: new Date() }] };
      if (sql.includes("RETURNING revision")) return { rows: [{ revision: 1 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return { queries, pool: { ...client, async connect() { return client; } } };
}

const mutations = [
  ["personal library folder", (pool) => new PostgresLibraryRepository(pool).createFolder(scope, { ...input, name: "Late folder" })],
  ["PDF upload preparation", (pool) => new PostgresLibraryRepository(pool).preparePdfUpload(scope, pdfInput, stagedPdf)],
  ["PDF attachment preparation", (pool) => new PostgresLibraryRepository(pool).prepareMetadataPdfAttachment(scope, pdfInput, stagedPdf)],
  ["delayed PDF publication", (pool) => new PostgresLibraryRepository(pool).completePdfUpload({ actor_id: subject, workflow_id: "workflow_1" }, input.traceId)],
  ["personalization profile", (pool) => new PostgresPersonalizationRepository(pool).saveProfile(subject, { ...input, profile: { stage: "硕士研究生", disciplines: [] } })],
  ["local metadata manifest", (pool) => new PostgresPersonalizationRepository(pool).syncLocalManifest(subject, { ...input, documents: [] })],
  ["recommendation candidates", (pool) => new PostgresRecommendationRepository(pool).saveCandidates(subject, [], input.traceId)],
  ["recommendation cache", (pool) => new PostgresRecommendationRepository(pool).putCache(subject, { personalizationVersion: 0, recommendations: [], selectionKey: "selection:12345678", workspaceKey: "workspace:12345678", sortMode: "relevance" })],
  ["recommendation feedback", (pool) => new PostgresRecommendationRepository(pool).recordFeedback(subject, { ...input, action: "saved", candidate: { id: "paper_1", source: "catalog", title: "Paper" } })],
  ["agent artifact", (pool) => new PostgresAgentArtifactRepository(pool).save(subject, artifact, input.traceId)]
];

for (const [name, mutate] of mutations) {
  test(`rejects a previously authenticated ${name} write after deletion starts`, async () => {
    const { queries, pool } = deletedAccountPool();
    await assert.rejects(() => mutate(pool), (error) => error.code === "account_deletion_started" && error.status === 409);
    assert.equal(queries.some(({ sql }) => /INSERT|UPDATE|DELETE/.test(sql)), false);
    assert.equal(queries[0].sql, "BEGIN ISOLATION LEVEL READ COMMITTED");
    assert.deepEqual(queries.find(({ sql }) => sql.includes("pg_advisory_xact_lock"))?.values, [`account-deletion:${subject}`]);
    assert.equal(queries.at(-1).sql, "ROLLBACK");
  });
}

test("reading recommendation context never recreates private account state", async () => {
  const { queries, pool } = deletedAccountPool();
  await new PostgresRecommendationRepository(pool).context(subject);
  assert.equal(queries.some(({ sql }) => /INSERT|UPDATE|DELETE/.test(sql)), false);
});

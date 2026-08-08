import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createExternalKnowledgeRunRepository } from "./externalKnowledgeRunRepository.mjs";

test("external search run cache is isolated by stable owner scope", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  try {
    const repository = createExternalKnowledgeRunRepository(database);
    const alice = {
      artifactId: "thin-reading-1",
      query: "retrieval augmented generation",
      sessionId: "user:alice"
    };
    repository.begin(alice);
    repository.complete(alice, { results: [{ id: "paper-1" }], status: "success" });

    const reused = repository.begin(alice);
    assert.equal(reused.run.reused, true);
    assert.equal(reused.payload.results[0].id, "paper-1");

    const bob = repository.begin({ ...alice, sessionId: "user:bob" });
    assert.equal(bob.run.reused, false);
    assert.equal(bob.payload, undefined);
  } finally {
    database.close();
  }
});

test("external search run cache keeps at most 100 runs per owner", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  try {
    const repository = createExternalKnowledgeRunRepository(database);
    for (let index = 0; index < 101; index += 1) {
      repository.begin({
        artifactId: `artifact-${String(index).padStart(3, "0")}`,
        ownerScope: "user:alice",
        query: `query ${index}`
      });
    }
    repository.begin({
      artifactId: "artifact-bob",
      ownerScope: "user:bob",
      query: "independent"
    });

    assert.equal(database.prepare(
      "SELECT count(*) AS count FROM external_knowledge_runs WHERE owner_scope = ?"
    ).get("user:alice").count, 100);
    assert.equal(database.prepare(
      "SELECT count(*) AS count FROM external_knowledge_runs WHERE owner_scope = ?"
    ).get("user:bob").count, 1);
    assert.equal(database.prepare(
      "SELECT count(*) AS count FROM external_knowledge_runs WHERE owner_scope = ? AND artifact_id = ?"
    ).get("user:alice", "artifact-000").count, 0);
  } finally {
    database.close();
  }
});

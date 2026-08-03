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

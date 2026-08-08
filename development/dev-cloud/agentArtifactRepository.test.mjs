import assert from "node:assert/strict";
import test from "node:test";
import { createAgentArtifactRepository } from "./agentArtifactRepository.mjs";
import { createDatabase } from "./db/database.mjs";

function document(artifactId = "artifact-1") {
  return {
    agent: {
      apiVersion: "liteasy.agent/v1",
      runId: `run-${artifactId}`,
      sessionId: "session-1",
      status: "completed"
    },
    answer: "analysis",
    artifactId,
    artifactType: "mindmap",
    citations: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    papers: [{ id: "paper-1", title: "Paper 1" }],
    title: "Mind Map",
    uiDsl: { version: "liteasy.ui/v1" },
    version: "liteasy.agent-artifact/v1"
  };
}

function fixture() {
  const database = createDatabase({ databasePath: ":memory:" });
  const now = new Date().toISOString();
  for (const userId of ["user-a", "user-b"]) {
    database.prepare(`
      INSERT INTO users (id, email, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(userId, `${userId}@test.invalid`, userId, now, now);
  }
  return { database, repository: createAgentArtifactRepository(database) };
}

test("stores versioned Agent artifacts in the transaction database", (context) => {
  const { database, repository } = fixture();
  context.after(() => database.close());

  const saved = repository.save("user-a", document());
  repository.save("user-a", { ...document(), answer: "updated analysis" });

  assert.equal(saved.path, "liteasy://agent-artifacts/artifact-1");
  assert.equal(repository.list("user-a")[0].answer, "updated analysis");
  assert.equal(database.prepare("SELECT count(*) AS count FROM artifacts").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM artifact_versions").get().count, 2);
  assert.equal(database.prepare("SELECT count(*) AS count FROM generation_runs").get().count, 1);
});

test("isolates identical client artifact ids by account", (context) => {
  const { database, repository } = fixture();
  context.after(() => database.close());

  repository.save("user-a", document());
  repository.save("user-b", { ...document(), title: "User B map" });

  assert.equal(repository.list("user-a")[0].title, "Mind Map");
  assert.equal(repository.list("user-b")[0].title, "User B map");
  assert.equal(repository.rename("user-b", "artifact-1", "Renamed B").artifact.title, "Renamed B");
  assert.equal(repository.remove("user-a", "artifact-1").deleted, true);
  assert.deepEqual(repository.list("user-a"), []);
  assert.equal(repository.list("user-b")[0].title, "Renamed B");
});

test("rejects unsafe artifact ids", (context) => {
  const { database, repository } = fixture();
  context.after(() => database.close());
  assert.throws(() => repository.save("user-a", document("../escape")), /invalid_agent_artifact/);
  assert.throws(() => repository.remove("user-a", "../escape"), /invalid_agent_artifact_id/);
});

test("accepts persisted thin-reading Agent artifacts and purges an account", (context) => {
  const { database, repository } = fixture();
  context.after(() => database.close());
  const thinReading = {
    ...document("artifact-thin"),
    artifactType: "thin_reading",
    thinReadingDocument: {
      annotationSettings: { autoPublic: false },
      annotations: [],
      artifactId: "artifact-thin",
      activeNodeId: "root",
      nodes: {},
      paperIds: ["paper-1"],
      pendingPublicAnnotationIds: [],
      rootNodeId: "root",
      targetLanguage: "zh-CN",
      title: "Paper 1",
      version: "liteasy.thin-reading/v1"
    },
    title: "Paper 1"
  };

  repository.save("user-a", thinReading);
  assert.equal(repository.list("user-a")[0].artifactType, "thin_reading");
  assert.deepEqual(repository.purgeOwner("user-a"), { artifacts: 1, generationRuns: 1 });
  assert.deepEqual(repository.list("user-a"), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgentArtifactRepository } from "./agentArtifactRepository.mjs";

function document() {
  return {
    agent: { runId: "run_1", status: "completed" },
    answer: "analysis",
    artifactId: "artifact_1",
    artifactType: "tree",
    citations: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    papers: [],
    title: "Tree",
    version: "liteasy.agent-artifact/v1"
  };
}

test("lists only the authenticated subject's Agent artifacts", async () => {
  const calls = [];
  const repository = new PostgresAgentArtifactRepository({
    async query(sql, params) {
      calls.push({ params, sql });
      return { rows: [{ body: document() }] };
    }
  });

  assert.deepEqual(await repository.list("user_1"), { artifacts: [document()] });
  assert.deepEqual(calls[0].params, ["user_1"]);
  assert.match(calls[0].sql, /WHERE subject_id = \$1/);
});

test("gets one artifact only through its subject-bound identity", async () => {
  const calls = [];
  const repository = new PostgresAgentArtifactRepository({
    async query(sql, params) {
      calls.push({ params, sql });
      return params[0] === "user_1" && params[1] === "artifact_1"
        ? { rows: [{ body: document(), revision: "3" }] }
        : { rows: [] };
    }
  });

  assert.deepEqual(await repository.get("user_1", "artifact_1"), {
    artifact: document(),
    revision: 3
  });
  await assert.rejects(
    () => repository.get("user_2", "artifact_1"),
    /agent_artifact_not_found/
  );
  assert.match(calls[0].sql, /WHERE subject_id = \$1 AND artifact_id = \$2/);
});

test("saves an Agent artifact and audit record in one transaction", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ params, sql });
      if (/RETURNING revision/.test(sql)) return { rows: [{ revision: "1" }] };
      return { rows: [] };
    },
    release() {
      calls.push({ release: true });
    }
  };
  const repository = new PostgresAgentArtifactRepository({ async connect() { return client; } });

  const saved = await repository.save("user_1", document(), "trace_1");
  assert.equal(saved.path, "liteasy://agent-artifacts/artifact_1");
  assert.equal(saved.revision, 1);
  assert.equal(calls.some((call) => /INSERT INTO agent_artifacts/.test(call.sql ?? "") && call.params[0] === "user_1"), true);
  assert.equal(calls.some((call) => /INSERT INTO audit_events/.test(call.sql ?? "")), true);
  assert.equal(calls.some((call) => /COMMIT/.test(call.sql ?? "")), true);
});

test("rejects invalid Agent artifacts before opening a transaction", async () => {
  let connected = false;
  const repository = new PostgresAgentArtifactRepository({
    async connect() {
      connected = true;
      throw new Error("should not connect");
    }
  });

  await assert.rejects(
    () => repository.save("user_1", { ...document(), artifactId: "../escape" }, "trace_1"),
    /agent_artifact_id_invalid/
  );
  assert.equal(connected, false);
});

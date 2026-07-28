import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentArtifactRepository } from "./agentArtifactRepository.mjs";

function document(artifactId = "artifact-1") {
  return {
    agent: {
      apiVersion: "liteasy.agent/v1",
      runId: "run-1",
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

test("atomically saves and lists Agent artifacts", (context) => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-artifacts-"));
  context.after(() => fs.rmSync(resultDirectory, { force: true, recursive: true }));
  const repository = createAgentArtifactRepository({ resultDirectory });

  const saved = repository.save(document());

  assert.equal(saved.path, "project-docs/agent-results/artifact-1.json");
  assert.deepEqual(repository.list(), [document()]);
  assert.equal(fs.existsSync(path.join(resultDirectory, "artifact-1.json")), true);
});

test("rejects unsafe artifact ids", (context) => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-artifacts-"));
  context.after(() => fs.rmSync(resultDirectory, { force: true, recursive: true }));
  const repository = createAgentArtifactRepository({ resultDirectory });

  assert.throws(() => repository.save(document("../escape")), /invalid_agent_artifact/);
});

test("deletes only the validated artifact file", (context) => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-artifacts-"));
  context.after(() => fs.rmSync(resultDirectory, { force: true, recursive: true }));
  const repository = createAgentArtifactRepository({ resultDirectory });
  repository.save(document("artifact-delete"));
  repository.save(document("artifact-keep"));

  assert.deepEqual(repository.remove("artifact-delete"), {
    artifactId: "artifact-delete",
    deleted: true,
    path: "project-docs/agent-results/artifact-delete.json"
  });
  assert.equal(fs.existsSync(path.join(resultDirectory, "artifact-delete.json")), false);
  assert.equal(fs.existsSync(path.join(resultDirectory, "artifact-keep.json")), true);
  assert.equal(repository.remove("artifact-delete"), null);
  assert.throws(() => repository.remove("../escape"), /invalid_agent_artifact_id/);
});

test("accepts persisted thin-reading Agent artifacts", (context) => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-artifacts-"));
  context.after(() => fs.rmSync(resultDirectory, { force: true, recursive: true }));
  const repository = createAgentArtifactRepository({ resultDirectory });
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

  repository.save(thinReading);

  assert.equal(repository.list()[0].artifactType, "thin_reading");
});

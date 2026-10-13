import { afterEach, expect, test, vi } from "vitest";
import { createLocalArtifactResultClient } from "../app/features/artifacts/localArtifactResultClient";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { parseThinReadingDocument } from "../app/features/thin-reading/thinReadingVersioning";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";

afterEach(() => localStorage.clear());
test("saves and reopens a paper-bound thin-reading document without an account, then renames and deletes it", async () => {
  const fixture = createThinReadingFixture();
  const document: AgentArtifactResult = {
    version: "liteasy.agent-artifact/v1", artifactId: fixture.artifactId, artifactType: "thin_reading",
    title: "薄读", answer: fixture.rootSeed.summary, createdAt: new Date().toISOString(), citations: [],
    papers: fixture.papers, supplementalContext: "请解释方法与动机", thinReadingDocument: createThinReadingDocument(fixture),
    agent: { apiVersion: "liteasy.agent/v1", runId: "run-local", sessionId: "session-local", status: "completed" }
  };
  const first = createLocalArtifactResultClient();
  expect(await first.save(document)).toContain(document.artifactId);
  const reopened = createLocalArtifactResultClient();
  const stored = (await reopened.list())[0];
  expect(parseThinReadingDocument(stored.thinReadingDocument)).toEqual(document.thinReadingDocument);
  expect(stored.supplementalContext).toBe(document.supplementalContext);
  await reopened.rename(document.artifactId, "方法薄读");
  expect((await first.list())[0].title).toBe("方法薄读");
  await reopened.delete(document.artifactId);
  expect(await first.list()).toEqual([]);
});


test("local result admission never saves the isolated metadata projection", async () => {
  const raw = { version: "liteasy.agent-artifact/v1", artifactId: "invalid-papers", artifactType: "tree", title: "Preserved", answer: "Synthetic", createdAt: "2026-10-13", citations: [], papers: [null], agent: { status: "completed" } };
  const bytes = JSON.stringify(raw);
  const save = vi.fn(async () => "local-path");
  const client = createLocalArtifactResultClient({ list: async () => [raw], save, delete: vi.fn() });
  const [projected] = await client.list();
  expect(projected.papers).toEqual([]);
  await expect(client.save(projected)).rejects.toThrow("只读");
  expect(save).not.toHaveBeenCalled();
  expect(JSON.stringify(raw)).toBe(bytes);
});

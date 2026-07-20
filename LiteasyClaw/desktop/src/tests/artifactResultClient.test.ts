import { vi } from "vitest";
import { createArtifactResultClient } from "../app/features/artifacts/artifactResultClient";

const document = {
  agent: {
    apiVersion: "liteasy.agent/v1",
    runId: "run-1",
    sessionId: "session-1",
    status: "completed" as const
  },
  answer: "analysis",
  artifactId: "artifact-1",
  artifactType: "mindmap" as const,
  citations: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  papers: [{ id: "paper-1", title: "Paper 1" }],
  title: "Mind Map",
  uiDsl: {
    actions: [],
    audit: {
      createdAt: "2026-07-20T00:00:00.000Z",
      generatedBy: "rule" as const,
      traceId: "trace-1"
    },
    dataSources: [],
    root: { component: "MindMap" as const, id: "root", props: {} },
    surface: "center_artifact" as const,
    version: "liteasy.ui/v1" as const
  },
  version: "liteasy.agent-artifact/v1" as const
};

test("saves and lists Git-visible Agent artifact documents", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce({
      json: async () => ({ path: "project-docs/agent-results/artifact-1.json" }),
      ok: true,
      status: 201
    })
    .mockResolvedValueOnce({
      json: async () => ({ artifacts: [document] }),
      ok: true,
      status: 200
    });
  const client = createArtifactResultClient({
    getBaseEndpoint: () => "http://127.0.0.1:8787/",
    transport
  });

  await expect(client.save(document)).resolves.toBe(
    "project-docs/agent-results/artifact-1.json"
  );
  await expect(client.list()).resolves.toEqual([document]);
  expect(transport.mock.calls[0][0]).toBe("http://127.0.0.1:8787/v1/agent-artifacts");
  expect(transport.mock.calls[0][1]).toMatchObject({ method: "POST" });
});

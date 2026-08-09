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

test("saves and lists account-scoped Agent artifact documents", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce({
      json: async () => ({ path: "development/test-data/agent-results/artifact-1.json" }),
      ok: true,
      status: 201
    })
    .mockResolvedValueOnce({
      json: async () => ({ artifacts: [document] }),
      ok: true,
      status: 200
    })
    .mockResolvedValueOnce({
      json: async () => ({ artifact: { ...document, title: "Renamed map" } }),
      ok: true,
      status: 200
    })
    .mockResolvedValueOnce({
      json: async () => ({ artifactId: "artifact-1", deleted: true }),
      ok: true,
      status: 200
    });
  const client = createArtifactResultClient({
    getAccessToken: () => "session-token",
    getBaseEndpoint: () => "http://127.0.0.1:8787/",
    transport
  });

  await expect(client.save(document)).resolves.toBe(
    "development/test-data/agent-results/artifact-1.json"
  );
  await expect(client.list()).resolves.toEqual([document]);
  await expect(client.rename("artifact-1", "Renamed map")).resolves.toEqual({
    ...document,
    title: "Renamed map"
  });
  await expect(client.delete("artifact-1")).resolves.toBeUndefined();
  expect(transport.mock.calls[0][0]).toBe("http://127.0.0.1:8787/v1/agent-artifacts");
  expect(transport.mock.calls[0][1]).toMatchObject({
    headers: expect.objectContaining({ Authorization: "Bearer session-token" }),
    method: "POST"
  });
  expect(transport.mock.calls[2]).toEqual([
    "http://127.0.0.1:8787/v1/agent-artifacts/artifact-1",
    expect.objectContaining({ method: "PATCH" })
  ]);
  expect(transport.mock.calls[3]).toEqual([
    "http://127.0.0.1:8787/v1/agent-artifacts/artifact-1",
    {
      headers: { Authorization: "Bearer session-token" },
      method: "DELETE"
    }
  ]);
});

test("passes an abort signal through artifact persistence transport", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({ path: "artifact.json" }),
    ok: true,
    status: 201
  }));
  const client = createArtifactResultClient({
    getAccessToken: () => "session-token",
    getBaseEndpoint: () => "http://127.0.0.1:8787",
    transport
  });
  const controller = new AbortController();

  await client.save(document, controller.signal);

  expect(transport).toHaveBeenCalledWith(
    "http://127.0.0.1:8787/v1/agent-artifacts",
    expect.objectContaining({ signal: controller.signal })
  );
});

test("reports a failed artifact deletion", async () => {
  const client = createArtifactResultClient({
    getAccessToken: () => "session-token",
    getBaseEndpoint: () => "http://127.0.0.1:8787",
    transport: vi.fn(async () => ({
      json: async () => ({ error: "agent_artifact_not_found" }),
      ok: false,
      status: 404
    }))
  });

  await expect(client.delete("artifact-missing")).rejects.toThrow(
    "agent_artifact_not_found"
  );
});

test("lists thin-reading artifacts without requiring a UI DSL", async () => {
  const thinReadingDocument = {
    ...document,
    artifactId: "artifact-thin",
    artifactType: "thin_reading" as const,
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
      version: "liteasy.thin-reading/v1" as const
    },
    title: "Paper 1",
    uiDsl: undefined
  };
  const client = createArtifactResultClient({
    getAccessToken: () => "session-token",
    getBaseEndpoint: () => "http://127.0.0.1:8787",
    transport: vi.fn(async () => ({
      json: async () => ({ artifacts: [thinReadingDocument] }),
      ok: true,
      status: 200
    }))
  });

  await expect(client.list()).resolves.toEqual([thinReadingDocument]);
});

test("fails closed before transport when no account session is available", async () => {
  const transport = vi.fn();
  const client = createArtifactResultClient({
    getAccessToken: () => undefined,
    getBaseEndpoint: () => "http://127.0.0.1:8787",
    transport
  });

  await expect(client.list()).rejects.toThrow("请先登录");
  expect(transport).not.toHaveBeenCalled();
});

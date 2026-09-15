import { describe, expect, test, vi } from "vitest";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";
import type { ArtifactResultClient } from "../app/features/artifacts/artifactResultClient";
import { createLocalArtifactResultClient } from "../app/features/artifacts/localArtifactResultClient";
import {
  artifactResourceScope,
  createArtifactResourceProvider,
  createArtifactResourceService
} from "../app/features/resource-filesystem/artifactResourceProvider";
import { createResourceFileService, resourceUri } from "../app/features/resource-filesystem/resourceFileService";
import type { ResourceProvider } from "../app/features/resource-filesystem/resourceFile.types";
import { authoredResourceFileSchema } from "../app/features/resource-filesystem/authoredResourceFile";
import { paperAnchorFromObject, paperAnchorOpenRequest } from "../app/features/paper-anchors/paperAnchorEntity";

function artifact(artifactId = "slides-1"): AgentArtifactResult {
  return {
    version: "liteasy.agent-artifact/v1",
    artifactId,
    artifactType: "ppt",
    title: "论文演示",
    answer: "这是从证据创建的演示文稿。",
    papers: [],
    citations: [],
    createdAt: "2026-09-15T00:00:00.000Z",
    agent: { apiVersion: "liteasy.agent/v1", runId: "run-1", sessionId: "session-1", status: "completed" },
    authoredArtifact: {
      version: "liteasy.authored-artifact/v1",
      kind: "slides",
      title: "论文演示",
      slides: [{ id: "slide-1", title: "研究问题", markdown: "**证据**与公式 $x^2$。", notes: "说明限定条件。", evidenceIds: [] }]
    }
  };
}

function clientWithDocuments(initial: AgentArtifactResult[]) {
  let documents = structuredClone(initial);
  const client: ArtifactResultClient = {
    list: vi.fn(async (signal?: AbortSignal) => { signal?.throwIfAborted(); return structuredClone(documents); }),
    save: vi.fn(async (document) => {
      documents = [...documents.filter((entry) => entry.artifactId !== document.artifactId), structuredClone(document)];
      return `liteasy://agent-artifacts/${document.artifactId}`;
    }),
    rename: vi.fn(async (id, title) => {
      const document = documents.find((entry) => entry.artifactId === id)!;
      document.title = title;
      return document;
    }),
    delete: vi.fn(async (id) => { documents = documents.filter((entry) => entry.artifactId !== id); })
  };
  return { client, replace: (next: AgentArtifactResult[]) => { documents = structuredClone(next); } };
}

describe("resource file service", () => {
  test("persists the existing artifact envelope once and reads named native/Markdown files from the same source", async () => {
    const { client } = clientWithDocuments([]);
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const document = artifact();
    const saved = await service.saveArtifact(document);
    expect(client.save).toHaveBeenCalledTimes(1);
    expect(client.save).toHaveBeenCalledWith(document, undefined);
    expect(saved.resultPath).toBe("liteasy://agent-artifacts/slides-1");
    expect(saved.resource).toMatchObject({ scope: { id: "device", kind: "device" }, versioning: "snapshot_required" });
    expect(saved.resource.canonicalRef.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    const native = await service.read(saved.resource.canonicalUri, { representation: "native", maxBytes: 10_000 });
    expect(native.fileName).toBe("论文演示.slides.json");
    expect(authoredResourceFileSchema.parse(JSON.parse(native.content))).toEqual({
      schema: "liteasy.authored-resource/v1", artifactId: document.artifactId,
      content: document.authoredArtifact, sources: { paperAnchors: [], contextRefs: [] },
    });
    const markdown = await service.read("liteasy://agent-artifacts/slides-1", { representation: "markdown", maxBytes: 10_000 });
    expect(markdown.fileName).toBe("论文演示.md");
    expect(markdown.content).toContain("**证据**与公式 $x^2$。");
    expect(markdown.content).toContain("说明限定条件。");
    expect(markdown.resource.canonicalRef.revision).toBe(saved.resource.canonicalRef.revision);
  });

  test("pages metadata without returning bodies and rejects cursors after directory changes", async () => {
    const documents = [artifact("slides-1"), artifact("slides-2"), artifact("slides-3")];
    const { client, replace } = clientWithDocuments(documents);
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const first = await service.list({ providerId: "artifacts", scopeId: "device", limit: 2 });
    expect(first.entries.map((entry) => entry.canonicalRef.resourceId)).toEqual(["slides-1", "slides-2"]);
    expect(JSON.stringify(first)).not.toContain("这是从证据创建");
    expect(JSON.stringify(first)).not.toContain("说明限定条件");
    const second = await service.list({ providerId: "artifacts", scopeId: "device", limit: 2, cursor: first.nextCursor });
    expect(second.entries.map((entry) => entry.canonicalRef.resourceId)).toEqual(["slides-3"]);
    expect(second.nextCursor).toBeUndefined();
    replace([...documents, artifact("slides-4")]);
    await expect(service.list({ providerId: "artifacts", scopeId: "device", cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  test.each(["slides", "outline"] as const)("keeps the original paper selector and readable per-node sources in %s files", async (kind) => {
    const paperAnchor = paperAnchorFromObject({ id: "evidence-original-paper-location", paperId: "paper-source", paperTitle: "Original paper",
      anchor: { type: "pdf", sourceRef: { objectId: "original-pdf", revision: "original-revision" }, documentHash: "source-hash",
        page: 7, quote: { exact: "Original evidence passage.", prefix: "Before", suffix: "After" }, range: { start: 11, end: 37 },
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }], extractor: "embedded", normalization: "v1", precision: "exact" } });
    const sourceContextRefs = [{ objectId: "saved-note", revision: "note-revision" }];
    const document = artifact();
    document.paperAnchors = [paperAnchor];
    document.sourceContextRefs = sourceContextRefs;
    document.authoredArtifact = kind === "slides" ? {
      version: "liteasy.authored-artifact/v1", kind, title: "Grounded slides",
      slides: [{ id: "slide-a", title: "A sourced claim", markdown: "The paper supports this claim.", notes: "",
        evidenceIds: [paperAnchor.id, "saved-note@note-revision"] },
      { id: "slide-b", title: "Discussion", markdown: "Further questions.", notes: "", evidenceIds: [] }],
    } : { version: "liteasy.authored-artifact/v1", kind, title: "Grounded outline",
      nodes: [{ id: "node-a", parentId: null, label: "A sourced claim", evidenceIds: [paperAnchor.id, "saved-note@note-revision"] }] };
    document.artifactType = kind === "slides" ? "ppt" : "tree";
    const { client } = clientWithDocuments([]);
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const saved = await service.saveArtifact(document);
    const native = await service.read(saved.resource.canonicalRef, { representation: "native", maxBytes: 10000 });
    const file = authoredResourceFileSchema.parse(JSON.parse(native.content));
    expect(file.sources).toEqual({ paperAnchors: [paperAnchor], contextRefs: sourceContextRefs });
    expect(file.content).toEqual(document.authoredArtifact);
    expect(paperAnchorOpenRequest(file.sources.paperAnchors[0]!)).toMatchObject({
      paperId: "paper-source", page: 7, pageTextStart: 11, pageTextEnd: 37, quote: "Original evidence passage.",
    });
    expect(file).not.toHaveProperty("analysis");
    const markdown = await service.read(saved.resource.canonicalRef, { representation: "markdown", maxBytes: 10000 });
    expect(markdown.content).toContain("Original paper · 第 7 页；来源资源 1");
    expect(markdown.content).toContain("> Original evidence passage.");
    expect(markdown.content).not.toContain(paperAnchor.id);
    expect(markdown.content).not.toContain("saved-note@note-revision");
    if (kind === "slides") expect(markdown.content.indexOf("**出处：**")).toBeLessThan(markdown.content.indexOf("## Discussion"));
  });

  test("binds refs, legacy locators and cursors to explicit resource mounts", async () => {
    const a = createArtifactResourceProvider({ client: clientWithDocuments([artifact()]).client, scope: artifactResourceScope("account-a") });
    const b = createArtifactResourceProvider({ client: clientWithDocuments([artifact()]).client, scope: artifactResourceScope("account-b") });
    const service = createResourceFileService([a, b]);
    await expect(service.stat("liteasy://agent-artifacts/slides-1")).rejects.toMatchObject({ code: "provider_unavailable" });
    const stat = await service.stat({ providerId: "artifacts", resourceId: "slides-1", scopeId: a.scope.id });
    expect(stat.scope.id).toBe(a.scope.id);
    expect(stat.canonicalUri).not.toContain("account-a");
    await expect(a.stat({ providerId: "artifacts", resourceId: "slides-1", scopeId: b.scope.id })).rejects.toMatchObject({ code: "resource_unavailable" });
  });

  test("checks a pinned content digest rather than claiming overwritten history remains readable", async () => {
    const document = artifact();
    const { client, replace } = clientWithDocuments([document]);
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const before = await service.stat("liteasy://agent-artifacts/slides-1");
    const next = artifact();
    next.authoredArtifact = { ...next.authoredArtifact!, title: "修订演示" };
    replace([next]);
    const after = await service.stat("liteasy://agent-artifacts/slides-1");
    expect(after.canonicalRef.revision).not.toBe(before.canonicalRef.revision);
    await expect(service.read(before.canonicalRef, { representation: "native", maxBytes: 10000 })).rejects.toMatchObject({ code: "revision_unavailable" });
    expect(JSON.parse((await service.read(after.canonicalRef, { representation: "native", maxBytes: 10000 })).content).content.title).toBe("修订演示");
  });

  test("measures UTF-8 bytes and refuses oversized reads without returning partial content", async () => {
    const service = createArtifactResourceService({ client: clientWithDocuments([artifact()]).client, scope: artifactResourceScope() });
    const complete = await service.read("liteasy://agent-artifacts/slides-1", { representation: "markdown", maxBytes: 10000 });
    expect(complete.byteLength).toBe(new TextEncoder().encode(complete.content).byteLength);
    expect(complete.byteLength).toBeGreaterThan(complete.content.length);
    await expect(service.read(complete.resource.canonicalRef, { representation: "markdown", maxBytes: complete.byteLength - 1 })).rejects.toMatchObject({ code: "read_limit_exceeded" });
  });

  test("rejects cancellation before I/O and cancellation/account changes after delayed legacy reads", async () => {
    const { client } = clientWithDocuments([artifact()]);
    let currentScope = "device";
    const service = createArtifactResourceService({ client, scope: artifactResourceScope(), getCurrentScopeId: () => currentScope });
    const controller = new AbortController();
    controller.abort();
    await expect(service.read("liteasy://agent-artifacts/slides-1", { representation: "native", maxBytes: 10000, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(client.list).not.toHaveBeenCalled();
    let release!: (value: AgentArtifactResult[]) => void;
    vi.mocked(client.list).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = service.stat("liteasy://agent-artifacts/slides-1");
    currentScope = "account-b";
    release([artifact()]);
    await expect(pending).rejects.toMatchObject({ code: "scope_changed" });
    await expect(service.saveArtifact(artifact())).rejects.toMatchObject({ code: "scope_changed" });
    expect(client.save).not.toHaveBeenCalled();
  });

  test("settles a cancelled read promptly even when the legacy transport cannot abort its work", async () => {
    const { client } = clientWithDocuments([artifact()]);
    let release!: (documents: AgentArtifactResult[]) => void;
    vi.mocked(client.list).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const controller = new AbortController();
    const pending = service.read("liteasy://agent-artifacts/slides-1", { representation: "native", maxBytes: 10000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(client.list).toHaveBeenCalledWith(controller.signal);
    release([artifact()]);
  });

  test("does not publish a save result into a newly active account after the original write committed", async () => {
    const { client } = clientWithDocuments([]);
    let currentScope = "device";
    vi.mocked(client.save).mockImplementationOnce(async () => {
      currentScope = "account-b";
      return "liteasy://agent-artifacts/slides-1";
    });
    const service = createArtifactResourceService({ client, scope: artifactResourceScope(), getCurrentScopeId: () => currentScope });
    await expect(service.saveArtifact(artifact())).resolves.toMatchObject({ status: "saved", publishable: false });
    expect(client.save).toHaveBeenCalledTimes(1);
  });

  test("keeps a successful storage receipt when cancellation arrives after commit", async () => {
    const { client } = clientWithDocuments([]);
    const controller = new AbortController();
    vi.mocked(client.save).mockImplementationOnce(async () => {
      controller.abort();
      return "liteasy://agent-artifacts/slides-1";
    });
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    await expect(service.saveArtifact(artifact(), { signal: controller.signal })).resolves.toMatchObject({
      status: "saved", publishable: true, resultPath: "liteasy://agent-artifacts/slides-1"
    });
  });

  test.each([
    "liteasy://resources/artifacts/../slides-1?scope=device",
    "liteasy://agent-artifacts/%2E%2E",
    "liteasy://agent-artifacts/slides%2F1",
    "liteasy://agent-artifacts/slides%252F1",
    "liteasy://agent-artifacts/slides-1?path=/etc/passwd",
    "liteasy://agent-artifacts/slides-1?scope=device&scope=account-a",
    "file:///etc/passwd"
  ])("rejects noncanonical or path-shaped addresses: %s", async (uri) => {
    const { client } = clientWithDocuments([artifact()]);
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    await expect(service.stat(uri)).rejects.toMatchObject({ code: "invalid_ref" });
    expect(client.list).not.toHaveBeenCalled();
  });

  test("can register and remove other trusted providers without adding an artifact copy", async () => {
    const service = createResourceFileService();
    const stat = await createArtifactResourceService({ client: clientWithDocuments([artifact()]).client, scope: artifactResourceScope() }).stat("liteasy://agent-artifacts/slides-1");
    const ref = { ...stat.canonicalRef, providerId: "notes" };
    const provider: ResourceProvider = {
      providerId: "notes", scope: artifactResourceScope(),
      stat: vi.fn(async () => ({ ...stat, canonicalRef: ref, canonicalUri: resourceUri(ref) })),
      list: vi.fn(), read: vi.fn()
    };
    const unregister = service.registerProvider(provider);
    expect((await service.stat(resourceUri(ref))).canonicalRef.providerId).toBe("notes");
    unregister();
    await expect(service.stat(ref)).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  test("retains legacy local records, skips malformed authored records and rejects corrupt new saves", async () => {
    const valid = artifact();
    const legacy = { ...artifact("legacy"), authoredArtifact: undefined };
    const corrupt = { ...artifact("corrupt"), authoredArtifact: { ...valid.authoredArtifact, slides: "wrong" } } as unknown as AgentArtifactResult;
    const storage = { list: vi.fn(async () => [valid, legacy, corrupt]), save: vi.fn(async () => "saved"), delete: vi.fn() };
    const client = createLocalArtifactResultClient(storage);
    expect((await client.list()).map((entry) => entry.artifactId)).toEqual(["slides-1", "legacy"]);
    await expect(client.save(corrupt)).rejects.toThrow("产物格式无效");
    expect(storage.save).not.toHaveBeenCalled();
    const service = createArtifactResourceService({ client, scope: artifactResourceScope() });
    const first = await service.read("liteasy://agent-artifacts/legacy", { representation: "markdown", maxBytes: 10000 });
    expect(first.fileName).toBe("论文演示.md");
    expect(first.content).not.toContain("导出时间");
    const second = await service.read(first.resource.canonicalRef, { representation: "markdown", maxBytes: 10000 });
    expect(second.content).toBe(first.content);
  });
});

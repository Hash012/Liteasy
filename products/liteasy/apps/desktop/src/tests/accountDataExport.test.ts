import { afterEach, describe, expect, test, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createAccountDataExportClient, type AccountDataExportArchive } from "../app/features/account/accountDataExport";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";

const session = { endpoint: "https://cloud.example.invalid", issuer: "https://id.example.invalid", userId: "verified-a",
  sessionId: "request-token-secret", email: "a@example.invalid", name: "A", expiresAt: "2030-01-01T00:00:00Z" };
const artifact = { version: "liteasy.agent-artifact/v1", artifactId: "artifact-1", artifactType: "tree", title: "My artifact",
  createdAt: "2026-10-03T00:00:00Z", answer: "The literal word token belongs in this manuscript.",
  papers: [{ id: "document-a", title: "My paper" }], citations: [],
  agent: { apiVersion: "liteasy.agent/v1", runId: "run", sessionId: "stored-session-secret", status: "completed" },
  modelConfig: { apiKey: "model-key-secret" }, accessToken: "artifact-token-secret" };

function fixture() {
  storeAccountSession(session);
  const state = {
    endpoint: session.endpoint, now: Date.parse("2026-10-03T00:00:00Z"),
    tree: { scopeType: "user", scopeId: session.userId, revision: 4,
      folders: [{ folderId: "folder-a", name: "Research", privateConfig: "folder-secret" }],
      entries: [{ scopeType: "user", scopeId: session.userId, documentId: "document-a", title: "My paper",
        entryKind: "pdf", status: "active", contentHash: "a".repeat(64), metadata: { password: "metadata-secret" } }] },
    artifacts: [structuredClone(artifact)], fetchedArtifact: structuredClone(artifact), revision: 8,
    artifactGate: undefined as Promise<void> | undefined
  };
  const profile = { enabled: true, personalizationVersion: 3, profile: { stage: "Researcher", disciplines: [], profileVersion: 2,
    credential: "profile-secret" }, tags: [{ label: "reading", evidenceCount: 2, weight: 0.5 }], refreshToken: "refresh-secret" };
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${session.sessionId}`);
    if (path === "/v1/library/tree") {
      expect(JSON.parse(String(init?.body))).toEqual({ scopeType: "user", scopeId: session.userId, status: "active" });
      return Response.json({ tree: state.tree });
    }
    if (path === "/v1/profile/get") return Response.json(profile);
    if (path === "/v1/agent-artifacts") return Response.json({ artifacts: state.artifacts });
    if (path === "/v1/agent-artifacts/artifact-1") {
      await state.artifactGate;
      return Response.json({ artifact: state.fetchedArtifact, revision: state.revision });
    }
    throw new Error(`unexpected URL: ${path}`);
  });
  const download = vi.fn<(archive: AccountDataExportArchive) => void>();
  const client = createAccountDataExportClient({ getEndpoint: () => state.endpoint, fetchImpl,
    now: () => state.now, download });
  return { client, download, fetchImpl, state };
}

afterEach(clearStoredAccountSession);

describe("personal cloud data export", () => {
  test("downloads a selected archive with ownership and versions but no credential/configuration fields", async () => {
    const f = fixture();
    const plan = await f.client.prepare();
    expect(plan.documentCount).toBe(1);
    expect(plan.artifacts[0].excludedReason).toBeUndefined();
    await expect(f.client.export(plan, ["artifact-1"])).resolves.toEqual({ artifactCount: 1, documentCount: 1 });
    const archive = unzipSync(f.download.mock.calls[0][0].bytes);
    expect(Object.keys(archive).sort()).toEqual(["artifacts/0001.json", "manifest.json", "profile.json"]);
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    expect(manifest.account).toEqual({ subject: session.userId, issuer: session.issuer, endpoint: session.endpoint });
    expect(manifest.library.revision).toBe(4);
    expect(manifest.artifacts[0]).toMatchObject({ artifactId: "artifact-1", revision: 8 });
    const document = JSON.parse(strFromU8(archive["artifacts/0001.json"]));
    expect(document.answer).toContain("literal word token");
    const serialized = Object.values(archive).map(strFromU8).join("\n");
    for (const secret of ["request-token-secret", "stored-session-secret", "model-key-secret", "artifact-token-secret", "folder-secret", "metadata-secret", "profile-secret", "refresh-secret"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url)).some((url) => url.includes("organization"))).toBe(false);
    expect(f.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/artifact-1"))).toHaveLength(1);
  });

  test("an unselected artifact is not fetched or included", async () => {
    const f = fixture();
    const plan = await f.client.prepare();
    await f.client.export(plan, []);
    expect(f.fetchImpl.mock.calls.some(([url]) => String(url).endsWith("/artifact-1"))).toBe(false);
    const archive = unzipSync(f.download.mock.calls[0][0].bytes);
    expect(Object.keys(archive).sort()).toEqual(["manifest.json", "profile.json"]);
  });

  test("configuration objects injected into optional manuscript fields are never copied", async () => {
    const f = fixture();
    for (const candidate of [f.state.artifacts[0], f.state.fetchedArtifact]) {
      Object.assign(candidate, { outlineMarkdown: { apiKey: "nested-config-secret" } });
      Object.assign(candidate.papers[0], { title: { accessToken: "nested-title-secret" } });
    }
    const plan = await f.client.prepare();
    await f.client.export(plan, ["artifact-1"]);
    const archive = unzipSync(f.download.mock.calls[0][0].bytes);
    const serialized = Object.values(archive).map(strFromU8).join("\n");
    expect(serialized).not.toContain("nested-config-secret");
    expect(serialized).not.toContain("nested-title-secret");
  });

  test("expired preview and an already cancelled request stop before additional reads", async () => {
    const f = fixture();
    const plan = await f.client.prepare();
    const reads = f.fetchImpl.mock.calls.length;
    f.state.now += 5 * 60_000;
    await expect(f.client.export(plan, [])).rejects.toThrow("过期");
    const controller = new AbortController(); controller.abort();
    await expect(f.client.prepare(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(reads);
    expect(f.download).not.toHaveBeenCalled();
  });

  test.each(["cancel", "other-account", "same-account-login", "endpoint"])("discards delayed artifact data on %s", async (change) => {
    const f = fixture();
    const plan = await f.client.prepare();
    let release!: () => void;
    f.state.artifactGate = new Promise((resolve) => { release = resolve; });
    const controller = new AbortController();
    const pending = f.client.export(plan, ["artifact-1"], controller.signal);
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.fetchImpl.mock.calls.some(([url]) => String(url).endsWith("/artifact-1"))).toBe(true));
    if (change === "cancel") { controller.abort(); await rejection; }
    if (change === "other-account") storeAccountSession({ ...session, userId: "verified-b", sessionId: "b-token" });
    if (change === "same-account-login") { clearStoredAccountSession(); storeAccountSession(session); }
    if (change === "endpoint") f.state.endpoint = "https://other.example.invalid";
    release();
    await rejection;
    expect(f.download).not.toHaveBeenCalled();
  });

  test("fails closed for organization, unknown and unselected injected sources", async () => {
    const f = fixture();
    Object.assign(f.state.artifacts[0], { provenance: { scopeType: "organization", scopeId: "org-secret" } });
    const plan = await f.client.prepare();
    expect(plan.artifacts[0].excludedReason).toContain("组织");
    const reads = f.fetchImpl.mock.calls.length;
    await expect(f.client.export(plan, ["artifact-1"])).rejects.toThrow("范围");
    await expect(f.client.export(plan, ["artifact-b"])).rejects.toThrow("范围");
    expect(f.fetchImpl).toHaveBeenCalledTimes(reads);
    const unknown = fixture();
    unknown.state.artifacts[0].papers = [{ id: "not-in-my-library", title: "Unknown paper" }];
    expect((await unknown.client.prepare()).artifacts[0].excludedReason).toContain("未核实");
    expect(f.download).not.toHaveBeenCalled();
  });

  test("does not accept another account's tree or a cloud binding inferred from display fields", async () => {
    const f = fixture();
    f.state.tree.entries[0].scopeId = "verified-b";
    await expect(f.client.prepare()).rejects.toThrow("其他范围");
    storeAccountSession({ ...session, issuer: undefined });
    f.fetchImpl.mockClear();
    await expect(f.client.prepare()).rejects.toThrow("已验证");
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  test("changed source revision or artifact content requires a new preview", async () => {
    const f = fixture();
    const plan = await f.client.prepare();
    f.state.tree.revision += 1;
    await expect(f.client.export(plan, ["artifact-1"])).rejects.toThrow("文献已变化");
    f.state.tree.revision -= 1;
    f.state.fetchedArtifact.answer = "changed";
    await expect(f.client.export(plan, ["artifact-1"])).rejects.toThrow("产物或来源已变化");
    expect(f.download).not.toHaveBeenCalled();
  });

  test("invalid item revision and a final authorization failure never produce a download", async () => {
    const f = fixture();
    const plan = await f.client.prepare();
    f.state.revision = 0;
    await expect(f.client.export(plan, ["artifact-1"])).rejects.toThrow("版本无效");
    f.state.revision = 8;
    let profileReads = 0;
    const original = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/v1/profile/get") && ++profileReads === 2) return new Response("", { status: 401 });
      return original(...args);
    });
    await expect(f.client.export(plan, ["artifact-1"])).rejects.toThrow("401");
    expect(f.download).not.toHaveBeenCalled();
  });
});

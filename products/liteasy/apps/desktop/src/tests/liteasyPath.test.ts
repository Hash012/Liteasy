import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { liteasyPath, parseLiteasyPath, type ResourceTarget } from "../app/features/resource-filesystem/liteasyPath";
import { resolveLiteasyContext } from "../app/features/resource-filesystem/resourceContext";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import type { NoteFileService } from "../app/features/note-files/noteFileService";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";
import { resourceContentRevision, canonicalResourceJson } from "../app/features/resource-filesystem/resourceFileContent";

test.each<ResourceTarget>([
  { kind: "object", ref: { objectId: "对象-1", revision: "r1", selectorId: "block:1" } },
  { kind: "paper", paperId: "C:\\论文/文件.pdf" },
  { kind: "external-file", mountId: "vault-1", path: "研究/含 空格.md" },
  { kind: "artifact", artifactId: "ppt-1" },
  { kind: "pdf-annotation", paperId: "paper-1", annotationId: "a1" },
  { kind: "artifact-annotation", artifactId: "ppt-1", annotationId: "a1" },
])("round-trips a resource locator without exposing a disk authority: $kind", (target) => {
  const parsed = parseLiteasyPath(liteasyPath("user:A", target), "user:A");
  expect(parsed).toMatchObject(target);
});

test.each([
  "file:///etc/passwd", "liteasy://files/m/a/../b.md?scope=A", "liteasy://files/m/%2e%2e/b.md?scope=A",
  "liteasy://files/m/a%2Fb.md?scope=A", "liteasy://files/m/a.md?scope=A&scope=B", "liteasy://files/m/a.md?scope=B",
  "liteasy://user:secret@files/m/a.md?scope=A", "liteasy://objects/id?scope=A&revision=r&token=secret",
])("rejects unsupported, escaping or cross-account locators: %s", (path) => {
  expect(() => parseLiteasyPath(path, "A")).toThrow();
});

function fixture() {
  const scope = crypto.randomUUID();
  let current = scope;
  const repository = createObjectRepository(createObjectStorage(scope, () => current), scope);
  const files = { readFile: vi.fn(async () => ({ mountId: "mount", path: "research.md", name: "research.md", kind: "file", version: "hash", text: "文件中的真实研究内容" })) } as unknown as NoteFileService;
  const artifacts: AgentArtifactResult[] = [];
  const input = { repository, files, getPapers: () => [], getArtifacts: async () => artifacts,
    artifactScopeId: "device", active: () => current === scope,
    capturePapers: vi.fn(), captureAnnotation: vi.fn(), resolveBoard: vi.fn() };
  return { scope, repository, input, artifacts, switchAccount: () => { current = "different"; } };
}
test("resolves latest and pinned object paths to immutable context content", async () => {
  const f = fixture();
  const original = await f.repository.create({ kind: "content.note", title: "笔记", content: { schema: "liteasy.note/v1", payload: { text: "第一版", origin: "user" } } });
  const next = await f.repository.editNote(refOf(original), "第二版");
  const pinned = await resolveLiteasyContext({ ...f.input, path: liteasyPath(f.scope, { kind: "object", ref: refOf(original) }) });
  const latest = await resolveLiteasyContext({ ...f.input, path: liteasyPath(f.scope, { kind: "object", ref: refOf(original), followLatest: true }) });
  expect(pinned[0].ref).toEqual(refOf(original));
  expect(latest[0].ref).toEqual(refOf(next));
  const snapshot = await resolveContextSnapshot({ repository: f.repository, refs: pinned[0].refs, purpose: "分析" });
  expect(snapshot.entries[0].text).toBe("第一版");
});
test("reads an authorized Markdown file before attaching its fixed content", async () => {
  const f = fixture();
  const attachments = await resolveLiteasyContext({ ...f.input, path: liteasyPath(f.scope, { kind: "external-file", mountId: "mount", path: "research.md" }) });
  expect(f.input.files.readFile).toHaveBeenCalledWith("mount", "research.md");
  const snapshot = await resolveContextSnapshot({ repository: f.repository, refs: attachments[0].refs, purpose: "分析" });
  expect(snapshot.entries[0]).toMatchObject({ title: "research.md", text: "文件中的真实研究内容" });
  f.switchAccount();
  await expect(resolveLiteasyContext({ ...f.input, path: liteasyPath(f.scope, { kind: "external-file", mountId: "mount", path: "research.md" }) })).rejects.toThrow("账号已切换");
  expect(f.input.files.readFile).toHaveBeenCalledTimes(1);
});
test("accepts existing canonical artifact resource paths and refuses stale digests", async () => {
  const f = fixture();
  const artifact: AgentArtifactResult = { version: "liteasy.agent-artifact/v1", artifactId: "deck", artifactType: "ppt", title: "演示",
    answer: "真实产物正文", citations: [], papers: [], createdAt: new Date().toISOString(),
    agent: { apiVersion: "liteasy.agent/v1", runId: "r", sessionId: "s", status: "completed" } };
  f.artifacts.push(artifact);
  const revision = await resourceContentRevision(canonicalResourceJson(artifact));
  const path = `liteasy://resources/artifacts/deck?scope=device&revision=${revision}`;
  const attachments = await resolveLiteasyContext({ ...f.input, path });
  const snapshot = await resolveContextSnapshot({ repository: f.repository, refs: attachments[0].refs, purpose: "分析" });
  expect(snapshot.entries[0].text).toContain("真实产物正文");
  artifact.answer = "新内容";
  await expect(resolveLiteasyContext({ ...f.input, path })).rejects.toThrow("版本已变化");
});

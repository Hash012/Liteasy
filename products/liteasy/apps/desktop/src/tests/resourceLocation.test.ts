import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { describeResourceLocation } from "../app/features/resource-filesystem/resourceLocation";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import type { NoteFileService } from "../app/features/note-files/noteFileService";

const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
beforeEach(() => { native.enabled = true; native.invoke.mockReset(); });
function fixture() {
  const scope = crypto.randomUUID();
  native.enabled = false;
  const repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  native.enabled = true;
  const files = { readFile: vi.fn(async () => ({ version: "file-version" })), listMounts: vi.fn(async () => [{ id: "vault", kind: "directory", location: "Vault" }]) } as unknown as NoteFileService;
  return { repository, files, getPapers: () => [], active: () => true, artifactScopeId: "device" };
}
test("locates the exact saved file revision; an older object revision lives in the database", async () => {
  const f = fixture();
  const before = await f.repository.create({ kind: "content.note", title: "note", content: { schema: "liteasy.note/v1", payload: { text: "before", origin: "user" } } });
  const after = await f.repository.editNote(refOf(before), "after");
  await f.repository.setObjectFileBinding(before.objectId, { mountId: "vault", path: "note.md", version: "file-version", objectRevision: after.revision });
  native.invoke.mockResolvedValue({ path: "D:/Vault/note.md" });
  const saved = await describeResourceLocation({ ...f, target: { kind: "object", ref: refOf(after) }, reveal: true });
  expect(saved).toMatchObject({ physicalPath: "D:/Vault/note.md", physicalKind: "file", canReveal: true });
  expect(native.invoke).toHaveBeenLastCalledWith("note_files_dispatch", expect.objectContaining({ request: { action: "revealFile", mountId: "vault", path: "note.md" } }));
  native.invoke.mockResolvedValue({ path: "D:/LiteasyData/objects/objects.v1.sqlite3" });
  const old = await describeResourceLocation({ ...f, target: { kind: "object", ref: refOf(before) } });
  expect(old.physicalKind).toBe("database");
  vi.mocked(f.files.readFile).mockRejectedValueOnce(new Error("file removed"));
  expect((await describeResourceLocation({ ...f, target: { kind: "object", ref: refOf(after) } })).physicalKind).toBe("database");
  expect(native.invoke).toHaveBeenLastCalledWith("resource_location", expect.objectContaining({ request: { kind: "object" }, revealInFolder: false }));
});
test("cloud artifacts and browser grants do not claim to have revealable local files", async () => {
  const f = fixture();
  expect(await describeResourceLocation({ ...f, artifactScopeId: "account-cloud", target: { kind: "artifact", artifactId: "deck" } }))
    .toMatchObject({ physicalKind: "cloud", canReveal: false });
  native.enabled = false;
  expect(await describeResourceLocation({ ...f, target: { kind: "external-file", mountId: "vault", path: "a.md" } }))
    .toMatchObject({ physicalKind: "browser", canReveal: false, physicalPath: expect.stringContaining("Vault/a.md") });
  expect(native.invoke).not.toHaveBeenCalled();
});
test("missing grants and account switches fail before invoking the host", async () => {
  const f = fixture();
  const target = { kind: "external-file" as const, mountId: "missing", path: "a.md" };
  await expect(describeResourceLocation({ ...f, target })).rejects.toThrow("授权已不可用");
  await expect(describeResourceLocation({ ...f, target, active: () => false })).rejects.toThrow("账号已切换");
  expect(native.invoke).not.toHaveBeenCalled();
});

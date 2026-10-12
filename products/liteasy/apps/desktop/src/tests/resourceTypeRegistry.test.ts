import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { objectResourceType } from "../app/features/resource-filesystem/objectResourceType";
import { createResourceTypeRegistry } from "../app/features/resource-filesystem/resourceTypeRegistry";
import { objectText } from "../app/features/objects/object.types";
import { evidenceReportFromAssetReads } from "../app/features/evidence/evidenceAdapters";

test("research.memo joins real discovery, read, context, native, evidence, CAS and history by registration only", async () => {
  const scope = crypto.randomUUID(); let active = true;
  const repository = createObjectRepository(createObjectStorage(scope, () => active ? scope : "other"), scope);
  const note = await repository.create({ kind: "content.note", title: "Memo challenge", content: { schema: "liteasy.note/v1", payload: { text: "# Memo\n\n| A | B |\n|---|---|\n|1|2|", origin: "user" } } });
  const create = () => createWorkspaceAgentAssetService({ repository, active: () => active, typeFactories: [adapter => objectResourceType({ typeId: "research.memo", kind: "content.note", repository, adapter, active: () => active, fixtureId: "research.memo:merged-table" })] });
  const service = create();
  const found = (await service.search({ query: "Memo" })).find(asset => asset.kind === "research.memo")!;
  expect(found).toBeDefined();
  const read = await service.read(found.path);
  expect(read.text).toBe(objectText(note));
  expect((await service.context(found.path))[0].ref).toEqual({ objectId: note.objectId, revision: note.revision });
  const native = await service.resourceFiles.read(found.path, { representation: "native", maxBytes: 80000 });
  expect(JSON.parse(native.content)).toEqual(note);
  const report = evidenceReportFromAssetReads({ id: "challenge", answer: "", scopeId: scope, reads: [read] });
  expect(report.passages[0].content?.binding).toMatchObject({ kind: "pinned", revision: note.revision, scopeId: scope });
  const write = await service.write(found.path, { expectedRevision: note.revision, text: "\nUpdated", mode: "append" });
  expect((await create().read(write.asset.path)).text).toContain("Updated");
  expect((await create().read(found.path)).text).toBe(objectText(note));
  await expect(service.write(found.path, { expectedRevision: note.revision, text: "erase" })).rejects.toThrow();
  active = false;
  await expect(service.read(found.path)).rejects.toThrow();
  await expect(service.resourceFiles.read(found.path, { representation: "native", maxBytes: 80000 })).rejects.toThrow();
});
test("registration rejects missing context obligations, handlers, fixtures and untrusted profiles", () => {
  const registry = createResourceTypeRegistry(() => true);
  const base: any = { typeId: "research.invalid", schemaVersion: 1, owner: "test", nativeCodec: "md/v1", profile: "liteasy-research-markdown/v1", viewId: "content", fixtureIds: ["f"],
    source: { accepts() {}, read() {}, search() {}, stat() {} }, context: { supported: false, reason: "read only" }, write: { supported: false, reason: "read only" }, file: { supported: false, reason: "not materialized" } };
  for (const change of [{ context: undefined }, { context: { supported: true } }, { profile: "execute-html" }, { fixtureIds: [] }, { file: { supported: true, implementation: {} } }]) {
    expect(() => registry.register({ ...base, ...change })).toThrow();
  }
  registry.register(base);
  expect(registry.matrix()[0].context).toBe("read only");
});

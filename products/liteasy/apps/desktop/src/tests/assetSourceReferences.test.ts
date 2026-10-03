import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { expect, test, vi } from "vitest";
import { paperSourceReferences, noteSourceReferences } from "../app/features/resource-filesystem/assetSourceReferences";
import { assertExternalPaperSources, assertExternalSourceReferences } from "../app/features/models/externalSourcePolicy";

test("keeps legacy organization provenance without inventing a document revision", () => {
  const source = { id: "manual", sourcePath: "org://team/shared-library/manual.pdf" };
  const references = paperSourceReferences(source);
  expect(references).toEqual([{ paperId: "manual", scopeId: "team", scopeType: "organization" }]);
  expect(() => assertExternalSourceReferences(references)).toThrow("属于组织");
  expect(() => assertExternalPaperSources([source])).toThrow("属于组织");
  expect(paperSourceReferences({ id: "local", sourcePath: "/library/manual.pdf" })).toEqual([]);
});

test("a derived organization note retains its source after copies and restoration outside a project", async () => {
  const { createObjectRepository } = await import("../app/features/objects/objectRepository");
  const { createObjectStorage } = await import("../app/features/objects/objectStorage");
  const { refOf } = await import("../app/features/objects/object.types");
  const { createWorkspaceAgentAssetService } = await import("../app/features/resource-filesystem/workspaceAgentAssetService");
  const { liteasyPath } = await import("../app/features/resource-filesystem/liteasyPath");
  const { externalModelAssetService } = await import("../app/features/models/externalSourcePolicy");
  vi.stubGlobal("crypto", webcrypto);
  const scope = crypto.randomUUID();
  const repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const source = await repository.create({ kind: "source.document", title: "Organization manual", content: { schema: "liteasy.source-document/v1", payload: {
    paperId: "org-manual", text: "SYNTHETIC ORGANIZATION CONTENT", legacyKey: "paper-context-metadata:org-manual", availability: "local"
  } } });
  const note = await repository.create({ kind: "content.note", title: "Derived note", sourceRefs: [refOf(source)], content: { schema: "liteasy.note/v1", payload: { text: "Synthetic summary", origin: "derived" } } });
  const copy = await repository.create({ kind: "content.note", title: "Copied note", derivedFrom: [refOf(note)], content: { schema: "liteasy.note/v1", payload: { text: "Copied summary", origin: "derived" } } });
  let papers = [{ id: "org-manual", title: "Organization manual", sourcePath: "org://synthetic-group/shared-library/manual.pdf" }];
  const assets = createWorkspaceAgentAssetService({ repository, getPapers: () => papers, active: () => true });
  const path = liteasyPath(scope, { kind: "object", ref: refOf(copy) });
  expect((await assets.stat(path)).sourceReferences).toEqual([{ paperId: "org-manual", scopeType: "organization", scopeId: "synthetic-group" }]);
  await expect(externalModelAssetService(assets).read(path)).rejects.toThrow("属于组织");
  papers = [];
  await expect(externalModelAssetService(assets).read(path)).rejects.toThrow("来源");
  expect((await assets.read(path)).text).toBe("Copied summary");
  const local = await repository.create({ kind: "content.note", title: "My local note", content: { schema: "liteasy.note/v1", payload: { text: "Local book notes", origin: "user" } } });
  await expect(externalModelAssetService(assets).read(liteasyPath(scope, { kind: "object", ref: refOf(local) }))).resolves.toMatchObject({ text: "Local book notes" });
});


test("portable personal reflections retain organization source metadata without copying the source body", () => {
  const note = '---\nsourceNamespace: intuecho.annotation\nsourceId: "annotation-1"\nrevision: 2\norganizationId: "org-1"\nsourcePolicy: organization-bound\n---\nMy own reflection only';
  const sources = noteSourceReferences(note);
  expect(sources.sourceReferences).toEqual([{ scopeType: "organization", scopeId: "org-1", paperId: "intuecho.annotation:annotation-1", revision: 2 }]);
  expect(() => assertExternalSourceReferences(sources.sourceReferences)).toThrow("属于组织");
  expect(noteSourceReferences(note.replace('organizationId: "org-1"', 'organizationId: null'))).toEqual({ sourceResolution: "unavailable" });
  expect(noteSourceReferences("# My local file\nNo organization source")).toEqual({});
});

test("workflow local transformations keep exact source refs and cannot launder a restricted result into a model", async () => {
  const { createObjectRepository } = await import("../app/features/objects/objectRepository");
  const { createObjectStorage } = await import("../app/features/objects/objectStorage");
  const { refOf } = await import("../app/features/objects/object.types");
  const { createWorkspaceAgentAssetService } = await import("../app/features/resource-filesystem/workspaceAgentAssetService");
  const { liteasyPath } = await import("../app/features/resource-filesystem/liteasyPath");
  const { createOperationHost } = await import("../app/features/workflows/operationHost");
  const { externalModelAssetService } = await import("../app/features/models/externalSourcePolicy");
  vi.stubGlobal("crypto", webcrypto);
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const source = await repository.create({ kind: "content.note", title: "Restricted reflection", sourceReferences: [{ scopeType: "organization", scopeId: "group", paperId: "annotation", revision: 2 }], content: { schema: "liteasy.note/v1", payload: { text: "SYNTHETIC SOURCE", origin: "derived" } } });
  const sourcePath = liteasyPath(scope, { kind: "object", ref: refOf(source) });
  const assets = createWorkspaceAgentAssetService({ repository, active: () => true });
  const model = vi.fn();
  const host = createOperationHost({ storage, assets, repository, scope, enabled: () => true, model });
  const grant = await host.grants.issue({ owner: "plugin.test", digest: "synthetic", capabilities: ["resources.create", "model.invoke"], selection: [sourcePath], output: true, modelConnection: "synthetic" });
  const request = { grantId: grant.id, owner: "plugin.test", digest: "synthetic", signal: new AbortController().signal };
  const created = await host.call({ ...request, operationId: "derived", operation: "resources.create", value: { kind: "note", title: "Workflow result", text: "SYNTHETIC DERIVED SUMMARY" } });
  expect(created.status).toBe("committed");
  const path = (created.result as { path: string }).path;
  expect((await assets.read(path)).text).toBe("SYNTHETIC DERIVED SUMMARY");
  await expect(externalModelAssetService(assets).read(path)).rejects.toThrow("属于组织");
  const result = await host.call({ ...request, operationId: "model", operation: "model.generate", value: { prompt: "Send derived summary", maxOutputTokens: 200 }, outputPaths: [path] });
  expect(result.status).toBe("failed");
  expect(model).not.toHaveBeenCalled();
});

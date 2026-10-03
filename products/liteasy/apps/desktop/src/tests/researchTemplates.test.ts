import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { paperLensPackage } from "../app/features/extensions/paperLensPackage";
import { validateExtensionPackage, compileExtensionWorkflow } from "../app/features/extensions/extensionPackage";
import { comparisonContent } from "../app/features/workflows/comparisonContent";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, objectText } from "../app/features/objects/object.types";
import { liteasyPath, parseLiteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { externalModelAssetService } from "../app/features/models/externalSourcePolicy";
import { createOperationHost } from "../app/features/workflows/operationHost";
import { createWorkflowRunner } from "../app/features/workflows/workflowRunner";
import type { JsonObject } from "../app/features/extensions/extensionSchema";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const ids = ["intuition-definition", "evidence-audit", "method-compare", "derivation-check", "book-excerpt"];
const cardType = { id: "plugin.paper-lens/reasoning-card", version: "1.0.0" };

test("exposes five source-bound templates through the installed package without model calls or overwrite operations", async () => {
  const pkg = await validateExtensionPackage(await paperLensPackage());
  for (const id of ids) {
    const command = pkg.manifest.contributes.commands.find((command) => command.id === id);
    expect(command?.workflow).toBe(id);
    const workflow = pkg.manifest.contributes.workflows.find((workflow) => workflow.id === id)!;
    const plan = compileExtensionWorkflow(pkg, workflow.path);
    expect(plan.capabilities).not.toContain("model.invoke");
    expect(plan.definition.budget.maxModelCalls).toBe(0);
    expect(plan.definition.nodes.map((node) => node.operation.id)).not.toContain("resources.write");
  }
});

test("keeps conflicting source excerpts, revision and confidence separate from empty model claims and user comments", () => {
  const source = (objectId: string, title: string, text: string, metadata = false) => ({
    asset: { path: liteasyPath("local", { kind: "object" as const, ref: { objectId, revision: "latest" }, followLatest: true }), title, kind: "source.document", revision: "revision-1" },
    text, offset: 0, totalCharacters: text.length, truncated: false,
    evidence: { kind: metadata ? "metadata" : "source", coverage: "unknown" }
  });
  const result = comparisonContent({ schema: "liteasy.research-template/v1", template: "method-compare", question: "Which assumption holds?", userComment: "I disagree with the sampling choice." }, [
    source("A", "Source A", "Randomization improves the estimate."),
    source("B", "Source B", "Randomization changes the target population."),
    source("C", "Source C", "Metadata only", true)
  ], cardType);
  expect(result.text).toContain("Randomization improves the estimate.");
  expect(result.text).toContain("Randomization changes the target population.");
  expect(result.text).toContain("revision-1");
  expect(result.text).toContain("revision=revision-1");
  expect(result.text).toContain("证据不足");
  expect(result.text).not.toContain("> Metadata only");
  expect(result.text).toContain("模型推断：未生成");
  expect(result.text).toContain("I disagree with the sampling choice.");
  expect(result.text).toContain("页码/章节未记录");
  expect(result.text).not.toContain("第 1 页");
});

test.each(["unavailable", "organization"] as const)("actual template reruns preserve user edits, immutable source revisions and %s provenance", async (sourceKind) => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const assets = createWorkspaceAgentAssetService({ repository, active: () => true, getPapers: sourceKind === "organization" ? () => [{ id: "guide", title: "Synthetic organization guide", libraryReference: { scopeType: "organization", scopeId: "synthetic-org", documentId: "synthetic-document", revision: 2 } }] : undefined });
  const source = await repository.projectLegacy("synthetic-guide-version", { kind: "source.document", title: "Synthetic field guide", content: { schema: "liteasy.source-document/v1", payload: {
    paperId: "guide", legacyKey: "synthetic-guide", availability: "local", text: "The original definition.", pages: [{ page: 3, text: "The original definition." }]
  } } });
  const path = liteasyPath(scope, { kind: "object", ref: { ...refOf(source), selectorId: "page:3" } });
  const pkg = await validateExtensionPackage(await paperLensPackage());
  const flow = pkg.manifest.contributes.workflows.find((item) => item.id === "evidence-audit")!;
  const plan = compileExtensionWorkflow(pkg, flow.path);
  const model = vi.fn(async () => { throw new Error("offline template must not call a model"); });
  const host = createOperationHost({ storage, repository, assets, scope, enabled: () => true, model });
  const grant = await host.grants.issue({ owner: pkg.manifest.id, digest: pkg.digest, capabilities: plan.capabilities, selection: [path], output: true, modelConnection: null });
  const runner = createWorkflowRunner(storage, host, scope);
  const input: JsonObject = { selection: [path], question: "Check the definition", userComment: "" };
  const first = await runner.create({ owner: pkg.manifest.id, digest: pkg.digest, definition: plan.definition, input, grantId: grant.id });
  const firstResult = await runner.execute(first.id);
  expect(firstResult.status, firstResult.error).toBe("succeeded");
  const output = (await runner.replay(first.id)).nodes.save as JsonObject;
  if (sourceKind === "unavailable") expect(output.sourceResolution).toBe("unavailable");
  else expect(output.sourceReferences).toEqual([{ paperId: "guide", scopeType: "organization", scopeId: "synthetic-org", documentId: "synthetic-document", revision: 2 }]);
  await expect(externalModelAssetService(assets).read(String(output.path))).rejects.toThrow(sourceKind === "organization" ? "属于组织" : "来源");
  const target = parseLiteasyPath(String(output.path), scope);
  if (target.kind !== "object") throw new Error("note missing");
  const note = await repository.resolveLatest(target.ref.objectId);
  expect(note.provenance.sourceRefs).toContainEqual(refOf(source));
  expect(objectText(note)).toContain("PDF 物理页：3");
  expect(objectText(note)).toContain(source.revision);
  await repository.editNote(refOf(note), `${objectText(note)}\n\nMy later correction.`);
  const changedSource = await repository.projectLegacy("synthetic-guide-version", { kind: "source.document", title: "Revised field guide", content: { schema: "liteasy.source-document/v1", payload: {
    paperId: "guide", legacyKey: "synthetic-guide", availability: "local", text: "A changed definition.", pages: [{ page: 3, text: "A changed definition." }]
  } } });
  expect(changedSource.revision).not.toBe(source.revision);
  const next = await runner.create({ owner: pkg.manifest.id, digest: pkg.digest, definition: plan.definition, input, grantId: grant.id, parentRunId: first.id });
  const nextResult = await runner.execute(next.id);
  expect(nextResult.status, nextResult.error).toBe("succeeded");
  const nextOutput = (await runner.replay(next.id)).nodes.save as JsonObject;
  const nextTarget = parseLiteasyPath(String(nextOutput.path), scope);
  if (nextTarget.kind !== "object") throw new Error("regenerated note missing");
  expect(objectText(await repository.resolveLatest(nextTarget.ref.objectId))).toContain("The original definition.");
  expect(objectText(await repository.resolveLatest(nextTarget.ref.objectId))).not.toContain("A changed definition.");
  expect(nextOutput.path).not.toBe(output.path);
  expect((await runner.replay(next.id)).run.parentRunId).toBe(first.id);
  expect(objectText(await repository.resolveLatest(note.objectId))).toContain("My later correction.");
  expect((await runner.recompute(first.id)).checks.every((check) => check.matches)).toBe(true);
  expect(model).not.toHaveBeenCalled();
});

test("actual paper metadata and user notes cannot masquerade as author evidence", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  const assets = createWorkspaceAgentAssetService({ repository, active: () => true, getPapers: () => [{ id: "metadata", title: "Unread paper" }] });
  const paper = await assets.read(liteasyPath(scope, { kind: "paper", paperId: "metadata" }));
  expect(paper.evidence).toMatchObject({ kind: "metadata", coverage: "partial" });
  const note = await assets.create({ kind: "note", title: "My interpretation", text: "My uncertain interpretation.", operationId: "user-note" });
  const read = await assets.read(note.path);
  expect(read.evidence).toMatchObject({ kind: "user" });
  const result = comparisonContent({ schema: "liteasy.research-template/v1", template: "evidence-audit" }, [paper, read], cardType);
  expect(result.text).toContain("用户笔记；不等同作者陈述");
  expect(result.text).toContain("仅元信息 / 证据不足");
  expect(result.text).not.toContain("> 当前仅有题录");
});

test("does not turn arbitrary page claims in source text into locators, and rejects revision mismatches", () => {
  const source = { asset: { path: liteasyPath("local", { kind: "object" as const, ref: { objectId: "book", revision: "r1" } }), title: "Book edition", kind: "source.document", revision: "r1" },
    text: "The model says page 999; this is merely quoted text.", evidence: { kind: "source", coverage: "unknown" } };
  const request = { schema: "liteasy.research-template/v1", template: "book-excerpt" };
  expect(comparisonContent(request, [source], cardType).text).toContain("页码/章节未记录");
  expect(comparisonContent(request, [source], cardType).text).not.toContain("PDF 物理页：999");
  expect(() => comparisonContent(request, [{ ...source, asset: { ...source.asset, revision: "r2" } }], cardType)).toThrow("版本");
});

test("rejects paper evidence whose source version changes while its text is read", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), repository = createObjectRepository(storage, scope);
  let papers = [{ id: "paper", title: "Synthetic paper", contentHash: "original-hash" }];
  const assets = createWorkspaceAgentAssetService({ repository, active: () => true, getPapers: () => papers, readPaper: async () => {
    papers = [{ ...papers[0], contentHash: "replacement-hash" }];
    return "Replacement source text.";
  } });
  await expect(assets.read(liteasyPath(scope, { kind: "paper", paperId: "paper" }))).rejects.toMatchObject({ code: "revision_conflict" });
});

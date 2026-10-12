import { expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createResourceTypeRegistry } from "../app/features/resource-filesystem/resourceTypeRegistry";
import { externalModelAssetService } from "../app/features/models/externalSourcePolicy";
import { createAgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import { researchResourceType } from "../app/features/research-loop/researchResourceType";
import { researchReportMarkdown, type ResearchTaskDetail } from "../app/features/research-loop/researchHostClient";
import { compileDocument } from "../app/features/document-export/documentCompiler";
import { renderDocumentHtml } from "../app/features/document-export/documentHtml";
import { renderMarkdownPackage } from "../app/features/document-export/documentMarkdown";
import { sha256 } from "../app/features/document-export/documentExport.types";
const path = "liteasy://resources/research-tasks/task-1?scope=local&revision=2";
function fixture() {
  let active = true;
  const detail: ResearchTaskDetail = { task: { taskId: "task-1", goal: "检查预取", checkpointRevision: 2 } as any,
    records: [{ id: "h", kind: "hypothesis", hash: "hash", body: { question: "问题", proposedMechanism: "机制", changedAssumption: "前提", predictions: ["预测"], falsificationCriteria: ["反例"], literatureRefs: [{ objectId: "source", revision: "v1" }] } }], runs: [] };
  const definition = researchResourceType({ scope: "local", active: () => active, host: { async call<T>(operation: string) { return (operation === "list" ? [detail.task] : detail) as T; } },
    objects: { id: "objects", accepts: () => true, search: async () => [], read: async () => { throw new Error("unused"); },
      stat: async () => ({ path: "source", title: "组织资料", kind: "source", capabilities: ["read"], sourceReferences: [{ scopeType: "organization", scopeId: "org", paperId: "paper", revision: 1 }] }) } });
  const registry = createResourceTypeRegistry(() => active); registry.register(definition);
  return { detail, registry, revoke: () => { active = false; } };
}
test("host research records use the existing registry and retain source restrictions", async () => {
  const { registry } = fixture();
  const assets = createAgentAssetService({ scopeId: "local", active: () => true, adapters: registry.adapters(), create: async () => { throw new Error("protected"); } });
  expect((await assets.stat(path)).sourceReferences?.[0].scopeType).toBe("organization");
  await expect(externalModelAssetService(assets).read(path)).rejects.toThrow("属于组织");
  expect((await assets.search({ query: "" }))).toEqual([]);
  await expect(assets.write(path, { text: "forged results", expectedRevision: "2" })).rejects.toThrow();
});
test("pinned task reads reject changed revisions and revoked account scopes", async () => {
  const { registry, detail, revoke } = fixture();
  expect((await registry.files.read(path, { representation: "native", maxBytes: 100000 })).content).toContain("task-1");
  detail.task.checkpointRevision = 3;
  await expect(registry.files.read(path, { representation: "native", maxBytes: 100000 })).rejects.toThrow("旧任务快照");
  revoke(); await expect(registry.files.list({ providerId: "research-tasks", scopeId: "local" })).rejects.toThrow("切换");
});
test("actual experiment metrics remain a semantic table in the shared export compiler", async () => {
  const metrics = { simulatedWaitP50Us: 0, simulatedWaitP95Us: 20, readAmplification: 1, cachePeakBytes: 4096, replayWallUs: 100 };
  const detail = { task: { goal: "CPU 实验" }, records: [], runs: [{ runId: "real-run", rawResult: { outputs: [{ workload: "heldout", algorithm: "lru", correctness: true, metrics }], conditions: ["synthetic only"] } }] } as any;
  const document = await compileDocument({ title: "报告", markdown: researchReportMarkdown(detail) });
  const html = renderDocumentHtml(document);
  expect(html).toContain("<table>"); expect(html).toContain("<td>heldout</td>"); expect(html).toContain("20");
});
test("evidence packages hash every raw attachment and include offline links", async () => {
  const document = await compileDocument({ title: "报告", markdown: "原始记录" });
  const bytes = new TextEncoder().encode('{"measured":true}');
  document.attachments = [{ path: "assets/research/raw-run.json", bytes, sha256: await sha256(bytes), mediaType: "application/json" }];
  const result = await renderMarkdownPackage(document), files = unzipSync(result.bytes);
  expect(strFromU8(files["README.md"])).toContain("[assets/research/raw-run.json](assets/research/raw-run.json)");
  expect(JSON.parse(strFromU8(files["manifest.json"])).attachments[0].sha256).toBe(await sha256(bytes));
  document.attachments[0].bytes = new TextEncoder().encode('{"measured":false}');
  await expect(renderMarkdownPackage(document)).rejects.toThrow("哈希");
});

test("export preserves the code snapshot of each historical spec across host upgrades", async () => {
  const { compileResearchDocument } = await import("../app/features/research-loop/researchExportAdapter");
  const oldSource = "// pinned old runner", newSource = "// pinned new runner";
  const oldHash = await sha256(oldSource), newHash = await sha256(newSource);
  const sources = new Map([[oldHash, oldSource], [newHash, newSource]]), requested: string[] = [];
  const detail = { task: { goal: "多版本实验", taskId: "task", checkpointRevision: 3 }, records: [
    { id: "old-spec", kind: "spec", hash: "old", body: { replay: { codeSnapshot: oldHash } } },
    { id: "new-spec", kind: "spec", hash: "new", body: { replay: { codeSnapshot: newHash } } },
  ], runs: [] } as unknown as ResearchTaskDetail;
  const document = await compileResearchDocument({ taskId: "task", scope: "local", sessionGeneration: "session", active: () => true, options: {},
    host: { async call<T>(operation: string, payload?: unknown) {
      if (operation === "get") return detail as T;
      const hash = (payload as { codeSnapshot: string }).codeSnapshot; requested.push(hash);
      return { source: sources.get(hash), sha256: hash } as T;
    } } });
  expect(requested).toEqual([oldHash, newHash]);
  expect(document.attachments?.map(attachment => attachment.path)).toEqual(expect.arrayContaining([
    "assets/research/task-ledger.json", `assets/research/runner-${oldHash}.rs`, `assets/research/runner-${newHash}.rs`,
  ]));
  expect(new TextDecoder().decode(document.attachments?.find(item => item.sha256 === oldHash)?.bytes)).toBe(oldSource);
});

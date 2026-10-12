import { compileDocument } from "../document-export/documentCompiler";
import { sha256, stableJson, type ExportOptions, type ExportDocument } from "../document-export/documentExport.types";
import { researchReportMarkdown, type ResearchTaskDetail, type ResearchHostPort } from "./researchHostClient";

/** A report adapter uses the existing compiler/serializers; native runs stay host-owned. */
export async function compileResearchDocument(input: {
  taskId: string; scope: string; sessionGeneration: string; active(): boolean;
  host: ResearchHostPort; options: Partial<ExportOptions>; signal?: AbortSignal;
}): Promise<ExportDocument> {
  const detail = await input.host.call<ResearchTaskDetail>("get", { taskId: input.taskId });
  const snapshot = structuredClone(detail);
  const document = await compileDocument({ title: "研究证据报告", markdown: researchReportMarkdown(snapshot), options: input.options,
    active: input.active, signal: input.signal,
    sources: [{ identity: input.taskId, revision: String(snapshot.task.checkpointRevision), state: "pinned", sha256: await sha256(stableJson(snapshot)) }] });
  document.scopeId = input.scope;
  document.sessionGeneration = input.sessionGeneration;
  const attachments: NonNullable<ExportDocument["attachments"]> = [];
  const ledgerBytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2) + "\n");
  attachments.push({ path: "assets/research/task-ledger.json", bytes: ledgerBytes, sha256: await sha256(ledgerBytes), mediaType: "application/json" });
  for (const run of snapshot.runs) {
    const spec = snapshot.records.find(record => record.id === run.specId && record.kind === "spec");
    if (!spec) continue;
    const key = (await sha256(run.runId)).slice(0, 16);
    for (const [name, body] of [["spec", spec.body.replay], ["full-spec", spec.body], ["raw-run", run], ["source-refs", { references: spec.body.literatureRefs, bindings: spec.body.sourceBindings, packet: spec.body.literaturePacket }]] as const) {
      const bytes = new TextEncoder().encode(JSON.stringify(body, null, 2) + "\n");
      attachments.push({ path: "assets/research/" + key + "-" + name + ".json", bytes, sha256: await sha256(bytes), mediaType: "application/json" });
    }
  }
  const command = "Liteasy --research-replay --spec <包内的 spec.json 路径> --output <新的空目录>";
  const bytes = new TextEncoder().encode(command + "\n说明：需相同宿主代码与 validator；复跑产物标为 unregistered_cpu_replay，不能自行登记为官方测量。\n");
  attachments.push({ path: "assets/research/replay-instructions.txt", bytes, sha256: await sha256(bytes), mediaType: "text/plain" });
  const codeSnapshots = [...new Set(snapshot.records.filter(record => record.kind === "spec")
    .map(record => (record.body.replay as { codeSnapshot: string }).codeSnapshot))];
  for (const codeSnapshot of codeSnapshots.length ? codeSnapshots : [undefined]) {
    const runner = await input.host.call<{ source: string; sha256: string }>("runner_source", { codeSnapshot });
    const runnerBytes = new TextEncoder().encode(runner.source);
    if (await sha256(runnerBytes) !== runner.sha256 || codeSnapshot && runner.sha256 !== codeSnapshot) throw new Error("运行代码快照核验失败。");
    attachments.push({ path: `assets/research/runner-${runner.sha256}.rs`, bytes: runnerBytes, sha256: runner.sha256, mediaType: "text/plain" });
  }
  if (attachments.reduce((size, item) => size + item.bytes.length, 0) > 24 * 1024 * 1024) throw new Error("研究原始附件超过导出预算，请按运行分别导出。");
  document.attachments = attachments;
  document.diagnostics.push({ code: "raw_research_attachments", severity: "warning", message: "原始结果、固定规格和复跑说明随 Markdown ZIP 交付；PDF/Word/HTML 包含阅读报告，需要同时保存 Markdown 包才能保留完整原始附件。" });
  document.assertAuthorized = async () => {
    if (!input.active()) throw new Error("研究权限已变化，不能发布旧资料。");
    const current = await input.host.call<ResearchTaskDetail>("get", { taskId: input.taskId });
    for (const run of snapshot.runs) if (run.resultHash && !current.runs.some(item => item.runId === run.runId && item.resultHash === run.resultHash)) throw new Error("研究结果已变化，导出快照失效。");
  };
  return document;
}

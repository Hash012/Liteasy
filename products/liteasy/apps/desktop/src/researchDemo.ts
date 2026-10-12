import { invoke } from "@tauri-apps/api/core";
import { createObjectStorage } from "./app/features/objects/objectStorage";
import { createObjectRepository } from "./app/features/objects/objectRepository";
import { refOf } from "./app/features/objects/object.types";
import { createResearchHostClient, defaultReplaySpec, type ResearchProjectTask, type ResearchRecord, type ResearchTaskDetail, type ExperimentRun } from "./app/features/research-loop/researchHostClient";
import { compileResearchDocument } from "./app/features/research-loop/researchExportAdapter";
import { renderExportDocument } from "./app/features/document-export/documentExportService";
import type { ArtifactExportPayload } from "./app/features/artifacts/artifactExport.types";

async function main() {
  await invoke("research_demo_authorize");
  const scope = "local", host = createResearchHostClient(scope, () => true);
  const repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const project = await repository.create({ kind: "workspace.board", title: "合成 DataLoader 项目", content: { schema: "liteasy.board/v1", payload: { description: "真实 CPU 回放验收；没有模型或真实论文。" } } });
  const source = await repository.create({ kind: "content.note", title: "合成条件说明", content: { schema: "liteasy.note/v1", payload: { origin: "user", text:
    "统一缓存与 I/O 预算；未来请求不可见；保持样本、顺序、image+label 对齐。顺序访问收益必须在 held-out 步进 trace 检查，不能当作 GPU 提速或新颖性。RESEARCH_SOURCE_SENTINEL" } } });
  const task = await host.call<ResearchProjectTask>("create_task", { projectRef: refOf(project), parentSessionRef: null, goal: "在限定条件下检查预取，并尝试反驳它。" });
  const hypothesis = await host.call<ResearchRecord>("draft_hypothesis", { taskId: task.taskId, question: "顺序预取是否减少等待？",
    proposedMechanism: "把下一个编号的 I/O 与当前计算重叠。", changedAssumption: "请求顺序是可预测的。",
    nearestBaselines: ["LRU", "按需读取"], applicabilityConditions: ["已知样本编号", "统一缓存/I/O预算"],
    predictions: ["顺序 trace 等待降低"], falsificationCriteria: ["held-out 不改善或任何样本错误"], literatureRefs: [refOf(source)] });
  const capability = await host.call<{ validatorVersion: string; codeSnapshot: string }>("capability");
  const replay = defaultReplaySpec(capability);
  const negativeCases: Record<string, string> = {};
  async function refused(name: string, operation: string, payload: unknown) {
    try { await host.call(operation, payload); throw new Error("EXPECTED_REFUSAL_NOT_OBSERVED:" + name); }
    catch (error) { if (String(error).includes("EXPECTED_REFUSAL_NOT_OBSERVED")) throw error; negativeCases[name] = String(error); }
  }
  await refused("unread_source", "prepare_spec", { taskId: task.taskId, hypothesisId: hypothesis.id, replay });
  await refused("model_forged_measurement", "submit_result", { taskId: task.taskId, runId: "fake", throughput: 999999 });
  const read = await host.call<{ text: string }>("read_source", { taskId: task.taskId, reference: refOf(source), offset: 0 });
  if (!read.text.includes("RESEARCH_SOURCE_SENTINEL")) throw new Error("actual_source_missing");
  await refused("oracle", "prepare_spec", { taskId: task.taskId, hypothesisId: hypothesis.id, replay: { ...replay, candidate: "oracle" } });
  await refused("omitted_samples", "prepare_spec", { taskId: task.taskId, hypothesisId: hypothesis.id, replay: { ...replay, candidate: "omit_samples" } });
  await refused("modified_validator", "prepare_spec", { taskId: task.taskId, hypothesisId: hypothesis.id, replay: { ...replay, codeSnapshot: "0".repeat(64) } });
  const runs: ExperimentRun[] = [], specs: ResearchRecord[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const spec = await host.call<ResearchRecord>("prepare_spec", { taskId: task.taskId, hypothesisId: hypothesis.id, replay });
    specs.push(spec);
    const grant = await host.call<ResearchRecord>("approve_small_experiment", { taskId: task.taskId, specId: spec.id, expectedSpecHash: spec.hash });
    const input = { taskId: task.taskId, specId: spec.id, grantId: grant.id, idempotencyKey: "synthetic-attempt-" + attempt };
    const initial = await host.call<ExperimentRun>("submit", input);
    const retry = await host.call<ExperimentRun>("submit", input);
    if (retry.runId !== initial.runId) throw new Error("lost_receipt_repeated_execution");
    negativeCases.lost_receipt = "same host-issued runId, no second execution";
    let run = retry;
    while (["submitting", "running"].includes(run.status)) {
      await new Promise(resolve => setTimeout(resolve, 20));
      run = await host.call<ExperimentRun>("get_run", { runId: initial.runId });
    }
    if (run.status !== "completed" || !run.rawResult?.correctnessPassed || !run.rawResult.conditions.some(value => value.includes("narrower"))) throw new Error("real_runner_validation_failed");
    runs.push(run);
  }
  await host.call("decision", { taskId: task.taskId, runId: runs.at(-1)!.runId, action: "narrow", rationale: "三个合成回放保留正确性；收益限于顺序工作负载，不扩展到 held-out，也不宣称 GPU 或新颖性。" });
  const detail = await host.call<ResearchTaskDetail>("get", { taskId: task.taskId });
  if (detail.runs.length !== 3) throw new Error("unexpected_run_count");
  const exports: ArtifactExportPayload[] = [];
  for (const format of ["markdown", "html", "docx", "pdf"] as const) {
    const document = await compileResearchDocument({ taskId: task.taskId, scope, sessionGeneration: "synthetic-qa", active: () => true, host,
      options: { acceptDegradations: true } });
    exports.push(await renderExportDocument(document, format));
  }
  await invoke("research_demo_complete", { result: { task: detail.task, records: detail.records, runs, specs, negativeCases, projectRef: refOf(project), sourceRef: refOf(source) }, exports, error: null });
}
void main().catch(error => { void invoke("research_demo_complete", { result: null, exports: null, error: String(error) }); });

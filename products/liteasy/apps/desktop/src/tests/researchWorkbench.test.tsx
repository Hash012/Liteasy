import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResearchWorkbench } from "../app/features/research-loop/ResearchWorkbench";
import type { ResearchWorkbenchModel } from "../app/features/research-loop/researchWorkbench.types";

function model(): ResearchWorkbenchModel {
  return { supported: true, tasks: [], detail: { task: { taskId: "task", goal: "检查预取", state: "waiting_user", budget: { usedRuns: 0, maxRuns: 3 }, taskBrief: { nextCheck: "核对原始结果" } },
    records: [{ id: "claim-1", hash: "hash-1", kind: "claim", body: { status: "supported_under_conditions", conditions: ["仅顺序 trace"] } }], runs: [] },
    connections: { activeAccount: null, accounts: [] }, models: [], model: "", goal: "检查预取", sources: [], busy: false,
    notice: "", answer: "", backend: { configured: false, requiredVersion: "0.154.0" }, candidate: "sequential", hypothesisId: "", runId: "",
    hypothesis: { question: "", proposedMechanism: "", changedAssumption: "", prediction: "", falsification: "" }, harnessReceipt: "",
    confirmClaim: vi.fn(), setRunId: vi.fn(), setHypothesisId: vi.fn(), readEvidence: vi.fn(),
  } as unknown as ResearchWorkbenchModel;
}
test("human confirmation is bound to the displayed claim and resets for a different claim or task", async () => {
  const value = model(); const { rerender } = render(<ResearchWorkbench model={value} />);
  fireEvent.click(screen.getByRole("button", { name: "决策与条件化结论", exact: true }));
  const confirm = screen.getByRole("button", { name: "记录人工确认" });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核对原始输出/ }));
  fireEvent.click(confirm); expect(value.confirmClaim).toHaveBeenCalledOnce();
  const changed = { ...value, detail: { ...value.detail!, records: [...value.detail!.records,
    { id: "claim-2", hash: "hash-2", kind: "claim", body: { status: "inconclusive" } }] } };
  rerender(<ResearchWorkbench model={changed} />);
  await waitFor(() => expect(confirm).toBeDisabled());
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核对原始输出/ }));
  rerender(<ResearchWorkbench model={{ ...changed, detail: { ...changed.detail, task: { ...changed.detail.task, taskId: "another" } } }} />);
  await waitFor(() => expect(confirm).toBeDisabled());
});
test("a failed experiment allows a stop decision while a live job cannot be finalized", () => {
  const value = model(); value.detail!.runs = [{ runId: "failed-run", status: "failed" } as any];
  const { rerender } = render(<ResearchWorkbench model={value} />);
  fireEvent.click(screen.getByRole("button", { name: "决策与条件化结论", exact: true }));
  expect(screen.getByRole("button", { name: "记录停止决策" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "记录收缩结论" })).toBeDisabled();
  rerender(<ResearchWorkbench model={{ ...value, detail: { ...value.detail!, task: { ...value.detail!.task, state: "waiting_job" } } }} />);
  expect(screen.getByRole("button", { name: "记录停止决策" })).toBeDisabled();
});
test("claim evidence opens the exact source revision", () => {
  const value = model(), reference = { objectId: "paper", revision: "version-two" };
  value.detail!.records[0].body.evidenceSpans = [{ reference, offset: 10, endOffset: 42 }];
  render(<ResearchWorkbench model={value} />);
  fireEvent.click(screen.getByRole("button", { name: "决策与条件化结论", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /查看原始依据/ }));
  expect(value.readEvidence).toHaveBeenCalledWith(reference);
});

test("stage disclosure keeps field nodes and confirmation values without approving an experiment", () => {
  const value = model(); const view = render(<ResearchWorkbench model={value} />);
  const question = screen.getByLabelText("问题");
  expect(question.closest("fieldset")).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "假设分支", exact: true }));
  expect(screen.getByLabelText("问题")).toBe(question);
  expect(question.closest("fieldset")).not.toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "决策与条件化结论", exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核对原始输出/ }));
  fireEvent.click(screen.getByRole("button", { name: "来源与访问范围", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "决策与条件化结论", exact: true }));
  expect(screen.getByRole("checkbox", { name: /我已核对原始输出/ })).toBeChecked();
  expect(value.confirmClaim).not.toHaveBeenCalled();
  view.unmount();
});

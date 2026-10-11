import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EvidenceLens } from "../app/features/evidence/components/EvidenceLens";
import type { EvidenceReportV1 } from "../app/features/evidence/evidenceReport";

function report(): EvidenceReportV1 {
  return {
    schema: "liteasy.evidence-report/v1", id: "r1", runId: "run1", answerRevision: "answer1", generatedAt: "2026-10-11",
    sources: [{ id: "s1", kind: "paper_pdf", title: "研究原文", coverage: "abstract_only" }],
    passages: [{ id: "p1", sourceId: "s1", quote: "实验只在小样本上成立。", locator: { page: 2, precision: "page" }, locatorIntegrity: "page_only" }],
    claims: [
      { id: "c1", text: "模型对所有人有效", kind: "fact", assessment: "unverified", edges: [{ passageId: "p1", relation: "direct_support" }] },
      { id: "c2", text: "两个实验结果不一致", kind: "fact", assessment: "contested", edges: [{ passageId: "p1", relation: "contradicts" }] }
    ], verifications: []
  };
}
const expand = () => fireEvent.click(screen.getByRole("button", { name: /1 篇来源/ }));

test("keeps evidence collapsed and deduplicates repeated passages without confidence percentages", () => {
  const value = report();
  value.passages.push({ ...value.passages[0], id: "duplicate" });
  const { container } = render(<div style={{ width: 320 }}><EvidenceLens report={value} /></div>);
  expect(screen.getByRole("button", { name: /1 篇来源.*1 处引用/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("实验只在小样本上成立。")).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/%|概率|评分/);
});

test("opens one keyboard-accessible peek and returns focus with Escape", async () => {
  const user = userEvent.setup();
  render(<EvidenceLens report={report()} />);
  expand();
  const trigger = screen.getByRole("button", { name: "查看论断 1：模型对所有人有效" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const peek = screen.getByRole("dialog", { name: "论断与证据" });
  expect(within(peek).getByText("关系未核验")).toBeVisible();
  expect(within(peek).queryByText("直接支持")).not.toBeInTheDocument();
  expect(within(peek).getByText("仅摘要")).toBeVisible();
  expect(within(peek).getByRole("button", { name: "打开原文" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "关闭证据预览" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "查看论断 2：两个实验结果不一致" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(screen.getByRole("dialog")).getByText("两个实验结果不一致")).toBeVisible();
});

test("filters details in the same column without mutating summary counts", async () => {
  render(<EvidenceLens report={report()} />);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "查看全部证据" }));
  const inspector = screen.getByRole("region", { name: "证据详情" });
  fireEvent.change(within(inspector).getByRole("combobox", { name: "筛选论断" }), { target: { value: "contested" } });
  expect(within(inspector).getByText("两个实验结果不一致")).toBeVisible();
  expect(within(inspector).queryByText("模型对所有人有效")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /1 篇来源.*1 处引用.*1 有分歧.*1 未核验/ })).toBeVisible();
  fireEvent.keyDown(inspector, { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("button", { name: "查看全部证据" })).toHaveFocus());
});

test("shows legacy sources without inventing claims and renders hostile strings as text", () => {
  const value = report(); value.claims = [];
  value.sources[0].title = '<img src=x onerror="alert(1)">';
  value.passages[0].quote = "[click](javascript:alert(1)) <script>bad()</script>";
  const { container } = render(<EvidenceLens report={value} />);
  expect(screen.getByRole("button", { name: /未逐条核验/ })).toBeVisible();
  expand(); fireEvent.click(screen.getByRole("button", { name: "查看全部证据" }));
  expect(screen.getByText(value.sources[0].title)).toBeVisible();
  expect(screen.getByText(value.passages[0].quote)).toBeVisible();
  expect(container.querySelector("script, img, a")).toBeNull();
  expect(screen.queryByText("有支持")).not.toBeInTheDocument();
});

test("opens the real passage, catches failure, and disables stale navigation", async () => {
  const navigate = vi.fn().mockRejectedValue(new Error("secret provider content"));
  const value = report();
  const { rerender } = render(<EvidenceLens report={value} onOpenPassage={navigate} />);
  expand(); fireEvent.click(screen.getByRole("button", { name: "查看论断 1：模型对所有人有效" }));
  fireEvent.click(screen.getByRole("button", { name: "打开原文" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("原文打开失败"));
  expect(navigate).toHaveBeenCalledWith(value.passages[0]);
  expect(screen.queryByText("secret provider content")).not.toBeInTheDocument();
  rerender(<EvidenceLens report={{ ...value, passages: [{ ...value.passages[0], locatorIntegrity: "stale" }] }} onOpenPassage={navigate} />);
  expect(screen.getByRole("button", { name: "打开原文" })).toBeDisabled();
  expect(screen.getByText("来源版本已变化，请重新获取证据。")).toBeVisible();
});

test("does not advertise reviewed claims while streaming and bounds default rendering", () => {
  const value = report();
  value.claims = Array.from({ length: 50 }, (_, index) => ({ ...value.claims[0], id: `claim${index}`, assessment: "supported" }));
  render(<EvidenceLens report={value} streaming />);
  expect(screen.getByRole("button", { name: /生成中 · 未核验/ })).toBeVisible();
  expect(screen.queryByText(/有支持/)).not.toBeInTheDocument();
  expand();
  expect(screen.getAllByRole("button", { name: /查看论断/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
  expect(screen.getAllByRole("button", { name: /查看论断/ })).toHaveLength(8);
});

test("lets the authorized resolver open a non-PDF file snapshot without a page", async () => {
  const value = report();
  value.passages[0] = { ...value.passages[0], locator: { precision: "unavailable" }, locatorIntegrity: "unknown" };
  value.sources[0] = { ...value.sources[0], kind: "object" };
  const navigate = vi.fn();
  render(<EvidenceLens report={value} canOpenPassage={() => true} onOpenPassage={navigate} />);
  expand(); fireEvent.click(screen.getByRole("button", { name: "查看论断 1：模型对所有人有效" }));
  expect(screen.getByText("文件快照，未记录页码")).toBeVisible();
  expect(screen.getByRole("button", { name: "打开原文" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "打开原文" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(value.passages[0]));
});

test("reveals source excerpts on the first expansion without an empty intermediate screen", () => {
  const value = report(); value.claims = [];
  value.sources[0].revision = "version-42";
  render(<EvidenceLens report={value} onOpenPassage={vi.fn()} />);
  expand();
  expect(screen.getByText("实验只在小样本上成立。")).toBeVisible();
  expect(screen.getByRole("button", { name: "打开原文" })).toBeEnabled();
  expect(screen.getByText(/version-42/)).toBeInTheDocument();
});

test("keeps failed check status visible while collapsing detailed execution records", () => {
  const value = report(); value.claims = [];
  value.verifications = [{ id: "check", checkerKind: "structural_rules", origin: "structural_rules", status: "timed_out", evaluatedClaimIds: [], reviewedPassageIds: [], finding: "远端响应超过时限，已回退结构检查。" }];
  const { container } = render(<EvidenceLens report={value} />);
  expand();
  const details = container.querySelector("details.evidence-lens__checks")!;
  expect(details).not.toHaveAttribute("open");
  expect(within(details.querySelector("summary")!).getByText(/检查超时/)).toBeVisible();
  fireEvent.click(within(details as HTMLElement).getByText(/核验说明/));
  expect(screen.getByText("远端响应超过时限，已回退结构检查。")).toBeVisible();
});


test("makes every metadata-only source reachable in the inspector", () => {
  const value = report(); value.claims = []; value.passages = [];
  value.sources = Array.from({ length: 15 }, (_, index) => ({ id: `source-${index}`, kind: "paper_abstract", title: `仅元信息来源 ${index + 1}`, coverage: "metadata_only" }));
  render(<EvidenceLens report={value} />);
  fireEvent.click(screen.getByRole("button", { name: /15 篇来源/ }));
  fireEvent.click(screen.getByRole("button", { name: "查看全部证据" }));
  expect(screen.queryByText(/仅元信息来源 15/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
  expect(screen.getByText(/仅元信息来源 15/)).toBeVisible();
});

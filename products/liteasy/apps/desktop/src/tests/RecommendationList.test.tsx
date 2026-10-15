import { selectPickerValue } from "./helpers/selectPickerValue";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RecommendationList, recommendationDateLabel } from "../app/features/recommendations/RecommendationList";
import { FileStatusBar } from "../app/layout/FileStatusBar";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import { RecommendationDetails } from "../app/features/recommendations/RecommendationDetails";

const probe = vi.hoisted(() => vi.fn());
vi.mock("../app/features/paper-services/paperPdfResolver", async (original) => ({ ...await original<object>(), probePaperPdf: probe }));
afterEach(() => { vi.restoreAllMocks(); probe.mockReset(); });

const item: RecommendationItem = {
  id: "paper", title: "Research on memory systems", authors: ["Researcher A"], publishedAt: "2024-07-12",
  publishedYear: 2024, venue: "Systems Conference", abstract: "An abstract about useful memory.",
  reason: "Selected because of matching topics.", source: "Crossref", sourceKind: "live", sourceUrl: "https://doi.org/10.1234/test",
  discoveredAt: "2026-09-29", relatedDocumentTitle: "Memory paper", relevanceBand: "high", relevanceScore: 0.9,
};

test("keeps rows compact, shows selected metadata below, and double-click opens details without downloading", async () => {
  const download = vi.fn().mockResolvedValue("已下载");
  const open = vi.fn();
  function Fixture() {
    const [selected, select] = useState<RecommendationItem>();
    return <><RecommendationList items={[item]} selectedId={selected?.id} onInspect={select} onOpen={open}
      pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} />
      <FileStatusBar status={selected ? { name: selected.title, type: "推荐文献", recommendation: selected } : undefined} onDownloadRecommendation={download} /></>;
  }
  render(<Fixture />);
  const user = userEvent.setup();
  const rows = screen.getByRole("list", { name: "推荐论文" });
  expect(rows).toHaveTextContent("2024-07");
  expect(rows).toHaveTextContent(item.reason);
  expect(rows).toHaveTextContent("Researcher A");
  const row = screen.getByRole("button", { name: `查看推荐 ${item.title}` });
  await user.click(row);
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByLabelText("文件状态栏")).not.toHaveTextContent("Researcher A");
  await user.dblClick(row);
  expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...item, fullText: { status: "unknown" } }));
  expect(download).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "展开推荐元信息" }));
  const details = screen.getByRole("region", { name: "推荐文献元信息" });
  expect(details).toHaveTextContent(item.abstract!);
  expect(details).toHaveTextContent("Researcher A");
  expect(details).toHaveTextContent("Systems Conference");
  expect(within(details).getByRole("link", { name: "Crossref" })).toHaveAttribute("href", item.sourceUrl);
});

test("never invents a publication month when only the year is known", () => {
  expect(recommendationDateLabel({ ...item, publishedAt: "2024" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: undefined })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: "2024-99" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: "2024-02-30" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: undefined, publishedYear: undefined })).toBe("日期未知");
});
test("offers undo after dismissing a topic recommendation without probing sources", async () => {
  const dismiss = vi.fn(), feedback = vi.fn().mockResolvedValue({ eventId: "feedback-event", committedRevision: 1 });
  render(<RecommendationList items={[item]} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={dismiss} onFeedback={feedback} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `推荐操作 ${item.title}` }));
  await user.click(screen.getByRole("menuitem", { name: "不感兴趣" }));
  expect(dismiss).not.toHaveBeenCalled();
  expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ id: item.id }), "not_relevant", expect.objectContaining({ commandId: expect.any(String) }));
  await user.click(screen.getByRole("button", { name: "撤销反馈" }));
  expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ id: item.id }), "undo", expect.objectContaining({ targetEventId: "feedback-event" }));
  expect(probe).not.toHaveBeenCalled();
});

test("narrows recommendations by author, year and available full text without replacing the source list", async () => {
  const open = vi.fn();
  probe.mockImplementation(async (source: { id: string }) => ({ status: source.id === "new" ? "available" : "unavailable", checkedAt: Date.now(), url: source.id === "new" ? "https://repo.test/paper.pdf" : undefined }));
  const items = [item, { ...item, id: "new", title: "New memory systems", authors: ["Author B"], publishedAt: "2026-03", citationCount: 40, openAccessAvailable: true }];
  const user = userEvent.setup();
  render(<RecommendationList items={items} pendingIds={[]} canSave onOpen={open} onSave={vi.fn()} onDismiss={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "搜索推荐论文" }), "Author B");
  expect(screen.queryByRole("button", { name: `查看推荐 ${item.title}` })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索推荐论文" }));
  await user.click(screen.getByRole("button", { name: "推荐筛选" }));
  await selectPickerValue(screen.getByRole("combobox", { name: "推荐排序" }), "newest");
  expect(screen.getAllByRole("button", { name: /^查看推荐/ })[0]).toHaveAccessibleName("查看推荐 New memory systems");
  await user.click(screen.getByRole("checkbox", { name: "可下载 PDF" }));
  expect(probe).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "检查全文链接" }));
  expect(await screen.findAllByRole("button", { name: /^查看推荐/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "推荐筛选" }));
  await selectPickerValue(screen.getByRole("combobox", { name: "推荐发表年份" }), "2024");
  expect(await screen.findByText(/暂未发现符合筛选条件的全文链接/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getAllByRole("button", { name: /^查看推荐/ })).toHaveLength(2);
  screen.getAllByRole("button", { name: /^查看推荐/ })[0].focus();
  await user.keyboard("{Enter}");
  expect(open).toHaveBeenCalledOnce();
});

test("shows a readable paper page and saves to the chosen library directory", async () => {
  const download = vi.fn().mockResolvedValue("已下载到 Research。");
  const available = { ...item, openAccessPdfUrl: "https://paper.test/paper.pdf" };
  render(<RecommendationDetails page item={available} onDownload={download} locations={{ rootPath: "D:/Library", folders: [
    { name: "Research", path: "D:/Library/Research", parentPath: "D:/Library" },
  ] }} />);
  const user = userEvent.setup();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(item.title);
  expect(screen.getByRole("link", { name: "打开论文网站" })).toHaveAttribute("href", item.sourceUrl);
  await selectPickerValue(screen.getByRole("combobox", { name: "论文保存目录" }), "D:/Library/Research");
  await user.type(screen.getByRole("textbox", { name: "新建论文保存子目录" }), "Memory");
  await user.click(screen.getByRole("button", { name: "下载 PDF 并保存" }));
  expect(download).toHaveBeenCalledExactlyOnceWith(available, expect.objectContaining({ targetFolderPath: "D:/Library/Research", newFolderName: "Memory", signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
  expect(await screen.findByText("已下载到 Research。")).toBeInTheDocument();
});

test("allows full-text lookup without a prefilled PDF URL and rejects unsafe source links", async () => {
  const download = vi.fn().mockResolvedValue("已查找并下载");
  render(<RecommendationDetails page item={{ ...item, sourceUrl: "javascript:alert(1)" }} onDownload={download} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "下载 PDF 并保存" }));
  expect(download).toHaveBeenCalledOnce();
  expect(await screen.findByText("已查找并下载")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "打开论文网站" })).not.toBeInTheDocument();
});

test("shows a diverse three-card slate and pages the cached pool without remote calls", async () => {
  const user = userEvent.setup();
  const candidates = Array.from({ length: 15 }, (_, index) => ({ ...item, id: `candidate-${index}`, title: `Research topic ${index}`, relatedDocumentTitles: [index < 8 ? "systems" : "biology"], relevanceScore: .9 - index * .01 }));
  render(<RecommendationList items={candidates} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} />);
  const rows = () => within(screen.getByRole("list", { name: "推荐论文" })).getAllByRole("button", { name: /^查看推荐/ });
  expect(rows()).toHaveLength(3);
  const before = rows().map(row => row.textContent);
  await user.click(screen.getByRole("button", { name: "更多推荐操作" }));
  await user.click(screen.getByRole("menuitem", { name: "换一组" }));
  expect(rows()).toHaveLength(3); expect(rows().map(row => row.textContent)).not.toEqual(before);
  await user.click(screen.getByRole("button", { name: "更多推荐操作" }));
  await user.click(screen.getByRole("menuitem", { name: "查看更多候选 · 15" }));
  expect(rows()).toHaveLength(12);
  await user.click(screen.getByRole("button", { name: "下一页" })); expect(rows()).toHaveLength(3);
  expect(probe).not.toHaveBeenCalled();
});

test("pending and failed feedback never claims saved; retry reuses the same command and exact receipt", async () => {
  let reject!: (error: Error) => void;
  const feedback = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ eventId: "committed", committedRevision: 1 });
  render(<RecommendationList items={[item]} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} onFeedback={feedback} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `推荐操作 ${item.title}` }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "太基础", exact: true }));
  expect(screen.getByText("正在保存…")).toBeVisible();
  await user.click(screen.getByRole("button", { name: `推荐操作 ${item.title}` }));
  expect(screen.getByRole("menuitemcheckbox", { name: "太基础", exact: true })).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Escape}");
  reject(new Error("disk full")); await user.click(await screen.findByRole("button", { name: "重试保存反馈" }));
  expect(feedback.mock.calls[1][2]).toEqual(feedback.mock.calls[0][2]);
  await user.click(screen.getByRole("button", { name: `推荐操作 ${item.title}` }));
  expect(screen.getByRole("menuitemcheckbox", { name: "太基础", exact: true })).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "撤销反馈" }));
  expect(feedback.mock.calls[2][2]).toMatchObject({ targetEventId: "committed" });
});


test("an empty pool keeps AI discovery available and secondary feed actions inside one menu", async () => {
  const curate = vi.fn().mockResolvedValue(undefined), apply = vi.fn().mockResolvedValue(undefined);
  render(<RecommendationList items={[]} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} onCurate={curate} onApplyPreferences={apply} />);
  const user = userEvent.setup();
  expect(screen.getByRole("button", { name: "AI 精选" })).toBeEnabled();
  expect(screen.queryByRole("menuitem", { name: "应用反馈" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "AI 精选" }));
  expect(curate).toHaveBeenCalledWith();
  await user.click(screen.getByRole("button", { name: "更多推荐操作" }));
  await user.click(screen.getByRole("menuitem", { name: "应用反馈" }));
  expect(apply).toHaveBeenCalledOnce();
});

test.each(["legacy", "stale", "failed", "generating", "unavailable"] as const)("%s reasons never display superseded model claims", async reasonState => {
  render(<RecommendationList items={[{ ...item, reasonState, reason: "不应显示的旧推荐结论" }]} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} />);
  expect(screen.queryByText("不应显示的旧推荐结论")).not.toBeInTheDocument();
  expect(screen.queryByText(/已阅读全文/)).not.toBeInTheDocument();
});

test("shows the supplied research rationale and discloses its actual evidence limits separately", async () => {
  const explain = vi.fn().mockResolvedValue(undefined);
  const curated: RecommendationItem = { ...item, reasonState: "grounded", reason: "完整解释与元信息", researchReason: {
    consentEpoch: 1, candidateId: item.id, evidenceIds: ["source-1"], text: "摘要比较了与当前课题相同的误差来源。", role: "comparison", model: "configured-model", recipe: "explicit-curation-v3", generatedAt: "2026-10-15", evidence: [], basis: "abstract", limitation: "尚未验证实验数据。"
  } };
  render(<RecommendationList items={[curated]} pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} onCurate={explain} />);
  expect(screen.getByText(curated.researchReason!.text)).toBeVisible();
  expect(screen.getByText(/尚未验证实验数据/)).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "推荐详情", exact: true }));
  expect(screen.getByText(/依据：论文摘要/)).toBeVisible();
  expect(screen.getByText(/尚未验证实验数据/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: `推荐操作 ${item.title}` }));
  await userEvent.click(screen.getByRole("menuitem", { name: "解释为什么推荐" }));
  expect(explain).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, researchReason: curated.researchReason }));
});

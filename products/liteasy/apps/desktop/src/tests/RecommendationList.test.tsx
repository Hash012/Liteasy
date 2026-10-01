import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RecommendationList, recommendationDateLabel } from "../app/features/recommendations/RecommendationList";
import { FileStatusBar } from "../app/layout/FileStatusBar";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import { RecommendationDetails } from "../app/features/recommendations/RecommendationDetails";

afterEach(() => vi.restoreAllMocks());

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
  expect(rows).not.toHaveTextContent(item.reason);
  expect(rows).toHaveTextContent("Researcher A");
  const row = screen.getByRole("button", { name: `查看推荐 ${item.title}` });
  await user.click(row);
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByLabelText("文件状态栏")).toHaveTextContent("Researcher A · 2024-07 · Systems Conference");
  await user.dblClick(row);
  expect(open).toHaveBeenCalledExactlyOnceWith(item);
  expect(download).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "展开推荐元信息" }));
  const details = screen.getByRole("region", { name: "推荐文献元信息" });
  expect(details).toHaveTextContent(item.abstract!);
  expect(within(details).getByRole("link", { name: "Crossref" })).toHaveAttribute("href", item.sourceUrl);
});

test("never invents a publication month when only the year is known", () => {
  expect(recommendationDateLabel({ ...item, publishedAt: "2024" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: undefined })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: "2024-99" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: "2024-02-30" })).toBe("2024");
  expect(recommendationDateLabel({ ...item, publishedAt: undefined, publishedYear: undefined })).toBe("日期未知");
});

test("narrows recommendations by author, year and available full text without replacing the source list", async () => {
  const open = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
  const items = [item, { ...item, id: "new", title: "New memory systems", authors: ["Author B"], publishedAt: "2026-03", citationCount: 40, openAccessAvailable: true }];
  const user = userEvent.setup();
  render(<RecommendationList items={items} pendingIds={[]} canSave onOpen={open} onSave={vi.fn()} onDismiss={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "搜索推荐论文" }), "Author B");
  expect(screen.queryByRole("button", { name: `查看推荐 ${item.title}` })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索推荐论文" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "推荐排序" }), "newest");
  expect(screen.getAllByRole("button", { name: /^查看推荐/ })[0]).toHaveAccessibleName("查看推荐 New memory systems");
  await user.click(screen.getByRole("checkbox", { name: "可获取全文" }));
  expect(screen.getAllByRole("button", { name: /^查看推荐/ })).toHaveLength(1);
  await user.selectOptions(screen.getByRole("combobox", { name: "推荐发表年份" }), "2024");
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
  await user.selectOptions(screen.getByRole("combobox", { name: "论文保存目录" }), "D:/Library/Research");
  await user.type(screen.getByRole("textbox", { name: "新建论文保存子目录" }), "Memory");
  await user.click(screen.getByRole("button", { name: "下载 PDF 并保存" }));
  expect(download).toHaveBeenCalledExactlyOnceWith(available, { targetFolderPath: "D:/Library/Research", newFolderName: "Memory" });
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

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RecommendationList, recommendationDateLabel } from "../app/features/recommendations/RecommendationList";
import { FileStatusBar } from "../app/layout/FileStatusBar";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const item: RecommendationItem = {
  id: "paper", title: "Research on memory systems", authors: ["Researcher A"], publishedAt: "2024-07-12",
  publishedYear: 2024, venue: "Systems Conference", abstract: "An abstract about useful memory.",
  reason: "Selected because of matching topics.", source: "Crossref", sourceKind: "live", sourceUrl: "https://doi.org/10.1234/test",
  discoveredAt: "2026-09-29", relatedDocumentTitle: "Memory paper", relevanceBand: "high", relevanceScore: 0.9,
};

test("keeps rows compact, shows selected metadata below, and only double-click downloads", async () => {
  const download = vi.fn().mockResolvedValue("已下载");
  function Fixture() {
    const [selected, select] = useState<RecommendationItem>();
    return <><RecommendationList items={[item]} selectedId={selected?.id} onInspect={select} onDownload={download}
      pendingIds={[]} canSave onSave={vi.fn()} onDismiss={vi.fn()} />
      <FileStatusBar status={selected ? { name: selected.title, type: "推荐文献", recommendation: selected } : undefined} onDownloadRecommendation={download} /></>;
  }
  render(<Fixture />);
  const user = userEvent.setup();
  const rows = screen.getByRole("list", { name: "推荐论文" });
  expect(rows).toHaveTextContent("2024-07");
  expect(rows).not.toHaveTextContent(item.reason);
  expect(rows).not.toHaveTextContent("Researcher A");
  const row = screen.getByRole("button", { name: `查看推荐 ${item.title}` });
  await user.click(row);
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByLabelText("文件状态栏")).toHaveTextContent("Researcher A · 2024-07 · Systems Conference");
  await user.dblClick(row);
  expect(download).toHaveBeenCalledExactlyOnceWith(item);
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

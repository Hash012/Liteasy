import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Plaza } from "./AnnotationApp";
import { communityApi } from "./communityApi";
import { annotationFixture } from "./reading-group/readingGroupFixtures";
vi.mock("./communityApi", () => ({ communityApi: { plazaPage: vi.fn(), plaza: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); history.replaceState({}, "", "/"); });
afterEach(cleanup);

test("the actual feed renders all65 authorized synthetic items through the load-more controls", async () => {
  const rows = Array.from({ length: 65 }, (_, index) => annotationFixture({ id: `synthetic-${index}`, body: `Synthetic authorized item ${index + 1}`, visibility: "public", organizationId: null, shareToPlaza: true }));
  vi.mocked(communityApi.plazaPage)
    .mockResolvedValueOnce({ annotations: rows.slice(0, 30), nextCursor: "second" })
    .mockResolvedValueOnce({ annotations: rows.slice(30, 60), nextCursor: "third" })
    .mockResolvedValueOnce({ annotations: rows.slice(60), nextCursor: null });
  render(<Plaza filters={{ sort: "latest" }} actorKey="reader" refresh={0} session={null} onCompose={vi.fn()} onConversation={vi.fn()} onFilters={vi.fn()} />);
  expect(await screen.findByText("Synthetic authorized item 30")).toBeInTheDocument();
  expect(screen.queryByText("Synthetic authorized item 31")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "加载更多批注" }));
  expect(await screen.findByText("Synthetic authorized item 60")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "加载更多批注" }));
  expect(await screen.findByText("已显示全部 65 条批注")).toBeInTheDocument();
  expect(screen.getAllByText(/^Synthetic authorized item /)).toHaveLength(65);
  expect(screen.queryByRole("button", { name: "加载更多批注" })).not.toBeInTheDocument();
  expect(communityApi.plaza).not.toHaveBeenCalled();
});

test("query changes remove the old results and clearly explain the legacy filtered endpoint", async () => {
  vi.mocked(communityApi.plazaPage).mockResolvedValue({ annotations: [annotationFixture({ body: "OLD_QUERY_RESULT" })], nextCursor: "old" });
  vi.mocked(communityApi.plaza).mockResolvedValue({ annotations: [], filters: { query: "fresh" } });
  const props = { actorKey: "reader", refresh: 0, session: null, onCompose: vi.fn(), onConversation: vi.fn(), onFilters: vi.fn() };
  const view = render(<Plaza {...props} filters={{ sort: "latest" }} />);
  expect(await screen.findByText("OLD_QUERY_RESULT")).toBeInTheDocument();
  view.rerender(<Plaza {...props} filters={{ sort: "latest", query: "fresh" }} />);
  expect(screen.queryByText("OLD_QUERY_RESULT")).not.toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("筛选条件已完整保留");
  await waitFor(() => expect(screen.getByText("没有符合条件的公开批注")).toBeInTheDocument());
  expect(communityApi.plaza).toHaveBeenCalledWith({ sort: "latest", query: "fresh" }, expect.any(AbortSignal));
});

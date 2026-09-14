import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { useHelpController } from "../app/controllers/useHelpController";
import { HelpPanel } from "../app/features/help/HelpPanel";
import { createHelpCatalog } from "../app/features/help/helpCatalog";
import { builtinHelpProviders } from "../app/features/help/builtinHelpProvider";
import type { HelpContentProvider } from "../app/features/help/help.types";

function provider(id = "test-guide"): HelpContentProvider {
  return {
    id,
    title: "测试帮助提供方",
    async listTopics() {
      return [{ id: "start", title: "测试目录" }];
    },
    async search({ query }) {
      return query === "无结果"
        ? []
        : [{ id: "intro", topicId: "start", title: `${id} 使用说明` }];
    },
    async read(articleId) {
      return articleId === "intro"
        ? {
            id: "intro",
            topicId: "start",
            title: `${id} 使用说明`,
            body: "测试提供方的 **Markdown 内容**。",
            format: "markdown",
          }
        : null;
    },
  };
}

test("help providers namespace identities and do not require built-in manual content", async () => {
  const request = { locale: "zh-CN", signal: new AbortController().signal };
  const catalog = createHelpCatalog([provider("a"), provider("b")]);
  expect(
    (await catalog.search({ ...request, query: "" })).map(
      (article) => article.ref,
    ),
  ).toEqual([
    { providerId: "a", articleId: "intro" },
    { providerId: "b", articleId: "intro" },
  ]);
  expect(
    (await catalog.read({ providerId: "b", articleId: "intro" }, request))
      ?.title,
  ).toBe("b 使用说明");
  expect(() => createHelpCatalog([provider("a"), provider("a")])).toThrow(
    /唯一/,
  );
  expect(
    await createHelpCatalog(builtinHelpProviders).search({
      ...request,
      query: "",
    }),
  ).toEqual([]);
});

test("help UI searches, opens provider content and handles missing articles and retry", async () => {
  const user = userEvent.setup();
  const source = provider();
  const search = vi.spyOn(source, "search");
  const sources = [source];
  function Fixture() {
    const { model } = useHelpController({
      providers: sources,
      onOpen: vi.fn(),
      visible: true,
    });
    return <HelpPanel model={model} />;
  }
  render(<Fixture />);
  await user.click(
    await screen.findByRole("button", { name: "test-guide 使用说明" }),
  );
  expect(await screen.findByText("Markdown 内容")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "帮助首页" }));
  await user.type(screen.getByRole("textbox", { name: "搜索帮助" }), "无结果");
  expect(await screen.findByText("没有匹配的帮助条目。")).toBeInTheDocument();
  search.mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "刷新帮助" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "帮助内容加载失败",
  );
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("没有匹配的帮助条目。")).toBeInTheDocument();
});

test("context entry and F1 reveal help; stale provider reads cannot replace the new article", async () => {
  const source = provider();
  const sources = [source];
  const onOpen = vi.fn();
  let release: (
    value: Awaited<ReturnType<HelpContentProvider["read"]>>,
  ) => void;
  const slow = new Promise<Awaited<ReturnType<HelpContentProvider["read"]>>>(
    (resolve) => {
      release = resolve;
    },
  );
  const originalRead = source.read;
  vi.spyOn(source, "read").mockImplementation((id, request) =>
    id === "slow" ? slow : originalRead(id, request),
  );
  const { result, unmount } = renderHook(() =>
    useHelpController({ providers: sources, onOpen, visible: true }),
  );
  act(() =>
    result.current.port.open({ providerId: source.id, articleId: "slow" }),
  );
  expect(onOpen).toHaveBeenCalledOnce();
  act(() =>
    result.current.port.open({ providerId: source.id, articleId: "intro" }),
  );
  await waitFor(() =>
    expect(result.current.model.article?.title).toBe("test-guide 使用说明"),
  );
  await act(async () => {
    release!({
      id: "slow",
      topicId: "start",
      title: "过期条目",
      body: "old",
      format: "markdown",
    });
  });
  expect(result.current.model.article?.title).toBe("test-guide 使用说明");
  act(() =>
    result.current.port.open({ providerId: source.id, articleId: "missing" }),
  );
  await waitFor(() => expect(result.current.model.article).toBeNull());
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F1", cancelable: true }),
    ),
  );
  expect(onOpen).toHaveBeenCalledTimes(4);
  unmount();
});

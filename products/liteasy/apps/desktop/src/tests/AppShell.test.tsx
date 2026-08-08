import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";

const localLibrarySnapshot = {
  entries: [
    {
      contentHash: "a".repeat(64),
      id: "local-paper-1",
      path: "/test-library/Research/Paper.pdf",
      relativePath: "Research/Paper.pdf",
      title: "Paper"
    },
    {
      contentHash: null,
      id: "metadata-paper-1",
      path: null,
      relativePath: null,
      title: "Metadata Paper"
    }
  ],
  folders: [{ name: "Research", parentPath: null, path: "/test-library/Research" }],
  libraryId: "test-local-library",
  revision: 7,
  rootPath: "/test-library",
  trashEntries: []
};

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function enterLocalWorkbench(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await screen.findByRole("region", { name: "本地文献库" });
}

test("starts behind the real account boundary and keeps the local workbench available", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => localLibrarySnapshot}
    />
  );

  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();
  await enterLocalWorkbench(user);

  expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "个人中心" })).toBeEnabled();
});

test("composes the four independent resource regions in their designed order", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => localLibrarySnapshot}
    />
  );
  await enterLocalWorkbench(user);

  const resourceRegionNames = screen.getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"))
    .filter((name) => ["本地文献库", "收藏", "关联推荐", "组织文献库"].includes(name ?? ""));
  expect(resourceRegionNames).toEqual([
    "本地文献库",
    "收藏",
    "关联推荐",
    "组织文献库"
  ]);
});

test("opens the independent artifact library without replacing the center artifact surface", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => localLibrarySnapshot}
    />
  );
  await enterLocalWorkbench(user);

  await user.click(screen.getByRole("button", { name: "产物库" }));

  expect(screen.getByRole("region", { name: "产物库" })).toBeInTheDocument();
  expect(screen.getByText("登录后查看账号中保存的产物")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "已导出" }));
  expect(screen.getByText("暂无导出记录")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "多模态产物区域" })).not.toBeInTheDocument();
});

test("hydrates the resource tree only from the disk snapshot", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => localLibrarySnapshot}
    />
  );
  await enterLocalWorkbench(user);

  const library = screen.getByRole("region", { name: "本地文献库" });
  await user.click(within(library).getByRole("button", { name: "展开Research" }));
  expect(within(library).getByRole("button", { name: "Paper" })).toBeEnabled();
  expect(screen.queryByText("Survey of Vector Database Management Systems")).not.toBeInTheDocument();
  expect(screen.queryByText("ColBERT: Efficient and Effective Passage Search")).not.toBeInTheDocument();
});

test("opens login from a locked cloud region without replacing the local tree", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => localLibrarySnapshot}
    />
  );
  await enterLocalWorkbench(user);

  const collection = screen.getByRole("region", { name: "收藏" });
  await user.click(within(collection).getByRole("button", { name: "登录" }));

  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "本地文献库" })).toBeInTheDocument();
  });
});

test("renders an empty library without injecting sample documents", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => ({
        ...localLibrarySnapshot,
        entries: [],
        folders: [],
        revision: 8
      })}
    />
  );
  await enterLocalWorkbench(user);

  const library = screen.getByRole("region", { name: "本地文献库" });
  expect(within(library).getByText("本地文献库为空")).toBeInTheDocument();
  expect(within(library).queryAllByRole("button", { name: /\.pdf$/i })).toHaveLength(0);
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test } from "vitest";
import { AppShell } from "../app/layout/AppShell";

afterEach(() => {
  window.localStorage.clear();
});

test("opens local PDFs as independent tabs while the selected set remains locked", async () => {
  const user = userEvent.setup();
  const firstTitle = "Local Retrieval Paper";
  const secondTitle = "Local Storage Paper";

  render(
    <AppShell
      initialPapers={[]}
      localLibraryLoader={async () => ({
        entries: [
          {
            contentHash: "a".repeat(64),
            id: "local-paper-1",
            path: "/library/Research/Retrieval.pdf",
            relativePath: "Research/Retrieval.pdf",
            title: firstTitle
          },
          {
            contentHash: "b".repeat(64),
            id: "local-paper-2",
            path: "/library/Research/Storage.pdf",
            relativePath: "Research/Storage.pdf",
            title: secondTitle
          }
        ],
        folders: [{ name: "Research", parentPath: null, path: "/library/Research" }],
        libraryId: "library-integration",
        revision: 1,
        rootPath: "/library",
        trashEntries: []
      })}
    />
  );

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  const library = await screen.findByRole("region", { name: "本地文献库" });
  await user.click(within(library).getByRole("button", { name: "展开Research" }));
  await user.click(within(library).getByRole("checkbox", { name: `选择 ${firstTitle}` }));
  await user.click(within(library).getByRole("checkbox", { name: `选择 ${secondTitle}` }));
  await user.click(screen.getByRole("button", { name: "锁定选中文献集" }));

  await user.click(within(library).getByRole("button", { name: secondTitle }));
  await user.click(within(library).getByRole("button", { name: firstTitle }));

  expect(screen.getByRole("tab", { name: firstTitle })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: secondTitle })).toBeInTheDocument();
  expect(within(library).getByRole("checkbox", { name: `选择 ${firstTitle}` })).toBeDisabled();
  expect(within(library).getByRole("checkbox", { name: `选择 ${secondTitle}` })).toBeDisabled();
});

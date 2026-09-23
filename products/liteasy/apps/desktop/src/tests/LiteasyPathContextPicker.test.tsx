import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { LiteasyPathContextPicker } from "../app/features/resource-filesystem/LiteasyPathContextPicker";
import type { ResourcePathCandidate } from "../app/features/resource-filesystem/resourcePathSearch";

const note = { title: "方法笔记", kind: "笔记", path: "liteasy://objects/note?scope=user%3AA" };

test("shows candidates on open and search, and adds a selected path with the keyboard", async () => {
  const user = userEvent.setup();
  const search = vi.fn(async () => [note]);
  const add = vi.fn(async () => true);
  render(<LiteasyPathContextPicker scopeId="user:A" search={search} onAdd={add} busy={false} />);
  await user.click(screen.getByText("通过 Liteasy Path 添加上下文"));
  expect(await screen.findByRole("option")).toHaveTextContent("方法笔记");
  const input = screen.getByRole("combobox", { name: "添加上下文的 Liteasy Path" });
  await user.type(input, "方法");
  await waitFor(() => expect(search).toHaveBeenLastCalledWith("方法"));
  await screen.findByRole("option");
  await user.keyboard("{Enter}");
  expect(add).toHaveBeenCalledWith(note.path);
  await waitFor(() => expect(input).toHaveValue(""));
});

test("discards stale search results and results from a previous account", async () => {
  let finishOld!: (items: ResourcePathCandidate[]) => void;
  const search = vi.fn((query: string) => query === "old" ? new Promise<ResourcePathCandidate[]>((resolve) => { finishOld = resolve; }) : Promise.resolve([note]));
  const props = { search, onAdd: vi.fn(async () => true), busy: false };
  const { rerender } = render(<LiteasyPathContextPicker {...props} scopeId="user:A" />);
  await userEvent.click(screen.getByText("通过 Liteasy Path 添加上下文"));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "old" } });
  await waitFor(() => expect(finishOld).toBeDefined());
  fireEvent.change(input, { target: { value: "new" } });
  expect(await screen.findByRole("option")).toHaveTextContent("方法笔记");
  await act(async () => finishOld([{ ...note, title: "过期结果" }]));
  expect(screen.queryByText("过期结果")).not.toBeInTheDocument();
  rerender(<LiteasyPathContextPicker {...props} search={async () => []} scopeId="user:B" />);
  expect(input).toHaveValue("");
  await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
});

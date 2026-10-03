import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalDraftControls } from "./LocalDraftControls";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test("saved drafts survive remount but restore only on request and never cross owners", async () => {
  const user = userEvent.setup(); const restored = vi.fn();
  const first = render(<LocalDraftControls owner="actor-a" scope="private:draft" value={{ body: "A_PRIVATE" }} onRestore={restored} />);
  await user.click(screen.getByRole("button", { name: "保存本机草稿" }));
  expect(screen.getByRole("status")).toHaveTextContent("草稿已保存");
  first.unmount();
  const next = render(<LocalDraftControls owner="actor-a" scope="private:draft" value={{ body: "" }} onRestore={restored} />);
  expect(restored).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "恢复本机草稿" }));
  expect(restored).toHaveBeenCalledWith({ body: "A_PRIVATE" });
  next.rerender(<LocalDraftControls owner="actor-b" scope="private:draft" value={{ body: "" }} onRestore={restored} />);
  expect(screen.queryByRole("button", { name: "恢复本机草稿" })).not.toBeInTheDocument();
  expect(screen.queryByText("A_PRIVATE")).not.toBeInTheDocument();
});

test("quota failures and subsequent unsaved edits do not display a saved claim", async () => {
  const user = userEvent.setup();
  const view = render(<LocalDraftControls owner="actor-a" scope="draft" value="first" onRestore={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "保存本机草稿" }));
  view.rerender(<LocalDraftControls owner="actor-a" scope="draft" value="second" onRestore={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("当前修改尚未保存");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await user.click(screen.getByRole("button", { name: "保存本机草稿" }));
  expect(screen.getByRole("status")).toHaveTextContent("草稿尚未保存");
  expect(screen.queryByText(/草稿已保存/)).not.toBeInTheDocument();
});

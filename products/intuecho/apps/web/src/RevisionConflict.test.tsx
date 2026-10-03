import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RevisionConflict } from "./RevisionConflict";
afterEach(cleanup);
test("current revision is read explicitly and never replaces the draft or advances its base silently", async () => {
  const user = userEvent.setup(); const useRevision = vi.fn(); const read = vi.fn(async () => ({ body: "Current v5 body", revision: 5 }));
  render(<RevisionConflict baseRevision={4} loadCurrent={read} onUseRevision={useRevision} />);
  expect(read).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "核对最新版本（保留我的草稿）" }));
  expect(await screen.findByText("服务器当前修订 5")).toBeInTheDocument();
  expect(screen.getByText("Current v5 body")).toBeInTheDocument();
  expect(useRevision).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "以当前修订继续编辑我的草稿" }));
  expect(useRevision).toHaveBeenCalledWith(5);
});

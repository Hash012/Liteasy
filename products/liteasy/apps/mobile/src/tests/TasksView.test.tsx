import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TasksView, type TaskControls } from "../app/features/tasks/TasksView";
import type { LibraryItem } from "../app/features/library/library.types";

test("remote commands require a supported desktop and carry the selected local PDF version", () => {
  const item: LibraryItem = { id: "paper-1", kind: "pdf", contentHash: "a".repeat(64), title: "量子研究", filename: "paper.pdf", mimeType: "application/pdf", size: 1,
    collection: "", tags: [], note: "", createdAt: "now", updatedAt: "now", page: 1, pinned: false, downloaded: true, revision: 1 };
  const controls: TaskControls = { available: true, busy: false, error: "", pair: vi.fn(), unpair: vi.fn(), cancel: vi.fn(), retry: vi.fn(), enqueue: vi.fn(),
    snapshot: { devices: [{ deviceId: "desktop", name: "办公室", online: false, lastSeen: 0, capabilities: ["open-document"] }], pairs: [], outbox: [], tasks: [] } };
  render(<TasksView controls={controls} items={[item]} />);
  expect(screen.getByRole("button", { name: "发送任务" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("目标桌面"), { target: { value: "desktop" } });
  expect(screen.getByRole("option", { name: "生成文献摘要" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("文献"), { target: { value: item.id } });
  fireEvent.click(screen.getByRole("button", { name: "发送任务" }));
  expect(controls.enqueue).toHaveBeenCalledWith("desktop", "open-document", item);
});

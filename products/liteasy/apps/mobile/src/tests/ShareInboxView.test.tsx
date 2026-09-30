import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShareInboxView } from "../app/features/capture/ShareInboxView";
import type { SharedCapture } from "../app/features/capture/shareInbox";

const capture: SharedCapture = { id: "capture-1", title: "paper.pdf", filename: "paper.pdf", state: "ready", collection: "收件箱", note: "", receivedAt: "2026-09-30T00:00:00Z", size: 100 };

describe("shared capture review", () => {
  it("sends edited metadata and retains the review when durable import fails", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ShareInboxView captures={[capture]} busy={false} error="" onSave={save} onDiscard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "阅读材料" } });
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "项目 A" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "周末阅读" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到资料库" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("capture-1", { title: "阅读材料", collection: "项目 A", note: "周末阅读" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存到资料库" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers archival only for fully captured content", () => {
    render(<ShareInboxView captures={[{ ...capture, state: "capturing" }]} busy={false} error="" onSave={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText("正在接收附件…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "归档" })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ProfileRecoveryPanel } from "../app/features/local-recovery/ProfileRecoveryPanel";
import { createLocalRecoveryService } from "../app/features/local-recovery/localRecoveryService";

test("recovery preview requires confirmation and only its completed receipt can launch a profile", async () => {
  const preview = { planId: "plan", targetPath: "/new/profile", restored: true, scopeId: "user:archived", fileCount: 8, totalBytes: 1024, exclusions: ["凭据"] };
  const api = { prepare: vi.fn().mockResolvedValue(preview), cancel: vi.fn(), commit: vi.fn().mockResolvedValue({ receiptId: "receipt", path: "/new/profile", restored: true, scopeId: "user:archived" }), openProfile: vi.fn().mockResolvedValue(undefined) };
  render(<ProfileRecoveryPanel scopeId="local" service={api} />);
  fireEvent.click(screen.getByRole("button", { name: "校验并恢复隔离配置" }));
  await screen.findByLabelText("隔离恢复预览"); expect(api.commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认创建新配置副本" }));
  await screen.findByLabelText("隔离恢复回执"); expect(api.commit).toHaveBeenCalledWith("plan");
  expect(api.openProfile).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "打开隔离恢复配置" }));
  await waitFor(() => expect(api.openProfile).toHaveBeenCalledWith("receipt"));
});
test("late preview cancels its old scope and cannot expose another partition", async () => {
  let scope = "old"; let finish!: (value: unknown) => void;
  const transport = vi.fn((command: string) => command.includes("prepare") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(undefined));
  const api = createLocalRecoveryService("old", () => scope, transport);
  const pending = api.prepare("backup"); scope = "new"; finish({ planId: "old-plan" });
  await expect(pending).rejects.toThrow("账户已切换");
  expect(transport).toHaveBeenCalledWith("local_recovery_cancel", { scope: "old", planId: "old-plan" });
});

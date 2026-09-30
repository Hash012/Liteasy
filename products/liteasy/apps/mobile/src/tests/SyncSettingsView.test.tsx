import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncSettingsView } from "../app/features/sync/SyncSettingsView";
import { syncClient } from "../app/features/sync/syncClient";

vi.mock("../app/features/sync/syncClient", () => ({ syncClient: {
  available: () => true,
  settings: vi.fn().mockResolvedValue({ endpoint: "https://example.org/dav/", username: "reader", collection: "library", hasPassword: true, autoSync: false, wifiOnly: true }),
  configure: vi.fn().mockResolvedValue(undefined), status: vi.fn().mockResolvedValue(null), start: vi.fn().mockResolvedValue(undefined), cancel: vi.fn(), resolve: vi.fn()
} }));

describe("file sync settings", () => {
  it("sends scoped settings, clears entered passwords and starts only after saving", async () => {
    render(<SyncSettingsView scope="account-1" onChanged={vi.fn().mockResolvedValue(undefined)} />);
    const password = await screen.findByLabelText("密码（留空保留已保存的密码）");
    fireEvent.change(password, { target: { value: "entered-password" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "自动同步" }));
    expect(screen.getByRole("button", { name: "立即同步" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存同步设置" }));
    await waitFor(() => expect(syncClient.configure).toHaveBeenCalledWith("account-1", expect.objectContaining({ password: "entered-password", autoSync: true, wifiOnly: true })));
    await waitFor(() => expect(password).toHaveValue(""));
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() => expect(syncClient.start).toHaveBeenCalledWith("account-1"));
  });
});

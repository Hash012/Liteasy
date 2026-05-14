import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsPane } from "../app/layout/SettingsPane";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("SettingsPane", () => {
  test("renders model and metadata settings in the left settings pane", async () => {
    const user = userEvent.setup();
    const onSetAccessMode = vi.fn();
    const onSyncCloudPolicy = vi.fn();
    const onToggleLocalDirectEnabled = vi.fn();
    const settings = createSeededSettingsStore().getState();

    render(
      <SettingsPane
        documentMetadataSyncMessage="等待云端账号连接后同步。"
        documentMetadataSyncStatus="idle"
        latestExecutionLabel="云代理 · openai"
        onSetAccessMode={onSetAccessMode}
        onSyncCloudPolicy={onSyncCloudPolicy}
        onToggleLocalDirectEnabled={onToggleLocalDirectEnabled}
        policySyncMessage="管理员未开放时，桌面端只能通过云端代理通道调用模型。"
        policySyncPending={false}
        policySyncStatus="idle"
        settings={settings}
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    expect(within(pane).getByText("设置")).toBeInTheDocument();
    expect(within(pane).getByText(/模型：云代理/)).toBeInTheDocument();
    expect(within(pane).getByText("模型接入策略")).toBeInTheDocument();
    expect(within(pane).getByText("文献元数据同步")).toBeInTheDocument();

    await user.click(within(pane).getByRole("button", { name: "同步云端策略" }));
    expect(onSyncCloudPolicy).toHaveBeenCalledTimes(1);
  });
});

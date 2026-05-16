import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsPane } from "../app/layout/SettingsPane";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";

describe("SettingsPane", () => {
  test("renders user-facing model controls and metadata sync without developer endpoint diagnostics", async () => {
    const user = userEvent.setup();
    const onRetryDocumentMetadataSync = vi.fn();
    const onSetAccessMode = vi.fn();
    const onSyncCloudPolicy = vi.fn();
    const onToggleLocalDirectEnabled = vi.fn();
    const settings = createSeededSettingsStore().getState();

    render(
      <SettingsPane
        documentMetadataSyncMessage="等待云端账号连接后同步。"
        documentMetadataSyncStatus="idle"
        latestExecutionLabel="云代理 -> 云端服务 -> OpenAI"
        onSetAccessMode={onSetAccessMode}
        onRetryDocumentMetadataSync={onRetryDocumentMetadataSync}
        onSyncCloudPolicy={onSyncCloudPolicy}
        onToggleLocalDirectEnabled={onToggleLocalDirectEnabled}
        policySyncMessage="已从云端同步模型策略，当前以云端管理员下发配置为准。"
        policySyncStatus="success"
        policyVersion="mock-policy-v1"
        settings={settings}
        syncedAt="2026-05-14T09:30:00Z"
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    expect(within(pane).getByText("设置")).toBeInTheDocument();
    expect(within(pane).queryByText("模型接入策略")).not.toBeInTheDocument();
    expect(within(pane).getByText("云端模型能力")).toBeInTheDocument();
    expect(within(pane).getByText("当前通道：云代理 · Provider：openai")).toBeInTheDocument();
    expect(within(pane).getByText("同步状态：已同步")).toBeInTheDocument();
    expect(within(pane).getByText("策略版本：mock-policy-v1")).toBeInTheDocument();
    expect(within(pane).getByText("最近同步：2026-05-14T09:30:00Z")).toBeInTheDocument();
    expect(within(pane).getByText("最近执行：云代理 -> 云端服务 -> OpenAI")).toBeInTheDocument();
    expect(within(pane).getByText("文献元数据同步")).toBeInTheDocument();
    expect(within(pane).queryByText("开发云端点诊断")).not.toBeInTheDocument();
    expect(within(pane).queryByText("云代理端点：mock://cloud-proxy")).not.toBeInTheDocument();
    expect(within(pane).queryByText("控制平面端点：mock://control-plane")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("button", { name: "使用本地开发云端点" })).not.toBeInTheDocument();

    await user.click(within(pane).getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" }));
    expect(onToggleLocalDirectEnabled).toHaveBeenCalledWith(true);

    await user.click(within(pane).getByRole("button", { name: "使用云代理" }));
    expect(onSetAccessMode).toHaveBeenCalledWith("cloud_proxy");

    await user.click(within(pane).getByRole("button", { name: "同步云端策略" }));
    expect(onSyncCloudPolicy).toHaveBeenCalledTimes(1);

    await user.click(within(pane).getByRole("button", { name: "重新同步文献元数据" }));
    expect(onRetryDocumentMetadataSync).toHaveBeenCalledTimes(1);
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsPane } from "../app/layout/SettingsPane";

describe("SettingsPane", () => {
  test("renders only user-facing cloud capability copy and metadata sync without policy controls", async () => {
    const user = userEvent.setup();
    const onRetryDocumentMetadataSync = vi.fn();

    render(
      <SettingsPane
        documentMetadataSyncMessage="等待云端账号连接后同步。"
        documentMetadataSyncResult={null}
        documentMetadataSyncStatus="idle"
        onRetryDocumentMetadataSync={onRetryDocumentMetadataSync}
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    expect(within(pane).getByText("设置")).toBeInTheDocument();
    expect(within(pane).queryByText("模型接入策略")).not.toBeInTheDocument();
    expect(within(pane).getByText("云端模型能力")).toBeInTheDocument();
    expect(
      within(pane).getByText("Liteasy 面向普通用户统一通过云端模型能力提供问答、解释和产物生成服务。")
    ).toBeInTheDocument();
    expect(within(pane).getByText("Agent 核心")).toBeInTheDocument();
    expect(within(pane).getByText("运行中")).toBeInTheDocument();
    expect(within(pane).getAllByText("agent.md")).toHaveLength(2);
    expect(within(pane).getByText("Skill 条目")).toBeInTheDocument();
    expect(within(pane).getByText("Plugin 条目")).toBeInTheDocument();
    expect(within(pane).getByText("MCP 条目")).toBeInTheDocument();
    expect(within(pane).getByText("Memory 条目")).toBeInTheDocument();
    expect(within(pane).getByLabelText("Agent 循环预算")).toHaveTextContent("12");
    expect(within(pane).getByText("高风险动作需要确认")).toBeInTheDocument();
    expect(within(pane).getByText("记忆写入前扫描注入")).toBeInTheDocument();
    expect(within(pane).getByText("文献元数据同步")).toBeInTheDocument();
    expect(within(pane).queryByText("开发云端点诊断")).not.toBeInTheDocument();
    expect(within(pane).queryByText("云代理端点：mock://cloud-proxy")).not.toBeInTheDocument();
    expect(within(pane).queryByText("控制平面端点：mock://control-plane")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("button", { name: "使用本地开发云端点" })).not.toBeInTheDocument();

    await user.click(within(pane).getByRole("button", { name: "重新同步文献元数据" }));
    expect(onRetryDocumentMetadataSync).toHaveBeenCalledTimes(1);
  });
});

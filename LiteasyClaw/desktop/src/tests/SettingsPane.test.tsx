import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsPane } from "../app/layout/SettingsPane";

describe("SettingsPane", () => {
  test("lets users toggle public workflow audit visibility from Agent settings", async () => {
    const user = userEvent.setup();
    const onUpdateSetting = vi.fn();

    render(
      <SettingsPane
        documentMetadataSyncResult={null}
        documentMetadataSyncStatus="idle"
        onUpdateSetting={onUpdateSetting}
        settings={{
          "assistant.public_audit.enabled": false
        }}
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    await user.click(within(pane).getByRole("button", { name: "展开 Agent 设置" }));
    const toggle = within(pane).getByRole("checkbox", { name: "显示公开审计过程" });

    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(onUpdateSetting).toHaveBeenCalledWith({
      intent: "update_setting",
      target: "assistant.public_audit.enabled",
      value: true
    });
  });

  test("does not ask desktop users for deployment secrets or PDF upload consent", async () => {
    const user = userEvent.setup();

    render(
      <SettingsPane
        documentMetadataSyncResult={null}
        documentMetadataSyncStatus="idle"
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    await user.click(within(pane).getByRole("button", { name: "展开 Agent 设置" }));
    expect(within(pane).queryByLabelText("OpenAlex API 密钥")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("checkbox", {
      name: "允许上传 PDF 用于结构解析"
    })).not.toBeInTheDocument();
  });

  test("renders a collapsible, user-facing metadata sync section", async () => {
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
    expect(within(pane).getByRole("button", { name: "收起文献同步" })).toBeInTheDocument();
    expect(within(pane).getByLabelText("文献元数据同步")).toBeInTheDocument();
    expect(within(pane).queryByText("Skill 条目")).not.toBeInTheDocument();
    expect(within(pane).queryByText("开发云端点诊断")).not.toBeInTheDocument();
    expect(within(pane).queryByText("云代理端点：mock://cloud-proxy")).not.toBeInTheDocument();
    expect(within(pane).queryByText("控制平面端点：mock://control-plane")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("button", { name: "使用本地开发云端点" })).not.toBeInTheDocument();

    await user.click(within(pane).getByRole("button", { name: "重新同步文献元数据" }));
    expect(onRetryDocumentMetadataSync).toHaveBeenCalledTimes(1);

    await user.click(within(pane).getByRole("button", { name: "收起文献同步" }));
    expect(within(pane).getByRole("button", { name: "展开文献同步" })).toBeInTheDocument();
    expect(within(pane).queryByLabelText("文献元数据同步")).not.toBeInTheDocument();
  });

  test("updates View font and PDF eye-care background settings", async () => {
    const user = userEvent.setup();
    const onUpdateSetting = vi.fn();

    const { rerender } = render(
      <SettingsPane
        documentMetadataSyncResult={null}
        documentMetadataSyncStatus="idle"
        onUpdateSetting={onUpdateSetting}
        settings={{
          "view.font_family": '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
          "view.font_size": "14",
          "view.pdf_background": "paper",
          "view.pdf_custom_background": "#ffffff"
        }}
      />
    );

    const pane = screen.getByLabelText("左边栏设置");
    expect(within(pane).getByRole("button", { name: "收起 View 设置" })).toBeInTheDocument();

    await user.click(within(pane).getByText("暖黄护眼"));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting",
      target: "view.pdf_background",
      value: "warm"
    });

    await user.click(within(pane).getByText("自定义"));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting",
      target: "view.pdf_background",
      value: "custom"
    });

    rerender(
      <SettingsPane
        documentMetadataSyncResult={null}
        documentMetadataSyncStatus="idle"
        onUpdateSetting={onUpdateSetting}
        settings={{
          "view.font_family": '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
          "view.font_size": "14",
          "view.pdf_background": "custom",
          "view.pdf_custom_background": "#ffffff"
        }}
      />
    );

    fireEvent.change(within(pane).getByLabelText("自定义 PDF 底色"), {
      target: { value: "#eaf6e8" }
    });
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting",
      target: "view.pdf_custom_background",
      value: "#eaf6e8"
    });
  });
});

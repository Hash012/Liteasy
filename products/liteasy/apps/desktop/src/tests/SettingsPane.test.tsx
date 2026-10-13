import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsPane } from "../app/layout/SettingsPane";

describe("SettingsPane", () => {
  test("offers light, dark and system appearance in display settings", async () => {
    const user = userEvent.setup();
    const onUpdateSetting = vi.fn();
    render(<SettingsPane documentMetadataSyncResult={null} documentMetadataSyncStatus="idle" settings={{ "view.theme": "system" }} onUpdateSetting={onUpdateSetting} />);
    const appearance = screen.getByRole("combobox", { name: "外观" });
    expect(appearance).toHaveTextContent("跟随系统");
    await user.click(appearance);
    await user.click(screen.getByRole("option", { name: "深色" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "view.theme", value: "dark" });
    await user.click(appearance);
    await user.click(screen.getByRole("option", { name: "浅色" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "view.theme", value: "light" });
  });

  test("lets researchers choose a recommendation style and control online recommendations", async () => {
    const user = userEvent.setup();
    const onUpdateSetting = vi.fn();
    render(<SettingsPane
      documentMetadataSyncResult={null}
      documentMetadataSyncStatus="idle"
      onUpdateSetting={onUpdateSetting}
      settings={{ "network.recommendation.style": "classic", "network.recommendation.enabled": true }}
    />);
    await user.click(screen.getByRole("button", { name: "论文与推荐", exact: true }));
    const panel = within(screen.getByRole("region", { name: "论文推荐设置" }));
    expect(panel.getByRole("combobox", { name: "推荐风格" })).toHaveTextContent("经典基础");
    expect(panel.getByText("侧重与研究主题相关、积累引用的基础文献。")).toBeInTheDocument();
    await user.click(panel.getByRole("combobox", { name: "推荐风格" }));
    await user.click(screen.getByRole("option", { name: /前沿/ }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting", target: "network.recommendation.style", value: "frontier"
    });
    await user.click(panel.getByRole("switch", { name: "联网推荐" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting", target: "network.recommendation.enabled", value: false
    });
  });

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

    const pane = screen.getByLabelText("应用设置");
    await user.click(within(pane).getByRole("button", { name: "AI 与助手" }));
    const toggle = within(pane).getByRole("switch", { name: "显示公开审计过程" });

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

    const pane = screen.getByLabelText("应用设置");
    await user.click(within(pane).getByRole("button", { name: "AI 与助手" }));
    expect(within(pane).queryByLabelText("OpenAlex API 密钥")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("checkbox", {
      name: "允许上传 PDF 用于结构解析"
    })).not.toBeInTheDocument();
  });

  test("groups sync controls separately from appearance settings", async () => {
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

    const pane = screen.getByLabelText("应用设置");
    await user.click(within(pane).getByRole("button", { name: "同步与备份" }));
    expect(within(pane).getByLabelText("文献元数据同步")).toBeInTheDocument();
    expect(within(pane).queryByText("Skill 条目")).not.toBeInTheDocument();
    expect(within(pane).queryByText("开发云端点诊断")).not.toBeInTheDocument();
    expect(within(pane).queryByText("云代理端点：mock://cloud-proxy")).not.toBeInTheDocument();
    expect(within(pane).queryByText("控制平面端点：mock://control-plane")).not.toBeInTheDocument();
    expect(within(pane).queryByRole("button", { name: "使用本地开发云端点" })).not.toBeInTheDocument();

    await user.click(within(pane).getByRole("button", { name: "重新同步文献元数据" }));
    expect(onRetryDocumentMetadataSync).toHaveBeenCalledTimes(1);

    await user.click(within(pane).getByRole("button", { name: "外观与阅读" }));
    expect(within(pane).getByLabelText("文献元数据同步")).not.toBeVisible();
    expect(within(pane).getByRole("combobox", { name: "外观" })).toBeVisible();
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

    const pane = screen.getByLabelText("应用设置");
    await user.click(within(pane).getByRole("button", { name: "外观与阅读" }));

    for (const [label, key] of [["界面中文字体", "view.font_family_zh"], ["界面英文字体", "view.font_family_en"], ["阅读中文字体", "view.reader_font_family_zh"]]) {
      const picker = within(pane).getByRole("combobox", { name: label });
      await user.clear(picker);
      await user.type(picker, "Custom Font");
      await user.click(screen.getByRole("option", { name: "使用字体：Custom Font" }));
      expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: key, value: '"Custom Font", sans-serif' });
    }
    expect(within(pane).getByLabelText("界面字体预览")).toBeInTheDocument();
    expect(within(pane).getByLabelText("阅读字体预览")).toBeInTheDocument();

    const readerFont = within(pane).getByRole("combobox", { name: "阅读英文字体" });
    await user.clear(readerFont);
    await user.type(readerFont, "Research Serif");
    await user.click(screen.getByRole("option", { name: "使用字体：Research Serif" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting", target: "view.reader_font_family_en", value: '"Research Serif", sans-serif'
    });

    await user.click(within(pane).getByRole("combobox", { name: "显示比例" }));
    await user.click(screen.getByRole("option", { name: "125%" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting", target: "view.display_scale", value: "125"
    });

    await user.click(within(pane).getByRole("combobox", { name: "界面字号" }));
    await user.click(screen.getByRole("option", { name: "舒适 · 16 px" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({
      intent: "update_setting", target: "view.font_size", value: "16"
    });

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
  test("searches across categories and preserves unsaved API input", async () => {
    const user = userEvent.setup();
    render(<SettingsPane documentMetadataSyncResult={null} documentMetadataSyncStatus="idle" />);
    await user.click(screen.getByRole("button", { name: "AI 与助手" }));
    await user.type(screen.getByLabelText("模型 ID", { exact: true }), "-draft");
    await user.type(within(screen.getByRole("region", { name: "模型与连接" })).getByLabelText("API key", { exact: true }), "temporary-secret");
    const draft = (screen.getByLabelText("模型 ID", { exact: true }) as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: "文件与存储" }));
    expect(screen.queryByRole("combobox", { name: "模型 ID", exact: true })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "PDF OCR");
    expect(screen.getByRole("combobox", { name: "扫描 PDF OCR 语言" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "数据保存位置" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "搜索设置" }));
    await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "temporary-secret");
    expect(screen.getByRole("heading", { name: "没有找到相关设置" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清除设置搜索" }));
    expect(screen.getByRole("button", { name: "文件与存储" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "AI 与助手" }));
    expect(screen.getByLabelText("模型 ID", { exact: true })).toHaveValue(draft);
    expect(within(screen.getByRole("region", { name: "模型与连接" })).getByLabelText("API key", { exact: true })).toHaveValue("temporary-secret");
  });

  test("finds advanced capabilities and moves OCR and annotations into their own categories", async () => {
    const user = userEvent.setup();
    const onUpdateSetting = vi.fn();
    render(<SettingsPane documentMetadataSyncResult={null} documentMetadataSyncStatus="idle" onUpdateSetting={onUpdateSetting} />);
    await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "mcp");
    expect(screen.getByText("工具连接（MCP）")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "论文与推荐" }));
    expect(screen.getByRole("textbox", { name: "搜索设置" })).toHaveValue("");
    await user.click(screen.getByRole("combobox", { name: "扫描 PDF OCR 语言" }));
    await user.click(screen.getByRole("option", { name: "中文（简体）" }));
    expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "import.ocr_language", value: "chi_sim" });
    expect(screen.queryByRole("textbox", { name: "Intuecho 同步端点" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同步与备份" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Intuecho 同步端点" }), { target: { value: "https://sync.example.test" } });
    expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "thin_reading.intuecho_endpoint", value: "https://sync.example.test" });
  });

});


test("lookup connection and secret drafts survive categories, search and security disclosure", async () => {
  const user = userEvent.setup();
  const update = vi.fn();
  render(<SettingsPane documentMetadataSyncResult={null} documentMetadataSyncStatus="idle" onUpdateSetting={update}
    settings={{ "lookup.translation_service": "libretranslate" }} />);
  const address = screen.getByRole("textbox", { name: "LibreTranslate 地址" });
  await user.clear(address); await user.type(address, "https://translate.example.test");
  await user.click(screen.getByRole("button", { name: "配置可选密钥" }));
  await user.type(screen.getByLabelText("翻译服务密钥"), "synthetic-draft-key");
  await user.click(screen.getByRole("button", { name: "配置可选密钥" }));
  await user.click(screen.getByRole("button", { name: "AI 与助手" }));
  await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "LibreTranslate");
  expect(screen.getByLabelText("翻译服务密钥")).toBeVisible();
  expect(screen.getByLabelText("翻译服务密钥")).toHaveValue("synthetic-draft-key");
  expect(screen.getByRole("textbox", { name: "LibreTranslate 地址" })).toHaveValue("https://translate.example.test");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("textbox", { name: "搜索设置" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "外观与阅读" }));
  await user.click(screen.getByRole("button", { name: "配置可选密钥" }));
  expect(screen.getByLabelText("翻译服务密钥")).toHaveValue("synthetic-draft-key");
  await user.click(screen.getByRole("button", { name: "保存翻译连接" }));
  await screen.findByText("翻译服务连接设置已保存。");
  expect(update).toHaveBeenLastCalledWith({ intent: "update_setting", target: "lookup.libretranslate_endpoint", value: "https://translate.example.test" });
  expect(screen.getByLabelText("翻译服务密钥")).toHaveValue("");
  expect(JSON.stringify(update.mock.calls)).not.toContain("synthetic-draft-key");
});

import { useContext, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Button, Switch, Textarea } from "@fluentui/react-components";
import { CopyRegular, PlugConnectedRegular } from "@fluentui/react-icons";
import { LocalMcpContext, localMcpCodexConfig } from "./localMcpContext";

export function LocalMcpSettingsPanel() {
  const model = useContext(LocalMcpContext);
  const [notice, setNotice] = useState("");
  if (!isTauri()) return <p>本机 MCP 在 Liteasy 桌面版中可用，可供 Codex 等本机 AI 客户端读写研究资产。</p>;
  const info = model?.info;
  const config = info ? localMcpCodexConfig(info) : "";
  return <div className="settings-embedded-panel sidebar-section-content">
    <p>让 Codex 直接搜索论文、读取笔记和白板，并将分析结果写回 Liteasy。使用过程中保持本应用打开，无需 Liteasy 云端账号。</p>
    <Switch label="启用本机 MCP" checked={!!info?.enabled} disabled={!model || model.busy}
      onChange={(_, data) => { setNotice(""); model?.configure(data.checked, false); }} />
    <Switch label="允许创建和修改资产" checked={!!info?.writable} disabled={!info?.enabled || model?.busy}
      onChange={(_, data) => { setNotice(""); model?.configure(true, data.checked); }} />
    <p role="status"><PlugConnectedRegular aria-hidden="true" /> {model?.busy ? "正在更新连接…" : info?.enabled ? info.writable ? "已启用 · 可读写" : "已启用 · 只读" : "未启用"}。重启应用或切换账号后需重新启用；更改权限后请在 Codex 中重启 MCP 连接。</p>
    {info ? <>
      <label>Codex 配置<Textarea aria-label="Codex MCP 配置" readOnly resize="vertical" value={config} style={{ width: "100%" }}
        textarea={{ rows: 7, style: { minHeight: 156, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, lineHeight: 1.6 } }} /></label>
      <Button icon={<CopyRegular />} disabled={!info.enabled} onClick={() => void navigator.clipboard.writeText(config)
        .then(() => setNotice("已复制 Codex MCP 配置。"))
        .catch(() => setNotice("复制失败，请选择上方配置手动复制。"))}>复制配置</Button>
      <ol className="settings-policy-list">
        <li>将配置合并到 Windows 用户目录的 <code>.codex/config.toml</code>；已有同名 liteasy 配置时替换该段。</li>
        <li>在 Codex 的 MCP 设置中重启连接，或重启 Codex。</li>
        <li>试试：“在 Liteasy 查找 CicN，读完后将我的分析追加到笔记。”</li>
      </ol>
      <p>只访问当前账号的 Liteasy 资产和已连接文件夹。写入检查内容版本，冲突时需重新读取；论文原文和来源摘录保持只读，可在论文下创建分析笔记或白板。</p>
    </> : null}
    {model?.recent ? <p>最近操作：{model.recent.tool} · {model.recent.failed ? "未完成" : "完成"} · {model.recent.at}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {model?.error ? <p role="alert">{model.error}</p> : null}
  </div>;
}

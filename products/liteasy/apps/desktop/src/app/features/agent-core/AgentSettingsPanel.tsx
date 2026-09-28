import {
  defaultAgentCoreConfig,
  getAgentEntryStatusLabel,
  type AgentCoreCatalogEntry,
  type AgentCoreConfig
} from "./agentCoreConfig";
import { useState } from "react";
import { Button, Field, Select, Switch } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";

type AgentSettingsPanelProps = {
  config?: AgentCoreConfig;
  expandCapabilities?: boolean;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
};

function AgentCatalogList({
  entries,
  onOpenSkillDocument,
  title
}: {
  entries: AgentCoreCatalogEntry[];
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  title: string;
}) {
  return (
    <div className="agent-settings-section">
      <div className="agent-settings-section-title">{title}</div>
      <div className="agent-settings-list">
        {entries.map((entry) => (
          <div className="agent-settings-row" key={entry.id}>
            <div className="agent-settings-row-main">
              <div className="agent-settings-row-title">{entry.label}</div>
              <div className="agent-settings-row-description">{entry.description}</div>
            </div>
            <div className={`agent-settings-badge ${entry.status}`}>
              {getAgentEntryStatusLabel(entry.status)}
            </div>
            {entry.docMarkdown ? (
              <Button
                appearance="subtle" size="small"
                className="agent-settings-doc-button"
                onClick={() => onOpenSkillDocument?.(entry)}
                type="button"
              >
                打开文档
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSettingsPanel({
  config = defaultAgentCoreConfig,
  expandCapabilities = false,
  onOpenSkillDocument,
  onUpdateSetting,
  settings
}: AgentSettingsPanelProps) {
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const contextLimit = settings?.["assistant.context_window"] ?? "32768";
  const contextLimits = [...new Set(["4096", "8192", "16384", "32768", "65536", "131072", "262144", contextLimit])]
    .sort((left, right) => Number(left) - Number(right));
  return <div className="view-settings-panel">
    <Field label="薄读生成语言" hint="用于后续生成；已有回答保持原样。跟随系统时使用浏览器语言。">
      <Select aria-label="薄读生成语言" value={settings?.["assistant.language"] ?? "zh-CN"}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "assistant.language", value: data.value })}>
        <option value="zh-CN">中文</option><option value="en-US">English</option><option value="system">跟随系统</option>
      </Select>
    </Field>
    <Field label="Agent 上下文上限" hint="限制每次请求的上下文容量；请勿超过所用模型支持的容量。长篇资料按需分段读取，输入框会显示估算占用。">
      <Select aria-label="Agent 上下文上限" value={contextLimit}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "assistant.context_window", value: data.value })}>
        {contextLimits.map((value) => <option key={value} value={value}>{Number(value).toLocaleString()} tokens</option>)}
      </Select>
    </Field>
    <Field hint="在回答或产物旁展示安全摘要，不展示内部推理和个人画像细节。">
      <Switch label="显示公开审计过程" checked={Boolean(settings?.["assistant.public_audit.enabled"])}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "assistant.public_audit.enabled", value: data.checked })} />
    </Field>
    <details className="settings-details" open={expandCapabilities || capabilitiesOpen}
      onToggle={(event) => { if (!expandCapabilities) setCapabilitiesOpen(event.currentTarget.open); }}>
      <summary>扩展能力与安全策略</summary>
      <AgentCatalogList entries={config.skills} onOpenSkillDocument={onOpenSkillDocument} title="技能" />
      <AgentCatalogList entries={config.plugins} title="插件" />
      <AgentCatalogList entries={config.mcpServers} title="工具连接（MCP）" />
      <div className="agent-settings-section" aria-label="安全策略">
        <div className="agent-settings-section-title">安全策略</div>
        <ul className="settings-policy-list">
          <li>{config.safety.highRiskRequiresConfirmation ? "高风险动作需要确认" : "高风险动作未强制确认"}</li>
          <li>{config.safety.memoryWriteNeedsScan ? "记忆写入前扫描注入" : "记忆写入未启用扫描"}</li>
          <li>{config.safety.namespaceIsolation ? "记忆按命名空间隔离" : "记忆未启用命名空间隔离"}</li>
        </ul>
      </div>
    </details>
  </div>;
}

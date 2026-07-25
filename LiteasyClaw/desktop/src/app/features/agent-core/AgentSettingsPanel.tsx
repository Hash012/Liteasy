import {
  defaultAgentCoreConfig,
  getAgentCoreStatusLabel,
  getAgentEntryStatusLabel,
  type AgentCoreCatalogEntry,
  type AgentCoreConfig
} from "./agentCoreConfig";
import { BotRegular, ShieldRegular } from "@fluentui/react-icons";

type AgentSettingsPanelProps = {
  config?: AgentCoreConfig;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
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
              <button
                className="agent-settings-doc-button"
                onClick={() => onOpenSkillDocument?.(entry)}
                type="button"
              >
                打开文档
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSettingsPanel({
  config = defaultAgentCoreConfig,
  onOpenSkillDocument
}: AgentSettingsPanelProps) {
  const safetyItems = [
    config.safety.highRiskRequiresConfirmation ? "高风险动作需要确认" : "高风险动作未强制确认",
    config.safety.memoryWriteNeedsScan ? "记忆写入前扫描注入" : "记忆写入未启用扫描",
    config.safety.namespaceIsolation ? "Memory 按命名空间隔离" : "Memory 未启用命名空间隔离"
  ];

  return (
    <div className="model-policy-card agent-settings-card">
      <div className="agent-settings-header">
        <div aria-label="AI 功能" className="model-policy-title"><BotRegular /></div>
        <div className={`agent-settings-badge ${config.status}`}>
          {getAgentCoreStatusLabel(config.status)}
        </div>
      </div>

      <AgentCatalogList
        entries={config.skills}
        onOpenSkillDocument={onOpenSkillDocument}
        title="Skill 条目"
      />
      <AgentCatalogList entries={config.plugins} title="Plugin 条目" />
      <AgentCatalogList entries={config.mcpServers} title="MCP 条目" />
      <div className="agent-settings-section" aria-label="安全策略">
        <div className="agent-settings-section-title"><ShieldRegular /></div>
        <div className="agent-settings-chip-row">
          {safetyItems.map((item) => (
            <span className="agent-settings-chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

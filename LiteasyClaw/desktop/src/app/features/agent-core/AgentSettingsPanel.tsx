import {
  defaultAgentCoreConfig,
  getAgentCoreStatusLabel,
  getAgentEntryStatusLabel,
  type AgentCoreCatalogEntry,
  type AgentCoreConfig,
  type AgentMemoryEntry
} from "./agentCoreConfig";

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

function AgentMemoryList({ entries }: { entries: AgentMemoryEntry[] }) {
  return (
    <div className="agent-settings-section">
      <div className="agent-settings-section-title">Memory 条目</div>
      <div className="agent-settings-list">
        {entries.map((entry) => (
          <div className="agent-settings-row" key={entry.id}>
            <div className="agent-settings-row-main">
              <div className="agent-settings-row-title">
                {entry.type} · {entry.importance}
              </div>
              <div className="agent-settings-row-description">{entry.summary}</div>
            </div>
            <div className="agent-settings-badge memory">{entry.namespace}</div>
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
        <div>
          <div className="model-policy-title">Agent 核心</div>
          <div className="model-policy-summary">
            面向文献阅读、知识组织、学术产物和组织资料区的受控工作台 Agent。
          </div>
        </div>
        <div className={`agent-settings-badge ${config.status}`}>
          {getAgentCoreStatusLabel(config.status)}
        </div>
      </div>

      <div className="agent-md-card">
        <div className="agent-settings-section-title">agent.md</div>
        <div className="agent-md-path">{config.agentMd.path}</div>
        <div className="agent-settings-row-description">{config.agentMd.summary}</div>
        <div className="model-policy-meta">版本：{config.agentMd.revision}</div>
      </div>

      <div className="agent-settings-budget" aria-label="Agent 循环预算">
        <div>
          <span>{config.budget.maxIterations}</span>
          <small>最大迭代</small>
        </div>
        <div>
          <span>{config.budget.maxToolCalls}</span>
          <small>工具调用</small>
        </div>
        <div>
          <span>{config.budget.staleObservationTurns}</span>
          <small>旧观察轮次</small>
        </div>
      </div>

      <AgentCatalogList
        entries={config.skills}
        onOpenSkillDocument={onOpenSkillDocument}
        title="Skill 条目"
      />
      <AgentCatalogList entries={config.plugins} title="Plugin 条目" />
      <AgentCatalogList entries={config.mcpServers} title="MCP 条目" />
      <AgentMemoryList entries={config.memories} />

      <div className="agent-settings-section">
        <div className="agent-settings-section-title">安全与记忆策略</div>
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

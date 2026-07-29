import {
  defaultAgentCoreConfig,
  getAgentCoreStatusLabel,
  getAgentEntryStatusLabel,
  type AgentCoreCatalogEntry,
  type AgentCoreConfig
} from "./agentCoreConfig";
import { BotRegular, ShieldRegular } from "@fluentui/react-icons";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";

type AgentSettingsPanelProps = {
  config?: AgentCoreConfig;
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
  onOpenSkillDocument,
  onUpdateSetting,
  settings
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
      <div className="agent-settings-section" aria-label="目标语言">
        <div className="agent-settings-section-title">目标语言</div>
        <label className="agent-settings-toggle-row">
          <span className="agent-settings-row-main">
            <span className="agent-settings-row-title">薄读生成语言</span>
            <span className="agent-settings-row-description">
              默认中文；英文输出保留论文关键术语，跟随系统会读取浏览器语言。
            </span>
          </span>
          <select
            aria-label="薄读生成语言"
            onChange={(event) => onUpdateSetting?.({
              intent: "update_setting",
              target: "assistant.language",
              value: event.currentTarget.value
            })}
            value={settings?.["assistant.language"] ?? "zh-CN"}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
      </div>
      <div className="agent-settings-section" aria-label="用户可见审计">
        <div className="agent-settings-section-title">用户可见审计</div>
        <label className="agent-settings-toggle-row">
          <span className="agent-settings-row-main">
            <span className="agent-settings-row-title">显示公开审计过程</span>
            <span className="agent-settings-row-description">
              在回答或产物旁展示安全摘要，不显示内部 trace、prompt 或画像细节。
            </span>
          </span>
          <input
            aria-label="显示公开审计过程"
            checked={Boolean(settings?.["assistant.public_audit.enabled"])}
            onChange={(event) => onUpdateSetting?.({
              intent: "update_setting",
              target: "assistant.public_audit.enabled",
              value: event.currentTarget.checked
            })}
            type="checkbox"
          />
        </label>
      </div>
      <div className="agent-settings-section" aria-label="扫描 PDF OCR">
        <div className="agent-settings-section-title">扫描 PDF OCR</div>
        <label className="agent-settings-toggle-row">
          <span className="agent-settings-row-main">
            <span className="agent-settings-row-title">识别语言</span>
            <span className="agent-settings-row-description">仅用于没有文字层的 PDF；English、简体中文和双语均可离线识别，OCR 证据仍只支持页级定位。</span>
          </span>
          <select
            aria-label="扫描 PDF OCR 语言"
            onChange={(event) => onUpdateSetting?.({
              intent: "update_setting",
              target: "import.ocr_language",
              value: event.currentTarget.value
            })}
            value={settings?.["import.ocr_language"] ?? "eng"}
          >
            <option value="eng">English</option>
            <option value="chi_sim">中文（简体）</option>
            <option value="eng+chi_sim">中文 + English</option>
          </select>
        </label>
      </div>
      <div className="agent-settings-section" aria-label="Intuecho 同步">
        <div className="agent-settings-section-title">Intuecho 同步</div>
        <label className="agent-settings-toggle-row">
          <span className="agent-settings-row-main">
            <span className="agent-settings-row-title">共享批注端点</span>
            <span className="agent-settings-row-description">仅 HTTPS；未配置时公开批注保留在本地等待同步。</span>
          </span>
          <input
            aria-label="Intuecho 同步端点"
            onChange={(event) => onUpdateSetting?.({ intent: "update_setting", target: "thin_reading.intuecho_endpoint", value: event.currentTarget.value.trim() })}
            placeholder="https://intuecho.example.com"
            type="url"
            value={settings?.["thin_reading.intuecho_endpoint"] ?? ""}
          />
        </label>
      </div>
      <div className="agent-settings-section" aria-label="OpenAlex 外部文献检索">
        <div className="agent-settings-section-title">OpenAlex 外部文献检索</div>
        <label className="agent-settings-toggle-row">
          <span className="agent-settings-row-main">
            <span className="agent-settings-row-title">API 密钥</span>
            <span className="agent-settings-row-description">仅用于当前用户的闭包外文献检索；不会写入薄读产物、缓存或提示词。</span>
          </span>
          <input
            aria-label="OpenAlex API 密钥"
            autoComplete="off"
            onChange={(event) => onUpdateSetting?.({ intent: "update_setting", target: "thin_reading.openalex_api_key", value: event.currentTarget.value.trim() })}
            placeholder="OpenAlex api_key"
            type="password"
            value={settings?.["thin_reading.openalex_api_key"] ?? ""}
          />
        </label>
      </div>
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

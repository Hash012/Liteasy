import type { AccountSession } from "../account/account.types";
import { useState } from "react";
import { Dropdown, Input, Option, Tooltip } from "@fluentui/react-components";
import {
  AddRegular,
  ArchiveRegular,
  BotRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  EyeOffRegular,
  EyeRegular,
  PersonRegular,
  SignOutRegular
} from "@fluentui/react-icons";
import type { OrganizationSummary } from "../organization/organization.types";
import type { AgentMemoryEntry } from "../agent-core/agentCoreConfig";
import { AcademicProfileForm } from "./AcademicProfileForm";
import type { AcademicProfile } from "./profile.types";
import { formatAcademicProfile } from "./profile.types";

type PersonalCenterPanelProps = {
  academicProfile: AcademicProfile;
  agentMemories?: AgentMemoryEntry[];
  agentRecentState?: string;
  accountSession: AccountSession | null;
  onClearProfile: () => void;
  onLogout: () => void;
  onOpenAcademicArchive: () => void;
  onToggleProfileSampling: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  onUpdateAgentMemories?: (memories: AgentMemoryEntry[]) => void;
  onUpdateAgentRecentState?: (summary: string) => void;
  organizationSummary: OrganizationSummary | null;
  profileClearMessage?: string;
  profileSamplingEnabled: boolean;
  readPaperCount: number;
};

export function PersonalCenterPanel({
  academicProfile,
  agentMemories = [],
  agentRecentState = "",
  accountSession,
  onClearProfile,
  onLogout,
  onOpenAcademicArchive,
  onToggleProfileSampling,
  onUpdateAcademicProfile,
  onUpdateAgentMemories,
  onUpdateAgentRecentState,
  organizationSummary,
  profileClearMessage,
  profileSamplingEnabled,
  readPaperCount
}: PersonalCenterPanelProps) {
  const [expandedSections, setExpandedSections] = useState<string[]>(["profile", "academic"]);
  const displayName = accountSession?.name ?? "未连接云账号";
  const teamName = organizationSummary?.name ?? "未加入组织";
  const isExpanded = (section: string) => expandedSections.includes(section);
  const toggleSection = (section: string) => {
    setExpandedSections((current) => current.includes(section)
      ? current.filter((item) => item !== section)
      : [...current, section]);
  };
  const updateMemory = (memoryId: string, patch: Partial<AgentMemoryEntry>) => {
    onUpdateAgentMemories?.(
      agentMemories.map((memory) => memory.id === memoryId ? { ...memory, ...patch } : memory)
    );
  };
  const addMemory = () => {
    onUpdateAgentMemories?.([
      ...agentMemories,
      {
        id: `memory-${Date.now()}`,
        importance: "中",
        namespace: "local-user",
        summary: "",
        type: "偏好"
      }
    ]);
  };
  const removeMemory = (memoryId: string) => {
    onUpdateAgentMemories?.(agentMemories.filter((memory) => memory.id !== memoryId));
  };

  return (
    <section aria-label="左边栏个人中心" className="personal-center-panel">
      <div className="personal-center-header">
        <Tooltip content="退出登录" positioning="below" relationship="description">
          <button aria-label="退出登录" className="personal-center-logout icon-only" onClick={onLogout} title="断开当前云账号会话" type="button">
            <SignOutRegular />
          </button>
        </Tooltip>
      </div>

      <div className="personal-center-identity">
        <div className="personal-center-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
        <div className="personal-center-facts">
          <div>{displayName}</div>
          <div>{teamName}</div>
        </div>
      </div>

      <section className="sidebar-section personal-center-section">
        <button aria-expanded={isExpanded("profile")} aria-label={`${isExpanded("profile") ? "收起" : "展开"}画像配置`} className="sidebar-section-header" onClick={() => toggleSection("profile")} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{isExpanded("profile") ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <PersonRegular />
          <span>画像配置</span>
        </button>
        {isExpanded("profile") ? <div className="sidebar-section-content">
        <div className="personal-center-row">{formatAcademicProfile(academicProfile)}</div>
        <AcademicProfileForm academicProfile={academicProfile} onSave={onUpdateAcademicProfile} />
        {profileClearMessage ? <div className="personal-center-row">{profileClearMessage}</div> : null}
        <Tooltip content={profileSamplingEnabled ? "关闭用户画像" : "开启用户画像"} positioning="below" relationship="description">
          <button aria-label={profileSamplingEnabled ? "关闭用户画像" : "开启用户画像"} className="left-rail-button icon-only" onClick={onToggleProfileSampling} type="button">
            {profileSamplingEnabled ? <EyeOffRegular /> : <EyeRegular />}
          </button>
        </Tooltip>
        </div> : null}
      </section>

      <section className="sidebar-section personal-center-section">
        <button aria-expanded={isExpanded("memory")} aria-label={`${isExpanded("memory") ? "收起" : "展开"} Agent Memory`} className="sidebar-section-header" onClick={() => toggleSection("memory")} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{isExpanded("memory") ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <BotRegular />
          <span>Agent Memory</span>
        </button>
        {isExpanded("memory") ? <div className="sidebar-section-content agent-memory-section">
          <div className="personal-center-footnote">按相关性加入后续 Agent 的系统上下文。</div>
          <div className="agent-memory-list">
            {agentMemories.map((memory) => (
              <div className="agent-memory-item" key={memory.id}>
                <Input
                  aria-label={`Memory 内容：${memory.id}`}
                  onChange={(_, data) => updateMemory(memory.id, { summary: data.value })}
                  size="small"
                  value={memory.summary}
                />
                <div className="agent-memory-controls">
                  <Dropdown
                    aria-label={`Memory 类型：${memory.id}`}
                    onOptionSelect={(_, data) => data.optionValue && updateMemory(memory.id, { type: data.optionValue as AgentMemoryEntry["type"] })}
                    selectedOptions={[memory.type]}
                    size="small"
                    value={memory.type}
                  >
                    {(["偏好", "画像", "项目", "经历"] as const).map((type) => <Option key={type} value={type}>{type}</Option>)}
                  </Dropdown>
                  <Dropdown
                    aria-label={`Memory 重要性：${memory.id}`}
                    onOptionSelect={(_, data) => data.optionValue && updateMemory(memory.id, { importance: data.optionValue as AgentMemoryEntry["importance"] })}
                    selectedOptions={[memory.importance]}
                    size="small"
                    value={`${memory.importance}优先级`}
                  >
                    {(["高", "中", "低"] as const).map((importance) => <Option key={importance} text={`${importance}优先级`} value={importance}>{importance}优先级</Option>)}
                  </Dropdown>
                  <Tooltip content="删除这条 Memory" positioning="below" relationship="description">
                    <button aria-label={`删除 Memory：${memory.id}`} className="left-rail-button danger icon-only" onClick={() => removeMemory(memory.id)} type="button"><DeleteRegular /></button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
          <button aria-label="新增 Agent Memory" className="agent-memory-add" onClick={addMemory} type="button"><AddRegular />新增</button>
          <label className="agent-state-label" htmlFor="agent-recent-state">近期状态摘要</label>
          <textarea
            aria-label="Agent 近期状态摘要"
            id="agent-recent-state"
            maxLength={1200}
            onChange={(event) => onUpdateAgentRecentState?.(event.target.value)}
            placeholder="留空时，由当前工作区状态自动生成。"
            rows={4}
            value={agentRecentState}
          />
          <button className="agent-state-reset" onClick={() => onUpdateAgentRecentState?.("")} type="button">恢复自动摘要</button>
        </div> : null}
      </section>

      {profileSamplingEnabled ? (
        <section className="sidebar-section personal-center-section">
          <button aria-expanded={isExpanded("academic")} aria-label={`${isExpanded("academic") ? "收起" : "展开"}学术档案`} className="sidebar-section-header" onClick={() => toggleSection("academic")} type="button">
            <span aria-hidden="true" className="sidebar-section-disclosure">{isExpanded("academic") ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
            <ArchiveRegular />
            <span>学术档案</span>
          </button>
          {isExpanded("academic") ? <div className="sidebar-section-content">
          <div className="personal-center-row">已阅读 {readPaperCount} 篇</div>
          <div className="personal-center-actions">
            <Tooltip content="学术档案" positioning="below" relationship="description">
              <button aria-label="学术档案" className="left-rail-button icon-only" onClick={onOpenAcademicArchive} type="button"><ArchiveRegular /></button>
            </Tooltip>
            <Tooltip content="清空用户画像" positioning="below" relationship="description">
              <button aria-label="清空用户画像" className="left-rail-button danger icon-only" onClick={onClearProfile} type="button"><DeleteRegular /></button>
            </Tooltip>
          </div>
          </div> : null}
        </section>
      ) : null}
    </section>
  );
}

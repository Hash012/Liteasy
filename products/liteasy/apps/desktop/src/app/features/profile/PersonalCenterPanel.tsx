import { WorkbenchPageHeader } from "../workbench/WorkbenchPage";
import { SpaceOperationsPanel, type SpaceOperationsView } from "../spaces/SpaceOperationsPanel";
import type { AccountSession } from "../account/account.types";
import { AccountDataExportPanel } from "../account/AccountDataExportPanel";
import { useState } from "react";
import { Button, Switch, Tab, TabList, Tooltip } from "@fluentui/react-components";
import { ArchiveRegular, DeleteRegular, PersonRegular, SignOutRegular, SparkleRegular, BookOpenRegular } from "@fluentui/react-icons";
import type { OrganizationSummary } from "../organization/organization.types";
import type { AgentMemoryEntry } from "../agent-core/agentCoreConfig";
import { AcademicProfileForm } from "./AcademicProfileForm";
import type { AcademicProfile } from "./profile.types";
import type { UserTag } from "./academicProfileClient";
import type { ProfileMemoryController } from "./useProfileMemory";
import { ProfileMemoryPanel } from "./ProfileMemoryPanel";
import "./personalCenter.css";

type PersonalCenterPanelProps = {
  spaceOperations?: SpaceOperationsView;
  workspaceSourceType?: "local_library" | "organization_shared";
  onOpenLocal?: () => void;
  onOpenOrganization?: () => void;
  readNotificationIds?: string[];
  academicProfile: AcademicProfile;
  agentMemories?: AgentMemoryEntry[];
  agentRecentState?: string;
  profileMemory?: ProfileMemoryController;
  accountSession: AccountSession | null;
  onClearProfile: () => void;
  onLogout: () => void;
  onLoginRequired?: () => void;
  onOpenAcademicArchive: () => void;
  onToggleProfileSampling: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  onUpdateAgentMemories?: (memories: AgentMemoryEntry[]) => void;
  onUpdateAgentRecentState?: (summary: string) => void;
  organizationSummary: OrganizationSummary | null;
  profileClearMessage?: string;
  profileSamplingEnabled: boolean;
  profileTags: UserTag[];
  readPaperCount: number;
};
export function PersonalCenterPanel(props: PersonalCenterPanelProps) {
  const [section, setSection] = useState("research");
  const { accountSession, profileMemory: memory } = props;
  return <section aria-label="个人中心" className="personal-center-panel profile-page">
    <WorkbenchPageHeader title="个人中心" description="管理研究兴趣、个性化偏好与本机数据。" />
    <header className="profile-identity">
      <div className="profile-avatar" aria-hidden="true"><PersonRegular /></div>
      <div className="profile-identity-text"><strong>{accountSession?.name ?? "本机研究者"}</strong><span>{accountSession ? props.workspaceSourceType === "organization_shared" ? props.organizationSummary?.name ?? "组织文库" : "本机文库" : "未登录 · 本机档案可用"}</span></div>
      {accountSession ? <Tooltip content="退出登录" relationship="label"><Button appearance="subtle" icon={<SignOutRegular />} aria-label="退出登录" onClick={props.onLogout} /></Tooltip>
        : <Button size="small" onClick={props.onLoginRequired}>登录</Button>}
    </header>
    <div className="profile-personalization">
      <Switch label="使用画像个性化" checked={props.profileSamplingEnabled} onChange={props.onToggleProfileSampling} />
      <p className="profile-muted">用于论文推荐和 AI 回答。关闭后停止采集和使用，已有条目保留。</p>
    </div>
    <TabList selectedValue={section} onTabSelect={(_, data) => setSection(String(data.value))} size="small" aria-label="个人中心分类">
      <Tab value="spaces">空间与操作</Tab><Tab value="research" icon={<BookOpenRegular />}>研究档案</Tab><Tab value="memory" icon={<SparkleRegular />}>已记偏好{memory?.data.pending.length ? ` · ${memory.data.pending.length}` : ""}</Tab><Tab value="data" icon={<ArchiveRegular />}>数据管理</Tab>
    </TabList>
    <div className="profile-section" role="region" aria-label={section === "spaces" ? "空间与操作" : section === "research" ? "研究档案" : section === "memory" ? "已记偏好" : "数据管理"}>
      {section === "spaces" ? <SpaceOperationsPanel session={accountSession} workspace={props.workspaceSourceType ?? "local_library"} organization={props.organizationSummary} operations={props.spaceOperations} readNotificationIds={props.readNotificationIds} onOpenLocal={props.onOpenLocal} onOpenOrganization={props.onOpenOrganization} /> : null}
      {section === "research" ? <><h3>你的研究方向</h3><p className="profile-muted">填写主题、方法和阅读语言，让推荐更贴近当前研究。</p><AcademicProfileForm academicProfile={props.academicProfile} onSave={props.onUpdateAcademicProfile} /></> : null}
      {section === "memory" && memory ? <ProfileMemoryPanel memory={memory} enabled={props.profileSamplingEnabled} /> : null}
      {section === "memory" && !memory ? <p className="profile-muted">暂无已保存的偏好。</p> : null}
      {section === "data" ? <>
        <h3>本机画像与阅读记录</h3>
        <div className="profile-stats"><span><strong>{props.readPaperCount}</strong>已阅读论文</span><span><strong>{memory?.data.entries.length ?? 0}</strong>已记偏好</span></div>
        <p className="profile-muted">研究档案与明确偏好优先；阅读记录中的词语仅作为辅助兴趣，不会自动变成确定的个人事实。</p>
        <div className="profile-interest-tags" aria-label="阅读兴趣">{props.profileTags.length ? props.profileTags.map((tag) => <span key={tag.label} title={`阅读证据 ${tag.evidenceCount} 次`}>{tag.label}</span>) : <p className="profile-muted">暂无阅读兴趣记录。</p>}</div>
        <div className="profile-actions"><Button icon={<ArchiveRegular />} onClick={props.onOpenAcademicArchive}>查看与导出档案</Button><Button icon={<DeleteRegular />} onClick={props.onClearProfile}>清空画像数据</Button></div>
        <AccountDataExportPanel session={accountSession} />
      </> : null}
    </div>
    {memory?.error ? <p role="alert" className="profile-notice">{memory.error}</p> : null}
    {memory?.notice || props.profileClearMessage ? <p role="status" className="profile-notice">{memory?.notice || props.profileClearMessage}</p> : null}
  </section>;
}

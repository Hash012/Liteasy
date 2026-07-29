import type { AccountSession } from "../account/account.types";
import { useState } from "react";
import { Tooltip } from "@fluentui/react-components";
import {
  ArchiveRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  PersonRegular,
  SignOutRegular
} from "@fluentui/react-icons";
import type { OrganizationSummary } from "../organization/organization.types";
import { AcademicProfileForm } from "./AcademicProfileForm";
import type { AcademicProfile } from "./profile.types";
import {
  formatAcademicProfile,
  formatAcademicResearchProfile
} from "./profile.types";

type PersonalCenterPanelProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  onClearProfile: () => void;
  onLogout: () => void;
  onOpenAcademicArchive: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  organizationSummary: OrganizationSummary | null;
  profileClearMessage?: string;
  readPaperCount: number;
};

export function PersonalCenterPanel({
  academicProfile,
  accountSession,
  onClearProfile,
  onLogout,
  onOpenAcademicArchive,
  onUpdateAcademicProfile,
  organizationSummary,
  profileClearMessage,
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
          <span>学术档案配置</span>
        </button>
        {isExpanded("profile") ? <div className="sidebar-section-content">
          <div className="personal-center-row">研究阶段：{formatAcademicProfile(academicProfile)}</div>
          <div className="personal-center-row">研究学科：{formatAcademicResearchProfile(academicProfile)}</div>
          <AcademicProfileForm academicProfile={academicProfile} onSave={onUpdateAcademicProfile} />
          {profileClearMessage ? <div className="personal-center-row">{profileClearMessage}</div> : null}
        </div> : null}
      </section>

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
            <Tooltip content="清空学术档案" positioning="below" relationship="description">
              <button aria-label="清空学术档案" className="left-rail-button danger icon-only" onClick={onClearProfile} type="button"><DeleteRegular /></button>
            </Tooltip>
          </div>
          </div> : null}
      </section>
    </section>
  );
}

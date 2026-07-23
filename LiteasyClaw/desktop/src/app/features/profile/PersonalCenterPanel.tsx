import type { AccountSession } from "../account/account.types";
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
};

export function PersonalCenterPanel({
  academicProfile,
  accountSession,
  onClearProfile,
  onLogout,
  onOpenAcademicArchive,
  onUpdateAcademicProfile,
  organizationSummary,
  profileClearMessage
}: PersonalCenterPanelProps) {
  const displayName = accountSession?.name ?? "未连接云账号";
  const userId = accountSession?.sessionId ?? "未登录";
  const teamName = organizationSummary?.name ?? "未加入组织";

  return (
    <section aria-label="左边栏个人中心" className="personal-center-panel">
      <div className="personal-center-header">
        <div>
          <div className="personal-center-kicker">左边栏</div>
          <div className="personal-center-title">个人中心</div>
        </div>
        <button
          className="personal-center-logout"
          onClick={onLogout}
          title="断开当前云账号会话"
          type="button"
        >
          退出登录
        </button>
      </div>

      <div className="personal-center-card primary">
        <div className="personal-center-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
        <div className="personal-center-facts">
          <div>昵称：{displayName}</div>
          <div>用户 ID：{userId}</div>
          <div>所在团队：{teamName}</div>
        </div>
      </div>

      <div className="personal-center-card">
        <div className="personal-center-section-title">研究画像</div>
        <div className="personal-center-row">研究阶段：{formatAcademicProfile(academicProfile)}</div>
        <div className="personal-center-row">研究学科：{formatAcademicResearchProfile(academicProfile)}</div>
        <AcademicProfileForm academicProfile={academicProfile} onSave={onUpdateAcademicProfile} />
        {profileClearMessage ? <div className="personal-center-row">{profileClearMessage}</div> : null}
        <div className="personal-center-footnote">
          可随时在此维护研究阶段和研究学科。
        </div>
      </div>

      <div className="personal-center-card">
        <div className="personal-center-section-title">学术档案</div>
        <button className="left-rail-button" onClick={onOpenAcademicArchive} type="button">查看学术档案</button>
        <button className="left-rail-button danger" onClick={onClearProfile} type="button">清空研究画像</button>
      </div>
    </section>
  );
}

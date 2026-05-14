import type { AccountSession } from "../account/account.types";
import type { OrganizationSummary } from "../organization/organization.types";

type PersonalCenterPanelProps = {
  accountSession: AccountSession | null;
  onClose: () => void;
  onClearProfile: () => void;
  onOpenAcademicArchive: () => void;
  onToggleProfileSampling: () => void;
  organizationSummary: OrganizationSummary | null;
  profileClearMessage?: string;
  profileSamplingEnabled: boolean;
  readPaperCount: number;
};

export function PersonalCenterPanel({
  accountSession,
  onClearProfile,
  onClose,
  onOpenAcademicArchive,
  onToggleProfileSampling,
  organizationSummary,
  profileClearMessage,
  profileSamplingEnabled,
  readPaperCount
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
        <button className="personal-center-close" onClick={onClose} type="button">
          返回文献库
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
        <div className="personal-center-section-title">画像配置</div>
        <div className="personal-center-row">画像配置：性别 未设置 · 年龄 未设置 · 学段 未设置</div>
        <div className="personal-center-row">用户画像：{profileSamplingEnabled ? "已开启" : "已关闭"}</div>
        {profileClearMessage ? <div className="personal-center-row">{profileClearMessage}</div> : null}
        <button className="left-rail-button" onClick={onToggleProfileSampling} type="button">
          {profileSamplingEnabled ? "关闭用户画像" : "开启用户画像"}
        </button>
        <div className="personal-center-footnote">
          开启后会采样身份数据、文献和交互记录；微信、飞书等本机数据仍需额外授权。
        </div>
      </div>

      {profileSamplingEnabled ? (
        <div className="personal-center-card">
          <div className="personal-center-section-title">学术人格</div>
          <div className="personal-center-row">已阅读论文数：{readPaperCount}</div>
          <div className="personal-center-row">学术人格：跨学科综述型</div>
          <button className="left-rail-button" onClick={onOpenAcademicArchive} type="button">学术档案</button>
          <button className="left-rail-button danger" onClick={onClearProfile} type="button">清空用户画像（需鉴权）</button>
        </div>
      ) : null}
    </section>
  );
}

import type { AccountSession } from "../account/account.types";
import type { AcademicProfile } from "./profile.types";
import { formatAcademicProfile, formatAcademicResearchProfile } from "./profile.types";

type AcademicArchiveDialogProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  onClose: () => void;
  onExport: () => void;
};

export function AcademicArchiveDialog({
  academicProfile,
  accountSession,
  onClose,
  onExport
}: AcademicArchiveDialogProps) {
  const displayName = accountSession?.name ?? "未连接云账号";

  return (
    <div className="workspace-dialog-backdrop academic-archive-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="学术档案页面" className="workspace-modal-panel academic-archive-dialog" role="dialog">
        <div className="academic-archive-header">
          <div>
            <div className="personal-center-kicker">用户画像配置文件</div>
            <div className="academic-archive-title">学术档案</div>
          </div>
          <button className="organization-dialog-close" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="academic-archive-grid">
          <div className="academic-archive-card">档案所有者：{displayName}</div>
            <div className="academic-archive-card">研究阶段：{formatAcademicProfile(academicProfile)}</div>
            <div className="academic-archive-card">研究学科：{formatAcademicResearchProfile(academicProfile)}</div>
        </div>
        <button className="left-rail-button" onClick={onExport} type="button">导出学术档案</button>
      </div>
    </div>
  );
}

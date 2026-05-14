import type { AccountSession } from "../account/account.types";

type AcademicArchiveDialogProps = {
  accountSession: AccountSession | null;
  onClose: () => void;
  readPaperCount: number;
};

export function AcademicArchiveDialog({
  accountSession,
  onClose,
  readPaperCount
}: AcademicArchiveDialogProps) {
  const displayName = accountSession?.name ?? "未连接云账号";

  return (
    <div className="academic-archive-backdrop">
      <div aria-label="学术档案页面" className="academic-archive-dialog" role="dialog">
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
          <div className="academic-archive-card">身份配置：性别 未设置 · 年龄 未设置 · 学段 未设置</div>
          <div className="academic-archive-card">阅读统计：已阅读 {readPaperCount} 篇论文</div>
          <div className="academic-archive-card">学术人格分析：跨学科综述型</div>
          <div className="academic-archive-card">授权状态：微信/飞书/本地文件 未授权</div>
        </div>
      </div>
    </div>
  );
}

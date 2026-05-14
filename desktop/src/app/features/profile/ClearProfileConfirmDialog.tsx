type ClearProfileConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
};

export function ClearProfileConfirmDialog({ onCancel, onConfirm }: ClearProfileConfirmDialogProps) {
  return (
    <div className="clear-profile-backdrop">
      <div aria-label="清空用户画像确认" className="clear-profile-dialog" role="dialog">
        <div className="academic-archive-header">
          <div>
            <div className="personal-center-kicker">需鉴权操作</div>
            <div className="academic-archive-title">清空用户画像确认</div>
          </div>
          <button className="organization-dialog-close" onClick={onCancel} type="button">
            取消
          </button>
        </div>
        <div className="academic-archive-card">
          将清空性别、年龄、学段、阅读统计和学术人格缓存；昵称、用户 ID 和头像会保留。
        </div>
        <div className="clear-profile-actions">
          <button className="left-rail-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="left-rail-button danger" onClick={onConfirm} type="button">
            确认清空用户画像
          </button>
        </div>
      </div>
    </div>
  );
}

import type { OrganizationGovernanceStatus, OrganizationGovernanceSummary } from "./organization.types";

type OrganizationGovernancePanelProps = {
  message: string;
  status: OrganizationGovernanceStatus;
  summary: OrganizationGovernanceSummary | null;
};

function getStatusLabel(status: OrganizationGovernanceStatus) {
  if (status === "success") {
    return "组织治理：已同步";
  }

  if (status === "loading") {
    return "组织治理：加载中";
  }

  if (status === "waiting") {
    return "组织治理：等待组织空间";
  }

  if (status === "error") {
    return "组织治理：加载失败";
  }

  return "组织治理：未连接云账号";
}

export function OrganizationGovernancePanel({
  message,
  status,
  summary
}: OrganizationGovernancePanelProps) {
  const firstTask = summary?.runningTasks[0];
  const firstAuditEvent = summary?.recentAuditEvents[0];

  return (
    <div className="model-policy-card organization-governance-card">
      <div className="model-policy-title">组织治理</div>
      <div className={`model-policy-status ${status}`}>{getStatusLabel(status)}</div>
      {summary ? (
        <>
          <div className="model-policy-summary">
            治理后台：待复核 {summary.auditQueue.pendingReview} 项，高风险 {summary.auditQueue.highRisk} 项
          </div>
          <div className="model-policy-summary">
            组织配额：存储 {summary.quota.storageUsedGb} / {summary.quota.storageLimitGb} GB，模型调用 {summary.quota.modelCallsUsed} / {summary.quota.modelCallsLimit}
          </div>
          {firstTask ? (
            <div className="model-policy-summary">
              后台任务：{firstTask.label}（{firstTask.status}）
            </div>
          ) : null}
          {firstAuditEvent ? (
            <div className="model-policy-summary">
              审计队列：{firstAuditEvent.label}（{firstAuditEvent.risk}）
            </div>
          ) : null}
        </>
      ) : (
        <div className="model-policy-footnote">{message}</div>
      )}
    </div>
  );
}

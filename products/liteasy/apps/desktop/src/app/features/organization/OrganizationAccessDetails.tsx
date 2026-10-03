import { Badge } from "@fluentui/react-components";
import { ShieldRegular } from "@fluentui/react-icons";
import type { OrganizationAccessSnapshot, OrganizationAction } from "./organization.types";
import { organizationActionLabels, organizationDenialMessage } from "./organizationAccessSnapshot";

export function OrganizationAccessDetails({ snapshot }: { snapshot?: OrganizationAccessSnapshot }) {
  return <details className="organization-surface organization-disclosure">
    <summary><ShieldRegular /><span>我的组织权限</span></summary>
    {snapshot ? <>
      <p className="organization-muted">策略版本 {snapshot.policyRevision ?? "未提供"} · 组织版本 {snapshot.authorizationRevision}</p>
      {snapshot.policyExceptions.includes("owner_export") ? <p>组织已限制导出；所有者仍可导出原文件。</p> : null}
      <ul className="organization-access-list" aria-label="组织权限明细">
        {(Object.keys(organizationActionLabels) as OrganizationAction[]).map((action) => {
          const allowed = snapshot.allowedActions.includes(action);
          const reason = snapshot.denialReasons[action];
          return <li key={action}>
            <div><span>{organizationActionLabels[action]}</span><Badge appearance="tint" color={allowed ? "success" : "informative"}>
              {allowed ? "可用" : reason === "organization_resource_context_required" ? "按内容判断" : "不可用"}
            </Badge></div>
            {!allowed ? <p>{organizationDenialMessage(reason)}</p> : null}
            {allowed && action === "invite" ? <p>{snapshot.actionConstraints.inviteRoles.includes("admin")
              ? "可邀请管理员或成员。" : "仅可邀请成员。"}</p> : null}
          </li>;
        })}
      </ul>
      <p className="organization-muted">提交操作时会重新检查成员身份和资料权限。</p>
    </> : <p>暂无法获取权限说明，请刷新组织空间后重试。</p>}
  </details>;
}

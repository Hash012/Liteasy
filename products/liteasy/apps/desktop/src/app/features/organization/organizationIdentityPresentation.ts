import type { OrganizationMember } from "./organization.types";

export function organizationMemberLabel(member: OrganizationMember) {
  const name = member.name.trim();
  return name ? member.email ? `${name} · ${member.email}` : name
    : member.email ? `${member.email}（姓名未提供）` : "成员姓名尚未提供";
}

/** Destructive actions require a readable, unique identity in this authorized snapshot. */
export function organizationMemberIdentifiable(member: OrganizationMember, members: readonly OrganizationMember[]) {
  if (!member.name.trim() && !member.email) return false;
  const label = organizationMemberLabel(member);
  return members.filter((item) => organizationMemberLabel(item) === label).length === 1;
}

export function organizationAuditActionLabel(action?: string) {
  const labels: Record<string, string> = {
    create_organization: "创建了组织",
    create_organization_invitation: "邀请了新成员",
    accept_organization_invitation: "接受了组织邀请",
    revoke_organization_invitation: "撤销了组织邀请",
    leave_organization: "退出了组织",
    change_organization_member_role: "调整了成员角色",
    change_organization_member_status: "调整了成员状态",
    transfer_organization_ownership: "转移了组织所有权",
    update_organization_storage_policy: "更新了资料存储规则",
  };
  return action ? labels[action] ?? "完成了一项组织操作" : "活动说明尚未提供";
}

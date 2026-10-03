import type { OrganizationAccessSnapshot, OrganizationAction } from "./organization.types";

export const organizationActionLabels: Record<OrganizationAction, string> = {
  read_metadata: "查看资料信息",
  read_body: "阅读组织内容",
  comment: "参与组织讨论",
  edit_own: "编辑自己的内容",
  moderate: "管理组织讨论",
  upload: "上传组织资料",
  export_original: "导出原文件",
  share_excerpt: "外发资料摘录",
  publish_public: "公开发布组织材料",
  invite: "邀请成员",
  change_role: "更改成员角色",
  transfer_owner: "转移组织所有权",
  run_external_model: "使用外部 AI"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const actions = Object.keys(organizationActionLabels) as OrganizationAction[];

export function normalizeOrganizationAccessSnapshot(value: Record<string, unknown>): OrganizationAccessSnapshot | undefined {
  if (!Array.isArray(value.allowedActions) || !value.allowedActions.every((action) => typeof action === "string") ||
    !isRecord(value.denialReasons) || !revision(value.authorizationRevision) ||
    !(value.policyRevision === null || revision(value.policyRevision)) ||
    !Array.isArray(value.policyExceptions) || !isRecord(value.actionConstraints) ||
    !Array.isArray(value.actionConstraints.inviteRoles) ||
    !value.actionConstraints.inviteRoles.every((role) => role === "admin" || role === "member")) {
    return undefined;
  }
  const allowedActions = actions.filter((action) => value.allowedActions instanceof Array && value.allowedActions.includes(action));
  const denialReasons: OrganizationAccessSnapshot["denialReasons"] = {};
  for (const action of actions) {
    const reason = value.denialReasons[action];
    const allowed = allowedActions.includes(action);
    // A partial or contradictory response must not become a grant in the UI.
    if (allowed ? reason !== undefined : typeof reason !== "string" || !reason.trim()) return undefined;
    if (!allowed) denialReasons[action] = reason as string;
  }
  return {
    actionConstraints: { inviteRoles: [...value.actionConstraints.inviteRoles] },
    allowedActions,
    authorizationRevision: value.authorizationRevision,
    denialReasons,
    policyExceptions: value.policyExceptions.includes("owner_export") ? ["owner_export"] : [],
    policyRevision: value.policyRevision
  };
}

export function organizationDenialMessage(code: string | undefined) {
  return ({
    organization_membership_required: "需要有效的组织成员身份。",
    organization_resource_context_required: "需按具体内容的作者、范围和当前版本判断。",
    organization_role_forbidden: "需要组织所有者或管理员权限。",
    organization_owner_required: "仅组织所有者可执行此操作。",
    organization_upload_forbidden: "当前组织策略不允许你上传资料。",
    organization_export_forbidden: "当前组织策略不允许你导出原文件。",
    organization_external_use_policy_unconfirmed: "尚未获得组织材料外发授权。"
  } as Record<string, string>)[code ?? ""] ?? "当前无法执行此操作，请刷新权限后重试。";
}

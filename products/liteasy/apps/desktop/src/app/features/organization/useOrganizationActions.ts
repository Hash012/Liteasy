import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSession } from "../account/account.types";
import {
  createOrganizationActionClient,
  type OrganizationActionTransport
} from "./organizationActionsClient";
import { organizationActorBinding, organizationSessionMatchesEndpoint } from "./organizationActorBinding";
import type { OrganizationRole, OrganizationSummary } from "./organization.types";

type UseOrganizationActionsOptions = {
  accountSession: AccountSession | null;
  canCreateOrganization?: boolean;
  controlPlaneEndpoint: string;
  onAnalysisHint: (message: string) => void;
  onOrganizationChanged?: (organizationId?: string) => void | Promise<void>;
  transport?: OrganizationActionTransport;
};

function actionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "组织请求未完成，请稍后重试。";
  }
  const messages: Record<string, string> = {
    invalid_organization_invite: "邀请目标无效，请检查用户 ID。",
    invalid_organization_name: "组织名称无效，请修改后重试。",
    organization_invitation_invalid: "邀请令牌格式无效，请检查后重试。",
    organization_invitation_not_pending: "该邀请已接受、撤销或过期，请使用新的邀请。",
    organization_invitation_required: "没有找到面向当前账号的有效邀请。",
    organization_member_revision_conflict: "成员状态已变化，请刷新组织后重试。",
    organization_membership_required: "当前账号不是该组织成员。",
    organization_not_found: "未找到该组织，请检查组织 ID。",
    organization_owner_leave_blocked: "组织所有者不能直接退出，请先转移所有权。",
    organization_owner_required: "此操作仅限组织负责人执行。",
    organization_revision_conflict: "组织成员状态已变化，请刷新后重试。",
    organization_role_forbidden: "当前组织角色无权执行此操作。"
  };
  return messages[error.name] ?? error.message;
}

export function useOrganizationActions({
  accountSession,
  canCreateOrganization = false,
  controlPlaneEndpoint,
  onAnalysisHint,
  onOrganizationChanged,
  transport
}: UseOrganizationActionsOptions) {
  const actorBinding = organizationActorBinding(accountSession, controlPlaneEndpoint);
  const currentActor = useRef(actorBinding);
  currentActor.current = actorBinding;
  const requestEpoch = useRef(0);
  const mounted = useRef(true);
  const [stateActor, setStateActor] = useState(actorBinding);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestEpoch.current += 1; }; }, []);
  useEffect(() => { resetOrganizationActions(); }, [actorBinding]);

  function beginRequest() {
    const epoch = ++requestEpoch.current;
    return () => mounted.current && currentActor.current === actorBinding && requestEpoch.current === epoch &&
      organizationActorBinding(accountSession, controlPlaneEndpoint) === actorBinding;
  }
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [actionPending, setActionPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<OrganizationSummary | null>(null);
  const [leaveSummary, setLeaveSummary] = useState<OrganizationSummary | null>(null);
  const client = useMemo(() => createOrganizationActionClient({
    endpoint: controlPlaneEndpoint,
    transport
  }), [controlPlaneEndpoint, transport]);

  function recordActionMessage(message: string, analysisMessage = message) {
    setActionMessage(message);
    onAnalysisHint(analysisMessage);
  }

  function requireSession() {
    if (!mounted.current || currentActor.current !== actorBinding || organizationActorBinding(accountSession, controlPlaneEndpoint) !== actorBinding) return null;
    if (accountSession) {
      if (!organizationSessionMatchesEndpoint(accountSession, controlPlaneEndpoint)) {
        recordActionMessage("账号或服务地址已变化，请重新登录后管理组织。");
        return null;
      }
      return accountSession;
    }
    recordActionMessage("请先登录 Liteasy 账号再管理组织。");
    return null;
  }

  function openCreateDialog() {
    setActionMessage(undefined);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (!actionPending) setCreateOpen(false);
  }

  function openJoinDialog() {
    setActionMessage(undefined);
    setJoinOpen(true);
  }

  function closeJoinDialog() {
    if (!actionPending) setJoinOpen(false);
  }

  function openInviteDialog(summary: OrganizationSummary) {
    setActionMessage(undefined);
    setInviteSummary(summary);
  }

  function closeInviteDialog() {
    if (!actionPending) setInviteSummary(null);
  }

  function openLeaveDialog(summary: OrganizationSummary) {
    setActionMessage(undefined);
    setLeaveSummary(summary);
  }

  function closeLeaveDialog() {
    if (!actionPending) setLeaveSummary(null);
  }

  async function createOrganizationRequest(organizationName: string) {
    const session = requireSession();
    if (!session) return;
    if (!canCreateOrganization) {
      setCreateOpen(false);
      recordActionMessage("当前账号无创建组织权限；你可以加入已有组织。");
      return;
    }

    const current = beginRequest();
    setActionPending(true);
    setActionMessage("正在创建组织...");
    try {
      const result = await client.create({
        displayName: session.name,
        name: organizationName,
        sessionId: session.sessionId
      });
      if (!current()) return;
      await onOrganizationChanged?.(result.organization.organizationId);
      if (!current()) return;
      setCreateOpen(false);
      recordActionMessage(`已创建组织“${result.organization.name}”。`);
    } catch (error) {
      if (current()) recordActionMessage(actionErrorMessage(error));
    } finally {
      if (current()) setActionPending(false);
    }
  }

  async function joinOrganizationRequest(invitationToken: string) {
    const session = requireSession();
    if (!session) return;
    const current = beginRequest();
    setActionPending(true);
    setActionMessage("正在加入组织...");
    try {
      const result = await client.acceptInvitation({
        displayName: session.name,
        invitationToken,
        sessionId: session.sessionId
      });
      if (!current()) return;
      await onOrganizationChanged?.(result.organizationId);
      if (!current()) return;
      setJoinOpen(false);
      recordActionMessage("已加入组织。");
    } catch (error) {
      if (current()) recordActionMessage(actionErrorMessage(error));
    } finally {
      if (current()) setActionPending(false);
    }
  }

  async function inviteOrganizationMember(input: {
    role: Extract<OrganizationRole, "admin" | "member">;
    targetSubject: string;
  }) {
    const session = requireSession();
    if (!session || !inviteSummary) return;
    if (inviteSummary.myRole === "member") {
      setInviteSummary(null);
      recordActionMessage("当前组织角色无权邀请成员。");
      return;
    }

    const current = beginRequest();
    setActionPending(true);
    setActionMessage("正在创建邀请...");
    try {
      const result = await client.invite({
        displayName: session.name,
        expectedRevision: inviteSummary.revision,
        organizationId: inviteSummary.organizationId,
        role: input.role,
        sessionId: session.sessionId,
        targetSubject: input.targetSubject
      });
      if (!current()) return;
      await onOrganizationChanged?.(inviteSummary.organizationId);
      if (!current()) return;
      const organizationName = inviteSummary.name;
      setInviteSummary(null);
      const token = result.invitation?.invitationToken;
      const confirmation = `已为账号 ${input.targetSubject} 创建 ${organizationName} 的邀请。`;
      recordActionMessage(token ? `${confirmation}一次性加入令牌：${token}` : confirmation, confirmation);
    } catch (error) {
      if (current()) recordActionMessage(actionErrorMessage(error));
    } finally {
      if (current()) setActionPending(false);
    }
  }

  async function leaveOrganizationRequest() {
    const session = requireSession();
    if (!session || !leaveSummary) return;
    if (leaveSummary.myRole === "owner") {
      setLeaveSummary(null);
      recordActionMessage("组织所有者不能直接退出，请先转移所有权。");
      return;
    }

    const current = beginRequest();
    setActionPending(true);
    setActionMessage("正在退出组织...");
    try {
      const organizationId = leaveSummary.organizationId;
      const organizationName = leaveSummary.name;
      await client.leave({
        displayName: session.name,
        expectedMemberRevision: leaveSummary.myMemberRevision ?? 0,
        expectedRevision: leaveSummary.revision,
        organizationId,
        sessionId: session.sessionId
      });
      if (!current()) return;
      setLeaveSummary(null);
      await onOrganizationChanged?.();
      if (!current()) return;
      recordActionMessage(`已退出 ${organizationName}。`);
    } catch (error) {
      if (current()) recordActionMessage(actionErrorMessage(error));
    } finally {
      if (current()) setActionPending(false);
    }
  }

  function resetOrganizationActions() {
    requestEpoch.current += 1;
    setStateActor(currentActor.current);
    setActionMessage(undefined);
    setActionPending(false);
    setCreateOpen(false);
    setJoinOpen(false);
    setInviteSummary(null);
    setLeaveSummary(null);
  }

  return {
    actionMessage: stateActor === actorBinding ? actionMessage : undefined,
    actionPending: stateActor === actorBinding && actionPending,
    closeCreateDialog,
    closeInviteDialog,
    closeJoinDialog,
    closeLeaveDialog,
    createOpen: stateActor === actorBinding && createOpen,
    createOrganizationRequest,
    inviteOrganizationMember,
    inviteSummary: stateActor === actorBinding ? inviteSummary : null,
    joinOpen: stateActor === actorBinding && joinOpen,
    joinOrganizationRequest,
    leaveOrganizationRequest,
    leaveSummary: stateActor === actorBinding ? leaveSummary : null,
    openCreateDialog,
    openInviteDialog,
    openJoinDialog,
    openLeaveDialog,
    resetOrganizationActions
  };
}

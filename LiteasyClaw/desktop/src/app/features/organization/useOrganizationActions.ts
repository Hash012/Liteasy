import { useState } from "react";
import type { OrganizationSummary } from "./organization.types";

type UseOrganizationActionsOptions = {
  canCreateOrganization?: boolean;
  onAnalysisHint: (message: string) => void;
};

export function useOrganizationActions({
  canCreateOrganization = false,
  onAnalysisHint
}: UseOrganizationActionsOptions) {
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<OrganizationSummary | null>(null);
  const [leaveSummary, setLeaveSummary] = useState<OrganizationSummary | null>(null);

  function recordActionMessage(message: string) {
    setActionMessage(message);
    onAnalysisHint(message);
  }

  function openCreateDialog() {
    setActionMessage(undefined);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    setCreateOpen(false);
  }

  function openJoinDialog() {
    setActionMessage(undefined);
    setJoinOpen(true);
  }

  function closeJoinDialog() {
    setJoinOpen(false);
  }

  function openInviteDialog(summary: OrganizationSummary) {
    setActionMessage(undefined);
    setInviteSummary(summary);
  }

  function closeInviteDialog() {
    setInviteSummary(null);
  }

  function openLeaveDialog(summary: OrganizationSummary) {
    setActionMessage(undefined);
    setLeaveSummary(summary);
  }

  function closeLeaveDialog() {
    setLeaveSummary(null);
  }

  function createDemoOrganizationRequest(organizationName: string) {
    if (!canCreateOrganization) {
      setCreateOpen(false);
      recordActionMessage("当前账号无创建组织权限；你可以加入已有组织。");
      return;
    }

    const message = `已提交创建组织“${organizationName}”的申请，当前为演示环境记录。`;
    setCreateOpen(false);
    recordActionMessage(message);
  }

  function createDemoOrganizationJoinRequest(inviteCode: string) {
    const message = `已提交加入组织的邀请码 ${inviteCode}，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。`;
    setJoinOpen(false);
    recordActionMessage(message);
  }

  function sendDemoOrganizationInvite() {
    if (!inviteSummary) {
      return;
    }

    if (inviteSummary.myRole === "member") {
      setInviteSummary(null);
      recordActionMessage("当前角色 member 无权邀请成员。");
      return;
    }

    const message = `已创建面向 ${inviteSummary.name} 的邀请，当前为演示环境记录。`;
    setInviteSummary(null);
    recordActionMessage(message);
  }

  function createDemoOrganizationLeaveRequest() {
    if (!leaveSummary) {
      return;
    }

    if (leaveSummary.myRole === "owner") {
      setLeaveSummary(null);
      recordActionMessage("当前组织 owner 不能直接退出；请先转移 owner，当前版本暂未开放该流程。");
      return;
    }

    const message = `已提交退出 ${leaveSummary.name} 的请求，当前为演示环境记录。`;
    setLeaveSummary(null);
    recordActionMessage(message);
  }

  function resetOrganizationActions() {
    setActionMessage(undefined);
    setCreateOpen(false);
    setJoinOpen(false);
    setInviteSummary(null);
    setLeaveSummary(null);
  }

  return {
    actionMessage,
    closeCreateDialog,
    closeInviteDialog,
    closeJoinDialog,
    closeLeaveDialog,
    createDemoOrganizationJoinRequest,
    createDemoOrganizationLeaveRequest,
    createDemoOrganizationRequest,
    createOpen,
    inviteSummary,
    joinOpen,
    leaveSummary,
    openCreateDialog,
    openInviteDialog,
    openJoinDialog,
    openLeaveDialog,
    resetOrganizationActions,
    sendDemoOrganizationInvite
  };
}

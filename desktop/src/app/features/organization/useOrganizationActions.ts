import { useState } from "react";
import type { OrganizationSummary } from "./organization.types";

type UseOrganizationActionsOptions = {
  onAnalysisHint: (message: string) => void;
};

export function useOrganizationActions({ onAnalysisHint }: UseOrganizationActionsOptions) {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<OrganizationSummary | null>(null);
  const [leaveSummary, setLeaveSummary] = useState<OrganizationSummary | null>(null);

  function openCreateDialog() {
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    setCreateOpen(false);
  }

  function openJoinDialog() {
    setJoinOpen(true);
  }

  function closeJoinDialog() {
    setJoinOpen(false);
  }

  function openInviteDialog(summary: OrganizationSummary) {
    setInviteSummary(summary);
  }

  function closeInviteDialog() {
    setInviteSummary(null);
  }

  function openLeaveDialog(summary: OrganizationSummary) {
    setLeaveSummary(summary);
  }

  function closeLeaveDialog() {
    setLeaveSummary(null);
  }

  function createDemoOrganizationRequest(organizationName: string) {
    const message = `已创建 ${organizationName} 的 demo 组织申请，等待正式后端接入。`;
    setCreateOpen(false);
    onAnalysisHint(message);
  }

  function createDemoOrganizationJoinRequest(inviteCode: string) {
    const message = `已提交组织邀请码 ${inviteCode} 的 demo 加入申请，等待正式后端接入。`;
    setJoinOpen(false);
    onAnalysisHint(message);
  }

  function sendDemoOrganizationInvite() {
    if (!inviteSummary) {
      return;
    }

    const message = `已创建 ${inviteSummary.name} 的 demo 邀请，等待正式后端接入。`;
    setInviteSummary(null);
    onAnalysisHint(message);
  }

  function createDemoOrganizationLeaveRequest() {
    if (!leaveSummary) {
      return;
    }

    const message = `已创建退出 ${leaveSummary.name} 的 demo 请求，等待正式后端接入。`;
    setLeaveSummary(null);
    onAnalysisHint(message);
  }

  function resetOrganizationActions() {
    setCreateOpen(false);
    setJoinOpen(false);
    setInviteSummary(null);
    setLeaveSummary(null);
  }

  return {
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

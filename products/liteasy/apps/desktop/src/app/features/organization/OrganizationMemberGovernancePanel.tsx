import { useState } from "react";
import { Tooltip } from "@fluentui/react-components";
import {
  ArrowSwapRegular,
  CheckmarkCircleRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DismissCircleRegular,
  ShieldPersonRegular
} from "@fluentui/react-icons";
import type { AccountSession } from "../account/account.types";
import {
  createOrganizationActionClient,
  type OrganizationActionTransport
} from "./organizationActionsClient";
import type { OrganizationMember, OrganizationSummary } from "./organization.types";

type MemberAction = {
  kind: "activate" | "demote" | "promote" | "remove" | "suspend" | "transfer";
  member: OrganizationMember;
};

type OrganizationMemberGovernancePanelProps = {
  accountSession: AccountSession;
  endpoint: string;
  onChanged: () => void | Promise<void>;
  summary: OrganizationSummary;
  transport?: OrganizationActionTransport;
};

function actionLabel(action: MemberAction) {
  const labels = {
    activate: "恢复成员",
    demote: "撤销管理员",
    promote: "设为管理员",
    remove: "移除成员",
    suspend: "暂停成员",
    transfer: "转移所有权"
  };
  return `${labels[action.kind]}：${action.member.name}`;
}

function canManageMember(summary: OrganizationSummary, member: OrganizationMember) {
  if (member.role === "owner") return false;
  if (summary.myRole === "owner") return true;
  return summary.myRole === "admin" && member.role === "member";
}

export function OrganizationMemberGovernancePanel({
  accountSession,
  endpoint,
  onChanged,
  summary,
  transport
}: OrganizationMemberGovernancePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<MemberAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const client = createOrganizationActionClient({ endpoint, transport });

  async function execute(action: MemberAction) {
    setSubmitting(true);
    setMessage(undefined);
    const common = {
      displayName: accountSession.name,
      expectedMemberRevision: action.member.revision,
      expectedRevision: summary.revision,
      organizationId: summary.organizationId,
      sessionId: accountSession.sessionId,
      targetSubject: action.member.subject
    };
    try {
      if (action.kind === "promote" || action.kind === "demote") {
        await client.changeMemberRole({
          ...common,
          role: action.kind === "promote" ? "admin" : "member"
        });
      } else if (action.kind === "transfer") {
        await client.transferOwnership(common);
      } else {
        await client.setMemberStatus({
          ...common,
          status: action.kind === "activate"
            ? "active"
            : action.kind === "suspend"
              ? "suspended"
              : "removed"
        });
      }
      setPendingAction(null);
      setMessage(`${actionLabel(action)}已完成。`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "组织成员操作未完成。");
    } finally {
      setSubmitting(false);
    }
  }

  const governedMembers = summary.members.filter((member) => member.role !== "owner");
  return (
    <section className="sidebar-section organization-governance-card">
      <button
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}成员治理`}
        className="sidebar-section-header"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="sidebar-section-disclosure">
          {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </span>
        <ShieldPersonRegular />
        <span>成员治理</span>
      </button>
      {expanded ? (
        <div className="sidebar-section-content">
          {governedMembers.map((member) => {
            const manageable = canManageMember(summary, member);
            return (
              <div className="organization-member-governance-row" key={member.subject}>
                <div className="model-policy-summary">
                  {member.name} · {member.role === "admin" ? "管理员" : "成员"} · {member.status === "suspended" ? "已暂停" : "正常"}
                </div>
                {manageable ? (
                  <div className="organization-member-governance-actions">
                    {summary.myRole === "owner" ? (
                      <Tooltip content={member.role === "admin" ? "撤销管理员" : "设为管理员"} relationship="label">
                        <button
                          aria-label={`${member.role === "admin" ? "撤销管理员" : "设为管理员"} ${member.name}`}
                          className="policy-button ghost icon-only"
                          disabled={submitting || member.status === "suspended"}
                          onClick={() => setPendingAction({
                            kind: member.role === "admin" ? "demote" : "promote",
                            member
                          })}
                          type="button"
                        >
                          <ShieldPersonRegular />
                        </button>
                      </Tooltip>
                    ) : null}
                    <Tooltip content={member.status === "suspended" ? "恢复成员" : "暂停成员"} relationship="label">
                      <button
                        aria-label={`${member.status === "suspended" ? "恢复成员" : "暂停成员"} ${member.name}`}
                        className="policy-button ghost icon-only"
                        disabled={submitting}
                        onClick={() => setPendingAction({
                          kind: member.status === "suspended" ? "activate" : "suspend",
                          member
                        })}
                        type="button"
                      >
                        {member.status === "suspended" ? <CheckmarkCircleRegular /> : <DismissCircleRegular />}
                      </button>
                    </Tooltip>
                    <Tooltip content="移除成员" relationship="label">
                      <button
                        aria-label={`移除成员 ${member.name}`}
                        className="left-rail-button danger icon-only"
                        disabled={submitting}
                        onClick={() => setPendingAction({ kind: "remove", member })}
                        type="button"
                      >
                        <DismissCircleRegular />
                      </button>
                    </Tooltip>
                    {summary.myRole === "owner" && member.status === "active" ? (
                      <Tooltip content="转移所有权" relationship="label">
                        <button
                          aria-label={`转移所有权给 ${member.name}`}
                          className="policy-button ghost icon-only"
                          disabled={submitting}
                          onClick={() => setPendingAction({ kind: "transfer", member })}
                          type="button"
                        >
                          <ArrowSwapRegular />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {governedMembers.length === 0 ? (
            <div className="model-policy-footnote">当前没有可管理的组织成员。</div>
          ) : null}
          {pendingAction ? (
            <div aria-label="确认成员治理操作" className="organization-member-governance-confirm" role="alertdialog">
              <div className="model-policy-summary">确认{actionLabel(pendingAction)}？</div>
              <div className="organization-member-governance-actions">
                <button
                  className="policy-button ghost"
                  disabled={submitting}
                  onClick={() => setPendingAction(null)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="left-rail-button danger"
                  disabled={submitting}
                  onClick={() => void execute(pendingAction)}
                  type="button"
                >
                  {submitting ? "正在处理" : "确认"}
                </button>
              </div>
            </div>
          ) : null}
          {message ? <div aria-live="polite" className="organization-action-message">{message}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

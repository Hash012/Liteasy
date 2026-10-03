import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular, PeopleAddRegular } from "@fluentui/react-icons";
import type { AccountSession } from "../account/account.types";
import { createOrganizationActionClient, type OrganizationActionTransport, type OrganizationInvitation } from "./organizationActionsClient";
import { organizationActorBinding, organizationSessionMatchesEndpoint } from "./organizationActorBinding";
import type { OrganizationSummary } from "./organization.types";

type Props = { session: AccountSession; endpoint: string; summary: OrganizationSummary; onChanged: () => void | Promise<void>; transport?: OrganizationActionTransport };
const statusLabels = { pending: "待接受", accepted: "已接受", revoked: "已撤回", expired: "已过期" };

export function OrganizationInvitationPanel(props: Props) {
  if (!["owner", "admin"].includes(props.summary.myRole)) return null;
  return <InvitationManager key={`${organizationActorBinding(props.session, props.endpoint)}:${props.summary.organizationId}:${props.summary.revision}`} {...props} />;
}

function InvitationManager({ session, endpoint, summary, onChanged, transport }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [revision, setRevision] = useState(summary.revision);
  const [selection, setSelection] = useState<OrganizationInvitation | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const binding = organizationActorBinding(session, endpoint);
  const client = createOrganizationActionClient({ endpoint, transport });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);
  function beginRequest() {
    if (!mounted.current || binding !== organizationActorBinding(session, endpoint)) return null;
    if (!organizationSessionMatchesEndpoint(session, endpoint)) {
      setInvitations([]); setSelection(null); setStatus("账号或服务地址已变化，请重新登录后管理邀请。"); return null;
    }
    const request = ++epoch.current;
    return () => mounted.current && request === epoch.current && binding === organizationActorBinding(session, endpoint);
  }
  async function load() {
    const current = beginRequest();
    if (!current) return;
    setBusy(true); setInvitations([]); setSelection(null); setStatus("");
    try {
      const result = await client.listInvitations({ organizationId: summary.organizationId, sessionId: session.sessionId });
      if (current()) { setInvitations(result.invitations); if (!result.invitations.length) setStatus("当前没有邀请记录。"); }
    } catch (error) { if (current()) setStatus(error instanceof Error ? error.message : "邀请列表暂不可用，请刷新后重试。"); }
    finally { if (current()) setBusy(false); }
  }
  async function refreshPermissions() {
    const current = beginRequest();
    if (!current) return;
    setBusy(true); setSelection(null); setInvitations([]); setStatus("");
    try { await onChanged(); if (current()) setStatus("组织权限已刷新，请重新加载邀请。"); }
    catch (error) { if (current()) setStatus(error instanceof Error ? error.message : "组织权限暂不可用。"); }
    finally { if (current()) setBusy(false); }
  }
  async function revoke() {
    if (!selection || busy || selection.status !== "pending" || (summary.myRole === "admin" && selection.role === "admin")) return;
    const current = beginRequest();
    if (!current) return;
    const approved = selection;
    setBusy(true); setStatus("");
    try {
      const result = await client.revokeInvitation({ organizationId: summary.organizationId, sessionId: session.sessionId, invitationId: approved.invitationId, expectedInvitationRevision: approved.revision, expectedRevision: revision });
      if (!current()) return;
      setInvitations((items) => items.map((item) => item.invitationId === approved.invitationId ? result.invitation : item));
      setRevision(result.organizationRevision); setSelection(null);
      setStatus("邀请已撤回，原加入令牌已失效。");
      await onChanged();
    } catch (error) { if (current()) { setSelection(null); setStatus(error instanceof Error ? error.message : "撤回邀请未完成，请刷新后核实。"); } }
    finally { if (current()) setBusy(false); }
  }
  return <section className="sidebar-section organization-governance-card">
    <Button appearance="subtle" className="sidebar-section-header" aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}邀请管理`} onClick={() => {
      const next = !expanded; setExpanded(next); if (next) void load();
      else { epoch.current += 1; setBusy(false); setSelection(null); setInvitations([]); }
    }}><span aria-hidden="true">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span><PeopleAddRegular /><span>邀请管理</span></Button>
    {expanded && <div className="sidebar-section-content">
      <p>查看已有邀请；撤回后原加入令牌失效。</p>
      <Button appearance="subtle" disabled={busy} onClick={() => void load()}>刷新邀请</Button>
      <Button appearance="subtle" disabled={busy} onClick={() => void refreshPermissions()}>刷新组织权限</Button>
      {busy && <p role="status">正在处理邀请…</p>}
      {invitations.map((item) => <article key={item.invitationId} aria-label={`邀请 ${item.targetSubject}`} className="organization-member-governance-row">
        <strong>{item.targetSubject}</strong><p>{item.role === "admin" ? "管理员" : "成员"} · <span>{statusLabels[item.status]}</span></p>
        <p>邀请者：{item.createdBy}</p><p>到期：{new Date(item.expiresAt).toLocaleString("zh-CN")}</p>
        {item.status === "pending" && Date.parse(item.expiresAt) > Date.now() && (summary.myRole === "owner" || item.role === "member") && <Button appearance="subtle" aria-label={`撤回邀请 ${item.targetSubject}`} disabled={busy} onClick={() => setSelection(item)}>撤回邀请</Button>}
      </article>)}
      {selection && <div role="alertdialog" aria-label="确认撤回邀请"><p>确认撤回 {summary.name} 对 {selection.targetSubject} 的邀请？</p><p>原加入令牌将失效。</p>
        <Button disabled={busy} onClick={() => setSelection(null)}>取消</Button><Button disabled={busy} onClick={() => void revoke()}>确认撤回</Button>
      </div>}
      {status && <p role="status">{status}</p>}
    </div>}
  </section>;
}

import { useId, useState } from "react";
import { Field, Input } from "@fluentui/react-components";
import { ActionButton, InlineNotice, ModalSurface, OptionPicker } from "../../shared/ui/productPrimitives";
import type { OrganizationRole, OrganizationSummary } from "./organization.types";

type OrganizationInviteConfirmDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (input: { role: Extract<OrganizationRole, "admin" | "member">; targetSubject: string }) => void;
  pending?: boolean;
  summary: OrganizationSummary;
};

export function OrganizationInviteConfirmDialog({ message, onCancel, onConfirm, pending = false, summary }: OrganizationInviteConfirmDialogProps) {
  const [targetSubject, setTargetSubject] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const formId = useId();
  return <ModalSurface title="邀请成员确认" onClose={onCancel} busy={pending} actions={<>
    <ActionButton disabled={pending} onClick={onCancel}>取消</ActionButton>
    <ActionButton appearance="primary" type="submit" form={formId} disabled={pending || !targetSubject.trim()}>{pending ? "正在创建" : "创建邀请"}</ActionButton>
  </>}>
    <p>组织：{summary.name}</p>
    <form id={formId} onSubmit={event => { event.preventDefault(); if (!pending && targetSubject.trim()) onConfirm({ role, targetSubject: targetSubject.trim() }); }}>
      <Field label="账号主体 ID"><Input aria-label="账号主体 ID" disabled={pending} value={targetSubject} placeholder="IdP subject" onChange={(_, data) => setTargetSubject(data.value)} /></Field>
      <Field label="组织角色"><OptionPicker aria-label="组织角色" disabled={pending} value={role} onValueChange={value => setRole(value === "admin" ? "admin" : "member")}
        options={[{ value: "member", label: "成员" }, ...(summary.myRole === "owner" ? [{ value: "admin", label: "管理员" }] : [])]} /></Field>
    </form>
    {pending ? <InlineNotice intent="busy" message="正在创建邀请，请稍候…" /> : null}
    {message ? <InlineNotice message={message} /> : null}
  </ModalSurface>;
}

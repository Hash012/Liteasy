import { useId, useState } from "react";
import { Field, Input } from "@fluentui/react-components";
import { ActionButton, InlineNotice, ModalSurface } from "../../shared/ui/productPrimitives";

type OrganizationJoinDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (invitationToken: string) => void;
  pending?: boolean;
};

export function OrganizationJoinDialog({ message, onCancel, onConfirm, pending = false }: OrganizationJoinDialogProps) {
  const [invitationToken, setValue] = useState("");
  const formId = useId();
  return <ModalSurface title="加入组织" onClose={onCancel} busy={pending} actions={<>
    <ActionButton disabled={pending} onClick={onCancel}>取消</ActionButton>
    <ActionButton appearance="primary" type="submit" form={formId} disabled={pending || !invitationToken.trim()}>{pending ? "正在加入" : "加入组织"}</ActionButton>
  </>}>
    <form id={formId} onSubmit={event => { event.preventDefault(); if (!pending && invitationToken.trim()) onConfirm(invitationToken.trim()); }}>
      <Field label="邀请令牌"><Input aria-label="邀请令牌" disabled={pending} value={invitationToken} placeholder="orginv_..." onChange={(_, data) => setValue(data.value)} /></Field>
    </form>
    {pending ? <InlineNotice intent="busy" message="正在加入，请稍候…" /> : null}
    {message ? <InlineNotice message={message} /> : null}
  </ModalSurface>;
}

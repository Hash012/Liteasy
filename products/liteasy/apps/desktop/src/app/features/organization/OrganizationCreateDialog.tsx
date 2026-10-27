import { useId, useState } from "react";
import { Field, Input } from "@fluentui/react-components";
import { ActionButton, InlineNotice, ModalSurface } from "../../shared/ui/productPrimitives";

type OrganizationCreateDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (organizationName: string) => void;
  pending?: boolean;
};

export function OrganizationCreateDialog({ message, onCancel, onConfirm, pending = false }: OrganizationCreateDialogProps) {
  const [organizationName, setValue] = useState("");
  const formId = useId();
  return <ModalSurface title="创建组织" onClose={onCancel} busy={pending} actions={<>
    <ActionButton disabled={pending} onClick={onCancel}>取消</ActionButton>
    <ActionButton appearance="primary" type="submit" form={formId} disabled={pending || !organizationName.trim()}>{pending ? "正在创建" : "创建组织"}</ActionButton>
  </>}>
    <form id={formId} onSubmit={event => { event.preventDefault(); if (!pending && organizationName.trim()) onConfirm(organizationName.trim()); }}>
      <Field label="组织名称"><Input aria-label="组织名称" disabled={pending} value={organizationName} placeholder="" onChange={(_, data) => setValue(data.value)} /></Field>
    </form>
    {pending ? <InlineNotice intent="busy" message="正在创建，请稍候…" /> : null}
    {message ? <InlineNotice message={message} /> : null}
  </ModalSurface>;
}

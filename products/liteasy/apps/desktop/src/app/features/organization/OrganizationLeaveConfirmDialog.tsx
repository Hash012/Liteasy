import { ActionButton, InlineNotice, ModalSurface } from "../../shared/ui/productPrimitives";
import type { OrganizationSummary } from "./organization.types";

type OrganizationLeaveConfirmDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  summary: OrganizationSummary;
};

export function OrganizationLeaveConfirmDialog({ message, onCancel, onConfirm, pending = false, summary }: OrganizationLeaveConfirmDialogProps) {
  return <ModalSurface title="退出组织确认" onClose={onCancel} busy={pending} actions={<>
    <ActionButton disabled={pending} onClick={onCancel}>取消</ActionButton>
    <ActionButton data-intent="danger" disabled={pending} onClick={onConfirm}>{pending ? "正在退出" : "退出组织"}</ActionButton>
  </>}>
    <p>组织：{summary.name}</p>
    {pending ? <InlineNotice intent="busy" message="正在退出组织，请稍候…" /> : null}
    {message ? <InlineNotice message={message} /> : null}
  </ModalSurface>;
}

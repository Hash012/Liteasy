import { ActionButton, InlineNotice, ModalSurface } from "../../shared/ui/productPrimitives";

type ClearProfileConfirmDialogProps = { onCancel: () => void; onConfirm: () => void };

export function ClearProfileConfirmDialog({ onCancel, onConfirm }: ClearProfileConfirmDialogProps) {
  return <ModalSurface title="清空学术档案确认" onClose={onCancel} actions={<>
    <ActionButton onClick={onCancel}>取消</ActionButton>
    <ActionButton data-intent="danger" onClick={onConfirm}>确认清空学术档案</ActionButton>
  </>}>
    <InlineNotice intent="warning" message="将清空学术档案、阅读画像、已记偏好和待确认变更，并暂停自动整理。昵称、用户 ID 和头像会保留。" />
  </ModalSurface>;
}

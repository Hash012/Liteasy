import { ActionButton, ModalSurface } from "../../shared/ui/productPrimitives";
import type { AccountSession } from "../account/account.types";
import type { AcademicProfile } from "./profile.types";
import { formatAcademicProfile, formatAcademicResearchProfile } from "./profile.types";

type AcademicArchiveDialogProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  onClose: () => void;
  onExport: () => void;
};

export function AcademicArchiveDialog({ academicProfile, accountSession, onClose, onExport }: AcademicArchiveDialogProps) {
  const displayName = accountSession?.name ?? "未连接云账号";
  return <ModalSurface title="学术档案" label="学术档案页面" onClose={onClose} actions={<ActionButton onClick={onExport}>导出学术档案</ActionButton>}>
    <p>档案所有者：{displayName}</p>
    <p>画像摘要：{formatAcademicProfile(academicProfile)}</p>
    <p>研究学科：{formatAcademicResearchProfile(academicProfile)}</p>
  </ModalSurface>;
}

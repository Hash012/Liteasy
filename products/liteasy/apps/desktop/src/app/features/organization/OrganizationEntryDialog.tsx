import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Tooltip } from "@fluentui/react-components";
import { DismissRegular, SearchRegular } from "@fluentui/react-icons";
import type { OrganizationList, OrganizationSummary } from "./organization.types";
import { OrganizationOverview, organizationRoleLabel } from "./OrganizationOverview";

type OrganizationEntryDialogProps = {
  list: OrganizationList | null;
  listMessage: string;
  onClose: () => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onSelectOrganization: (organizationId: string) => void;
  summary: OrganizationSummary | null;
};
export function OrganizationEntryDialog({ list, listMessage, onClose, onOpenSharedLibrary, onSelectOrganization, summary }: OrganizationEntryDialogProps) {
  const [query, setQuery] = useState("");
  const organizations = list?.organizations.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface aria-label="组织窗口" className="workspace-modal-panel organization-dialog">
      <DialogBody>
        <DialogTitle action={<Tooltip content="关闭" relationship="label"><Button appearance="subtle" aria-label="关闭" icon={<DismissRegular />} onClick={onClose} /></Tooltip>}>组织</DialogTitle>
        <DialogContent className="organization-dialog-grid">
          <nav className="organization-directory" aria-label="组织列表">
            <Input aria-label="搜索组织" placeholder="搜索组织" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
            <div className="organization-list-stack">
              {organizations.map((item) => <Button appearance="subtle" key={item.organizationId}
                aria-label={`打开 ${item.name} 详情`} aria-pressed={summary?.organizationId === item.organizationId}
                className="organization-list-card" onClick={() => onSelectOrganization(item.organizationId)}>
                <span className="organization-list-name">{item.name}</span>
                <span className="organization-list-meta">{organizationRoleLabel(item.myRole)} · {item.memberCount} 位成员</span>
              </Button>)}
              {!organizations.length ? <p className="organization-muted">{query ? "没有匹配的组织" : listMessage || "尚未加入组织"}</p> : null}
            </div>
          </nav>
          <div className="organization-dialog-detail">
            {summary ? <OrganizationOverview key={summary.organizationId} summary={summary} onOpenSharedLibrary={onOpenSharedLibrary} />
              : <p className="organization-muted">选择组织，查看成员、通知和共享文献库。</p>}
          </div>
        </DialogContent>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}

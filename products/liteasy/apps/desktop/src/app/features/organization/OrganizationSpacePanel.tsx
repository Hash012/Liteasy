import { Field, Select, Spinner } from "@fluentui/react-components";
import { OrganizationOverview } from "./OrganizationOverview";
import type { OrganizationList, OrganizationListStatus, OrganizationSummary, OrganizationSummaryStatus } from "./organization.types";

type OrganizationSpacePanelProps = {
  list: OrganizationList | null;
  listMessage: string;
  listStatus: OrganizationListStatus;
  message: string;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onSelectOrganization?: (organizationId: string) => void;
  readNotificationIds: string[];
  status: OrganizationSummaryStatus;
  summary: OrganizationSummary | null;
};
export function OrganizationSpacePanel(props: OrganizationSpacePanelProps) {
  const { list, listStatus, listMessage, summary, status, message } = props;
  return <section className="organization-space-panel" aria-label="组织空间">
    {list?.organizations.length ? <Field label="当前组织">
      <Select aria-label="切换组织" value={list.activeOrganizationId || summary?.organizationId || ""}
        disabled={status === "loading"} onChange={(_, data) => props.onSelectOrganization?.(data.value)}>
        {list.organizations.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.name}{list.organizations.filter((other) => other.name === item.name).length > 1 ? `（${item.organizationId}）` : ""}</option>)}
      </Select>
    </Field> : null}
    {listStatus === "loading" || status === "loading" ? <Spinner label="正在加载组织" size="tiny" /> : null}
    {listStatus === "error" || status === "error" ? <div className="organization-feedback" role="alert">{status === "error" ? message : listMessage}</div> : null}
    {summary ? <OrganizationOverview key={summary.organizationId} summary={summary} onOpenSharedLibrary={props.onOpenSharedLibrary}
      onMarkNotificationsRead={props.onMarkNotificationsRead} readNotificationIds={props.readNotificationIds} />
      : status !== "loading" && status !== "error" ? <p className="organization-muted">{message || "加入或创建组织，与团队共享文献和研究进展。"}</p> : null}
  </section>;
}

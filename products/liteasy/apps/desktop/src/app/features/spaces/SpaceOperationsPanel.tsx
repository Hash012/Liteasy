import { Badge, Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwiseRegular } from "@fluentui/react-icons";
import type { SpaceOperation } from "./spaceOperations";
import type { AccountSession } from "../account/account.types";
import type { OrganizationSummary } from "../organization/organization.types";
import "./spaces.css";

export type SpaceOperationsView = { rows: SpaceOperation[]; busy: boolean; message: string; refresh(): void | Promise<void> };
export function SpaceOperationsPanel({ session, workspace, organization, readNotificationIds = [], operations, onOpenLocal, onOpenOrganization }: {
  session: AccountSession | null; workspace: "local_library" | "organization_shared"; organization: OrganizationSummary | null;
  readNotificationIds?: string[]; operations?: SpaceOperationsView; onOpenLocal?: () => void; onOpenOrganization?: () => void;
}) {
  return <section aria-label="空间与操作" className="space-operations">
    <h3>当前空间</h3>
    <p>{session ? `账号：${session.name}` : "访客 · 本机阅读"} · {workspace === "organization_shared" ? `组织：${organization?.name ?? "组织文库"}` : "本机文库"}</p>
    <p>本机文件保留在设备；个人云仅本人可见；组织资料按成员权限访问。公开内容即使不进入广场仍可被公开访问。</p>
    <div className="space-actions"><Button size="small" onClick={onOpenLocal}>打开本机文库</Button>{session && organization ? <Button size="small" onClick={onOpenOrganization}>打开组织空间</Button> : null}</div>
    {!session ? <p>无需登录即可阅读和做笔记。登录、同步与公开分享分别由你选择。</p> : <>
      <h3>操作状态</h3>
      <Button icon={<ArrowClockwiseRegular />} disabled={operations?.busy || !operations} onClick={() => void operations?.refresh()}>刷新操作记录</Button>
      {operations?.busy ? <Spinner size="tiny" label="正在读取操作记录" /> : null}
      {operations?.message ? <p role="status">{operations.message}</p> : null}
      <ul aria-label="操作记录">{operations?.rows.map((row) => <li key={row.id}><strong>{row.title}</strong><Badge appearance="tint">{row.status}</Badge><p>{row.audience}</p><p>{row.detail}</p>{row.open ? <Button size="small" onClick={row.open}>{row.actionLabel ?? "打开来源"}</Button> : null}</li>)}</ul>
      {organization ? <><h3>组织通知 · {organization.name}</h3><p>已读只表示看过通知；邀请、授权和任务仍需单独处理。</p><ul aria-label="空间通知">{organization.notifications.map((notification) => <li key={`${organization.organizationId}:${notification.id}`}><Badge appearance="tint">{readNotificationIds.includes(`${organization.organizationId}:${notification.id}`) ? "已读" : "未读"}</Badge><p>{notification.message}</p><Button size="small" onClick={onOpenOrganization}>到组织空间处理</Button></li>)}</ul></> : null}
    </>}
  </section>;
}

import { ActionButton as Button } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { Input, Checkbox } from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import type { AssistantSessionHistoryItem, AssistantSessionKind } from "./assistantSessionHistory";
import { AssistantSessionActions, type AssistantSessionActionsProps } from "./AssistantSessionActions";

type SessionActions = Omit<AssistantSessionActionsProps, "session">;
type AssistantHistoryPanelProps = SessionActions & {
  activeSessionId?: string;
  history: AssistantSessionHistoryItem[];
  kind?: AssistantSessionKind;
  archived?: boolean;
  onArchivedChange?: (archived: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
};

export function formatSessionModifiedDate(timestamp: string | undefined, now = Date.now()) {
  const date = timestamp ? new Date(timestamp) : undefined;
  if (!date || !Number.isFinite(date.getTime())) return "时间未记录";
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时`;
  const days = Math.floor(minutes / 1440);
  if (days < 7) return `${days}天`;
  return date.toLocaleDateString("zh-CN", { ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}), month: "numeric", day: "numeric" });
}

export function AssistantSessionSummary({ session }: { session: AssistantSessionHistoryItem }) {
  const taskStatus = session.kind === "artifact_generation" ? ({ idle: "待运行", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断", unknown: "待核对" } as const)[session.status ?? "idle"] : undefined;
  const timestamp = session.updatedAt ?? session.createdAt;
  const date = timestamp ? new Date(timestamp) : undefined;
  const validDate = date && Number.isFinite(date.getTime()) ? date : undefined;
  return <>
    <span className="assistant-session-row-title">{session.title || "新对话"}</span>
    <time className="assistant-session-row-date" dateTime={validDate ? timestamp : undefined} title={validDate ? `修改于 ${validDate.toLocaleString("zh-CN")}` : "时间未记录"}>{taskStatus ? `${taskStatus} · ` : ""}{formatSessionModifiedDate(timestamp)}</time>
  </>;
}

export function AssistantSessionRow({ session, active, onOpenSession, restore, ...actions }: SessionActions & {
  session: AssistantSessionHistoryItem; active?: boolean; restore?: boolean; onOpenSession?: (id: string) => void;
}) {
  return <li className={`assistant-history-item${active ? " active" : ""}`}>
    <Button appearance="subtle" title={session.title} aria-current={active ? "true" : undefined} aria-label={`${active ? "当前会话：" : restore ? "恢复会话：" : "打开会话："}${session.title}`} className="assistant-history-restore" onClick={() => onOpenSession?.(session.id)} type="button">
      <AssistantSessionSummary session={session} />
    </Button>
    {actions.onUpdateSession || actions.onExportSession || actions.onDeleteSession ? <AssistantSessionActions session={session} {...actions} /> : null}
  </li>;
}

export function AssistantHistoryPanel({ activeSessionId, history, kind, archived: controlledArchived, onArchivedChange, onOpenSession, onRestoreSession, ...actions }: AssistantHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [localArchived, setLocalArchived] = useState(false);
  const archived = controlledArchived ?? localArchived;
  const visible = history.filter((session) => (!kind || (session.kind ?? "conversation") === kind) &&
    session.lifecycle !== "tombstoned" && (session.lifecycle === "archived") === archived &&
    session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  return <div className="assistant-history-panel" aria-label="历史会话面板">
    <div className="assistant-history-title">{kind === "artifact_generation" ? "任务" : kind === "conversation" ? "对话" : "历史会话"}</div>
    <Input aria-label="搜索会话标题" placeholder="搜索标题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
    <Checkbox label="查看归档" checked={archived} onChange={(_, data) => { setLocalArchived(!!data.checked); onArchivedChange?.(!!data.checked); }} />
    {visible.length === 0 ? <div className="assistant-history-empty">暂无历史会话或匹配记录。</div> : <ul className="assistant-history-list">
      {visible.map(session => <AssistantSessionRow key={session.id} session={session} active={session.id === activeSessionId} restore={!onOpenSession} onOpenSession={onOpenSession ?? onRestoreSession} {...actions} />)}
    </ul>}
  </div>;
}

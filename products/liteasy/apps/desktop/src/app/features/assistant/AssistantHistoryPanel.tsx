import { ActionButton as Button, ContextualActions } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { Input, Checkbox, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, Tooltip } from "@fluentui/react-components";
import { ChatRegular, ChevronRightRegular, DocumentRegular, MoreHorizontalRegular, SearchRegular } from "@fluentui/react-icons";
import type { AssistantSessionHistoryItem, AssistantSessionKind } from "./assistantSessionHistory";
import { getModeLabel } from "./assistantPresentation";

type AssistantHistoryPanelProps = {
  activeSessionId?: string;
  history: AssistantSessionHistoryItem[];
  kind?: AssistantSessionKind;
  archived?: boolean;
  onArchivedChange?: (archived: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
  onUpdateSession?: (sessionId: string, patch: Partial<AssistantSessionHistoryItem>) => void;
  onExportSession?: (sessionId: string) => void;
};
const statusLabels = { cancelled: "已终止", completed: "已完成", failed: "失败", idle: "可继续", running: "运行中", unknown: "状态待核对", interrupted: "运行已中断" } as const;
const kindLabels = { artifact_generation: "产物生成", conversation: "普通对话" } as const;

export function AssistantSessionSummary({ session }: { session: AssistantSessionHistoryItem }) {
  const timestamp = session.updatedAt ?? session.createdAt;
  const date = timestamp ? new Date(timestamp) : undefined;
  const validDate = date && Number.isFinite(date.getTime()) ? date : undefined;
  const activity = validDate?.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const latest = [...session.messages].reverse().find(message => message.role === "user" && message.content.trim());
  const excerpt = (latest?.content || session.draft?.input || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return <>
    <span className="assistant-session-row-icon" aria-hidden="true">{session.kind === "artifact_generation" ? <DocumentRegular /> : <ChatRegular />}</span>
    <span className="assistant-session-row-content">
      <span className="assistant-session-row-title">{session.title}</span>
      <span className="assistant-session-row-meta">
        <time dateTime={validDate ? timestamp : undefined} title={validDate?.toLocaleString("zh-CN")}>{activity ? `上次活动：${activity}` : "时间未记录"}</time>
        <span>{session.messageCount ?? session.messages.length} 条消息 · {getModeLabel(session.mode)}</span>
        {session.kind === "artifact_generation" || (session.status && !["idle", "completed"].includes(session.status)) ? <span>{kindLabels[session.kind ?? "conversation"]} · {statusLabels[session.status ?? "idle"]}</span> : null}
      </span>
      {excerpt ? <span className="assistant-session-row-excerpt" title={excerpt}>{excerpt}</span> : null}
    </span>
    <ChevronRightRegular className="assistant-session-row-chevron" aria-hidden="true" />
  </>;
}

export function AssistantHistoryPanel({ activeSessionId, history, kind, archived: controlledArchived, onArchivedChange, onOpenSession, onRestoreSession, onUpdateSession, onExportSession }: AssistantHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [localArchived, setLocalArchived] = useState(false);
  const archived = controlledArchived ?? localArchived;
  const [renaming, setRenaming] = useState<string>();
  const [menuSession, setMenuSession] = useState<string>();
  const [title, setTitle] = useState("");
  const openSession = onOpenSession ?? onRestoreSession;
  const visible = history.filter((session) => (!kind || (session.kind ?? "conversation") === kind) &&
    session.lifecycle !== "tombstoned" && (session.lifecycle === "archived") === archived &&
    session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return <div className="assistant-history-panel" aria-label="历史会话面板">
    <div className="assistant-history-title">{kind === "artifact_generation" ? "任务" : kind === "conversation" ? "对话" : "历史会话"}</div>
    <Input aria-label="搜索会话标题" placeholder="搜索标题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
    <Checkbox label="查看归档" checked={archived} onChange={(_, data) => { setLocalArchived(!!data.checked); onArchivedChange?.(!!data.checked); }} />
    {visible.length === 0 ? <div className="assistant-history-empty">暂无历史会话或匹配记录。</div> : <ul className="assistant-history-list">
      {visible.map((session) => <li className={`assistant-history-item product-contextual-owner${session.id === activeSessionId ? " active" : ""}`} key={session.id}>
        <Button appearance="subtle" title={`${session.title} · ${kindLabels[session.kind ?? "conversation"]} · ${statusLabels[session.status ?? "idle"]}`} aria-label={`${session.id === activeSessionId ? "当前会话：" : onOpenSession ? "打开会话：" : "恢复会话："}${session.title}`} className="assistant-history-restore" onClick={() => openSession?.(session.id)} type="button">
          <AssistantSessionSummary session={session} />
        </Button>
        <div className="assistant-history-item-meta">
          {session.id === activeSessionId ? <span>当前</span> : null}
          {session.pinned ? <span>已置顶</span> : null}
          {session.updatedAt && (!session.readAt || session.updatedAt > session.readAt) && session.id !== activeSessionId ? <span>有新内容</span> : null}
        </div>
        {onUpdateSession ? <ContextualActions selected={session.id === activeSessionId} editing={renaming === session.id} menuOpen={menuSession === session.id}><Menu onOpenChange={(_, data) => setMenuSession(data.open ? session.id : undefined)}><MenuTrigger disableButtonEnhancement><Tooltip content="管理会话" relationship="description"><Button appearance="subtle" aria-label={`管理 ${session.title}`} icon={<MoreHorizontalRegular />} /></Tooltip></MenuTrigger>
          <MenuPopover><MenuList>
            <MenuItem onClick={() => { setRenaming(session.id); setTitle(session.title); }}>重命名</MenuItem>
            <MenuItem onClick={() => onUpdateSession(session.id, { pinned: !session.pinned })}>{session.pinned ? "取消置顶" : "置顶"}</MenuItem>
            <MenuItem onClick={() => onUpdateSession(session.id, { lifecycle: archived ? "active" : "archived" })}>{archived ? "取消归档" : "归档并保留运行"}</MenuItem>
            {onExportSession ? <MenuItem onClick={() => onExportSession(session.id)}>导出可读内容</MenuItem> : null}
          </MenuList></MenuPopover></Menu></ContextualActions> : null}
        {renaming === session.id ? <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onUpdateSession?.(session.id, { title: title.trim(), titleSource: "user" }); setRenaming(undefined); }}>
          <Input aria-label="会话名称" value={title} onChange={(_, data) => setTitle(data.value)} /><Button type="submit">保存名称</Button>
        </form> : null}
      </li>)}
    </ul>}
  </div>;
}

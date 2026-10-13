import { ActionButton as Button } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { Input, Checkbox, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, Tooltip } from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import { getModeLabel } from "./assistantPresentation";
import type { AssistantSessionHistoryItem, AssistantSessionKind } from "./assistantSessionHistory";

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

export function AssistantHistoryPanel({ activeSessionId, history, kind, archived: controlledArchived, onArchivedChange, onOpenSession, onRestoreSession, onUpdateSession, onExportSession }: AssistantHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [localArchived, setLocalArchived] = useState(false);
  const archived = controlledArchived ?? localArchived;
  const [renaming, setRenaming] = useState<string>();
  const [title, setTitle] = useState("");
  const openSession = onOpenSession ?? onRestoreSession;
  const visible = history.filter((session) => (!kind || (session.kind ?? "conversation") === kind) &&
    session.lifecycle !== "tombstoned" && (session.lifecycle === "archived") === archived &&
    session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return <div className="assistant-history-panel" aria-label="历史会话面板">
    <div className="assistant-history-title">{kind === "artifact_generation" ? "任务" : kind === "conversation" ? "对话" : "历史会话"}</div>
    <Input aria-label="搜索会话标题" placeholder="搜索标题" value={query} onChange={(_, data) => setQuery(data.value)} />
    <Checkbox label="查看归档" checked={archived} onChange={(_, data) => { setLocalArchived(!!data.checked); onArchivedChange?.(!!data.checked); }} />
    {visible.length === 0 ? <div className="assistant-history-empty">暂无历史会话或匹配记录。</div> : <ul className="assistant-history-list">
      {visible.map((session) => <li className={`assistant-history-item${session.id === activeSessionId ? " active" : ""}`} key={session.id}>
        <button className="assistant-history-restore" onClick={() => openSession?.(session.id)} type="button">
          {session.id === activeSessionId ? "当前会话：" : onOpenSession ? "打开会话：" : "恢复会话："}{session.title}
        </button>
        <div className="assistant-history-item-meta">
          <span>{session.kind === "artifact_generation" ? `${session.taskBinding?.resultRefs.length || (session.artifactId ? 1 : 0)} 份结果${session.status === "failed" && session.artifactId ? " · 上次结果可用" : ""}` : `${session.messageCount ?? session.messages.length} 条消息 · ${getModeLabel(session.mode)}`}</span>
          <span className="assistant-history-item-kind">{kindLabels[session.kind ?? "conversation"]} · {statusLabels[session.status ?? "idle"]}</span>
          {session.pinned ? <span>已置顶</span> : null}
          {session.updatedAt && (!session.readAt || session.updatedAt > session.readAt) && session.id !== activeSessionId ? <span>有新内容</span> : null}
          {session.updatedAt ? <time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleString()}</time> : null}
        </div>
        {onUpdateSession ? <Menu><MenuTrigger disableButtonEnhancement><Tooltip content="管理会话" relationship="description"><Button appearance="subtle" aria-label={`管理 ${session.title}`} icon={<MoreHorizontalRegular />} /></Tooltip></MenuTrigger>
          <MenuPopover><MenuList>
            <MenuItem onClick={() => { setRenaming(session.id); setTitle(session.title); }}>重命名</MenuItem>
            <MenuItem onClick={() => onUpdateSession(session.id, { pinned: !session.pinned })}>{session.pinned ? "取消置顶" : "置顶"}</MenuItem>
            <MenuItem onClick={() => onUpdateSession(session.id, { lifecycle: archived ? "active" : "archived" })}>{archived ? "取消归档" : "归档并保留运行"}</MenuItem>
            {onExportSession ? <MenuItem onClick={() => onExportSession(session.id)}>导出可读内容</MenuItem> : null}
          </MenuList></MenuPopover></Menu> : null}
        {renaming === session.id ? <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onUpdateSession?.(session.id, { title: title.trim(), titleSource: "user" }); setRenaming(undefined); }}>
          <Input aria-label="会话名称" value={title} onChange={(_, data) => setTitle(data.value)} /><Button type="submit">保存名称</Button>
        </form> : null}
      </li>)}
    </ul>}
  </div>;
}

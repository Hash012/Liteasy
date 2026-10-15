import { redactDiagnostic } from "../context/objectContext";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import type { AssistantSessionHistoryItem } from "./assistantSessionHistory";

export type AssistantSessionActionsProps = {
  session: AssistantSessionHistoryItem;
  menuLabel?: string;
  onUpdateSession?: (id: string, patch: Partial<AssistantSessionHistoryItem>) => void;
  onDeleteSession?: (id: string) => void | Promise<void>;
  onRenameWithAI?: (id: string) => Promise<void>;
  onExportSession?: (id: string) => void | Promise<void>;
  onExpand?: () => void;
  onOpenSettings?: () => void;
};

/** The dialog and pending operation stay bound to the row's immutable session identity. */
export function AssistantSessionActions({ session, menuLabel, onUpdateSession, onDeleteSession, onRenameWithAI, onExportSession, onExpand, onOpenSettings }: AssistantSessionActionsProps) {
  const [dialog, setDialog] = useState<"rename" | "delete">();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [technical, setTechnical] = useState<string>();
  const running = session.status === "running";
  async function action(run: () => void | Promise<void>, failure: string) {
    if (pending) return;
    setPending(true); setError(undefined); setTechnical(undefined);
    try { await run(); setDialog(undefined); }
    catch (cause) { setError(failure); setTechnical(redactDiagnostic(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause))); }
    finally { setPending(false); }
  }
  return <div className="assistant-session-management">
    <Menu><MenuTrigger disableButtonEnhancement>
      <Tooltip content="管理对话" relationship="description"><Button appearance="subtle" size="small" aria-label={menuLabel ?? `管理 ${session.title}`} icon={<MoreHorizontalRegular />} /></Tooltip>
    </MenuTrigger><MenuPopover><MenuList>
      {onUpdateSession ? <MenuItem onClick={() => { setTitle(session.title); setError(undefined); setDialog("rename"); }}>重命名对话</MenuItem> : null}
      {onRenameWithAI && session.kind !== "artifact_generation" ? <MenuItem disabled={pending || running} onClick={() => { void action(() => onRenameWithAI(session.id), "AI 暂时无法生成标题，原名称已保留。请检查模型设置后重试。"); }}>AI 重命名对话</MenuItem> : null}
      {onExportSession ? <MenuItem disabled={pending} onClick={() => { void action(() => onExportSession(session.id), "对话导出失败，请重试。原内容仍保留。"); }}>导出对话</MenuItem> : null}
      {onUpdateSession ? <>
        <MenuItem onClick={() => onUpdateSession(session.id, { pinned: !session.pinned })}>{session.pinned ? "取消置顶" : "置顶"}</MenuItem>
        <MenuItem onClick={() => onUpdateSession(session.id, { lifecycle: session.lifecycle === "archived" ? "active" : "archived" })}>{session.lifecycle === "archived" ? "取消归档" : "归档并保留运行"}</MenuItem>
      </> : null}
      {onDeleteSession && session.kind !== "artifact_generation" ? <MenuItem disabled={running || pending} title={running ? "请先终止运行，再删除对话" : undefined} onClick={() => { setError(undefined); setDialog("delete"); }}>删除对话</MenuItem> : null}
      {onExpand ? <MenuItem onClick={onExpand}>在主区打开对话</MenuItem> : null}
      {onOpenSettings ? <MenuItem onClick={onOpenSettings}>对话设置</MenuItem> : null}
    </MenuList></MenuPopover></Menu>
    {pending ? <span className="assistant-session-action-status" role="status">正在处理…</span> : null}
    {error ? <div className="assistant-session-action-error" role="alert">{error}{technical ? <DisclosureSection title="错误技术详情"><pre>{technical}</pre></DisclosureSection> : null}</div> : null}
    <Dialog open={!!dialog} onOpenChange={(_, data) => { if (!data.open && !pending) setDialog(undefined); }}>
      <DialogSurface aria-label={dialog === "delete" ? "删除对话确认" : "重命名对话"}>
        <DialogBody><DialogTitle>{dialog === "delete" ? "删除这段对话？" : "重命名对话"}</DialogTitle><DialogContent>
          {dialog === "delete" ? <p>“{session.title}”将从对话列表中移除。关联的资料与任务结果会保留。</p> : <Input autoFocus aria-label="会话名称" value={title} maxLength={120} onChange={(_, data) => setTitle(data.value)} onKeyDown={event => { if (event.key === "Enter" && title.trim()) { event.preventDefault(); onUpdateSession?.(session.id, { title: title.trim(), titleSource: "user" }); setDialog(undefined); } }} />}
        </DialogContent><DialogActions>
          <Button disabled={pending} onClick={() => setDialog(undefined)}>取消</Button>
          <Button appearance="primary" disabled={pending || dialog === "rename" && !title.trim()} onClick={() => {
            if (dialog === "delete") void action(() => onDeleteSession?.(session.id), "对话暂未删除，请重试。");
            else { onUpdateSession?.(session.id, { title: title.trim(), titleSource: "user" }); setDialog(undefined); }
          }}>{dialog === "delete" ? "删除对话" : "保存名称"}</Button>
        </DialogActions></DialogBody>
      </DialogSurface>
    </Dialog>
  </div>;
}

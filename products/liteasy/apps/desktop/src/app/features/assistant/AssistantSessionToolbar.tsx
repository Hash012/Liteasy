import type { DragEventHandler } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, ComposeRegular, DocumentRegular, SettingsRegular, StopRegular } from "@fluentui/react-icons";

type Props = {
  title: string;
  kind: "conversation" | "artifact_generation";
  historyOpen: boolean;
  running: boolean;
  cancelling: boolean;
  newSessionDisabled: boolean;
  onToggleHistory(): void;
  onNewSession(): void;
  onCancel(): void;
  onOpenArtifact?: () => void;
  onOpenSettings?: () => void;
  onDragStart: DragEventHandler<HTMLDivElement>;
};

export function AssistantSessionToolbar(props: Props) {
  return <div className="assistant-session-toolbar" role="group" aria-label="对话顶栏">
    <Tooltip content={props.historyOpen ? "返回当前对话" : "查看历史会话"} positioning="below" relationship="description">
      <Button appearance="subtle" className="assistant-toolbar-button" aria-label={props.historyOpen ? "隐藏历史" : "历史"}
        aria-expanded={props.historyOpen} title={props.historyOpen ? "返回当前对话" : "查看历史会话"}
        icon={props.historyOpen ? <ArrowRightRegular /> : <ArrowLeftRegular />} onClick={props.onToggleHistory} />
    </Tooltip>
    <div className="assistant-active-session" aria-label="当前会话" data-session-kind={props.kind} draggable onDragStart={props.onDragStart}>
      <Tooltip content={props.title} relationship="description">
        <span className="assistant-active-session-title" tabIndex={0}>{props.title}</span>
      </Tooltip>
    </div>
    <div aria-label="会话操作" className="assistant-session-actions">
      {props.onOpenArtifact ? <Tooltip content="打开产物" positioning="below" relationship="description">
        <Button appearance="subtle" className="assistant-toolbar-button" aria-label="打开产物" icon={<DocumentRegular />} onClick={props.onOpenArtifact} />
      </Tooltip> : null}
      {props.running ? <Tooltip content={props.cancelling ? "正在终止 AI 运行" : "终止当前 AI 运行"} positioning="below" relationship="description">
        <Button appearance="subtle" className="assistant-toolbar-button danger" aria-label={props.cancelling ? "终止中" : "终止"}
          disabled={props.cancelling} icon={<StopRegular />} onClick={props.onCancel} />
      </Tooltip> : null}
      {props.onOpenSettings ? <Tooltip content="打开设置" positioning="below" relationship="description">
        <Button appearance="subtle" className="assistant-toolbar-button" aria-label="对话设置" icon={<SettingsRegular />} onClick={props.onOpenSettings} />
      </Tooltip> : null}
      <Tooltip content="新建对话" positioning="below" relationship="description">
        <Button appearance="subtle" className="assistant-toolbar-button" aria-label="新建" title="开始一个新的 AI 对话"
          disabled={props.newSessionDisabled} icon={<ComposeRegular />} onClick={props.onNewSession} />
      </Tooltip>
    </div>
  </div>;
}

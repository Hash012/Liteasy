import { Button, Tooltip } from "@fluentui/react-components";
import { CopyRegular, HighlightRegular, TextUnderlineRegular, WhiteboardRegular, ChatRegular, SparkleRegular } from "@fluentui/react-icons";
import type { DragEventHandler } from "react";
export function PaperSelectionTools(props: { disabled?: boolean; highlight(): void; underline(): void; copy(): void;
  board?: () => void; tray?: () => void; conversation?: () => void; quickAsk?: () => void; dragBoard?: DragEventHandler<HTMLButtonElement> }) {
  return <div className="paper-selection-tools" role="toolbar" aria-label="选段工具">
    <Tooltip content="高亮选中文段" relationship="description"><Button disabled={props.disabled} icon={<HighlightRegular />} onClick={props.highlight}>高亮</Button></Tooltip>
    <Tooltip content="给选中文段添加下划线" relationship="description"><Button disabled={props.disabled} icon={<TextUnderlineRegular />} onClick={props.underline}>划线</Button></Tooltip>
    <Tooltip content="复制选中的内容" relationship="description"><Button disabled={props.disabled} icon={<CopyRegular />} onClick={props.copy}>复制</Button></Tooltip>
    {props.board ? <Tooltip content="加入白板，也可拖动摘录" relationship="description"><Button disabled={props.disabled} icon={<WhiteboardRegular />} draggable={Boolean(props.dragBoard)} onDragStart={props.dragBoard} onClick={props.board}>加入白板</Button></Tooltip> : null}
    {props.tray ? <Button disabled={props.disabled} onClick={props.tray}>加入摘录对话</Button> : null}
    {props.quickAsk ? <Tooltip content="结合当前页和摘要提问" relationship="description"><Button disabled={props.disabled} icon={<SparkleRegular />} onClick={props.quickAsk}>速问</Button></Tooltip> : null}
    {props.conversation ? <Button disabled={props.disabled} icon={<ChatRegular />} onClick={props.conversation}>加入对话</Button> : null}
  </div>;
}

import { Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, CopyRegular, HighlightRegular, TextUnderlineRegular, WhiteboardRegular, ChatRegular, SparkleRegular, TextQuoteRegular } from "@fluentui/react-icons";
import type { DragEventHandler, ReactNode } from "react";
import { getHighlightColor } from "./pdfAnnotationAppearance";
import type { PdfHighlightColor } from "./pdfAnnotationStorage";
import "./paperSelectionTools.css";

const highlightColors: { value: PdfHighlightColor; label: string }[] = [
  { value: "yellow", label: "黄色" }, { value: "red", label: "红色" },
  { value: "blue", label: "蓝色" }, { value: "green", label: "绿色" },
  { value: "pink", label: "粉色" }
];

export function PaperSelectionTools(props: {
  extensionActions?: ReactNode;
  disabled?: boolean;
  highlight(): void;
  underline(): void;
  copy(): void;
  color?: PdfHighlightColor;
  onColorChange?: (color: PdfHighlightColor) => void;
  board?: () => void;
  tray?: () => void;
  conversation?: () => void;
  quickAsk?: () => void;
  dragBoard?: DragEventHandler<HTMLButtonElement>;
}) {
  return <div className="paper-selection-tools" role="toolbar" aria-label="选段工具">
    {props.onColorChange ? <div className="paper-selection-colors" role="group" aria-label="标记颜色">
      <span>标记颜色</span>
      <div className="paper-selection-swatches">
        {highlightColors.map(({ value, label }) => <Tooltip key={value} content={`选择${label}高亮`} relationship="description">
          <Button appearance="transparent" size="small" className="paper-selection-swatch"
            aria-label={`选择${label}高亮`} aria-pressed={props.color === value} disabled={props.disabled}
            style={{ backgroundColor: getHighlightColor(value) }} onClick={() => props.onColorChange?.(value)}
            icon={props.color === value ? <CheckmarkRegular /> : undefined} />
        </Tooltip>)}
      </div>
    </div> : null}
    <div className="paper-selection-primary" role="group" aria-label="标记与复制">
      <Tooltip content="高亮选中文段" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<HighlightRegular />} onClick={props.highlight}>高亮</Button></Tooltip>
      <Tooltip content="给选中文段添加下划线" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<TextUnderlineRegular />} onClick={props.underline}>划线</Button></Tooltip>
      <Tooltip content="复制选中的内容" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<CopyRegular />} onClick={props.copy}>复制</Button></Tooltip>
    </div>
    {props.board || props.tray || props.quickAsk || props.conversation ? <div className="paper-selection-destinations" role="group" aria-label="使用选段">
      {props.board ? <Tooltip content="加入白板，也可拖动摘录" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<WhiteboardRegular />} draggable={Boolean(props.dragBoard)} onDragStart={props.dragBoard} onClick={props.board}>加入白板</Button></Tooltip> : null}
      {props.tray ? <Tooltip content="收集选段后一起提问" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<TextQuoteRegular />} onClick={props.tray}>加入摘录对话</Button></Tooltip> : null}
      {props.quickAsk ? <Tooltip content="结合当前页和摘要提问" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<SparkleRegular />} onClick={props.quickAsk}>速问</Button></Tooltip> : null}
      {props.conversation ? <Tooltip content="将选段加入 AI 对话上下文" relationship="description"><Button appearance="subtle" size="small" disabled={props.disabled} icon={<ChatRegular />} onClick={props.conversation}>加入对话</Button></Tooltip> : null}
    </div> : null}
    {props.extensionActions}
  </div>;
}

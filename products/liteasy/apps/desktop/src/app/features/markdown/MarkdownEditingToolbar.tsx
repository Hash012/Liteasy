import type { ReactElement, ReactNode } from "react";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from "@fluentui/react-components";
import {
  ArrowRedoRegular, ArrowUndoRegular, CodeRegular, ImageRegular, LinkRegular, LinkAddRegular, MoreHorizontalRegular,
  TableRegular, TextBoldRegular, TextBulletListLtrRegular, TextItalicRegular, TextNumberListLtrRegular,
  TextQuoteRegular, TextStrikethroughRegular,
} from "@fluentui/react-icons";
import type { MarkdownCommand } from "./markdownEditing";

type Action = { command: MarkdownCommand; label: string; icon?: ReactElement; shortcut?: string };
const inline: Action[] = [
  { command: "bold", label: "加粗", icon: <TextBoldRegular />, shortcut: "Ctrl/⌘ B" },
  { command: "italic", label: "斜体", icon: <TextItalicRegular />, shortcut: "Ctrl/⌘ I" },
  { command: "strike", label: "删除线", icon: <TextStrikethroughRegular /> },
  { command: "code", label: "行内代码", icon: <CodeRegular />, shortcut: "Ctrl/⌘ E" },
];
const structure: Action[] = [
  { command: "bullet", label: "无序列表", icon: <TextBulletListLtrRegular /> },
  { command: "numbered", label: "有序列表", icon: <TextNumberListLtrRegular /> },
  { command: "quote", label: "引用", icon: <TextQuoteRegular /> },
];
const insert: Action[] = [
  { command: "link", label: "插入链接", icon: <LinkRegular />, shortcut: "Ctrl/⌘ K" },
  { command: "image", label: "插入图片链接", icon: <ImageRegular /> },
  { command: "table", label: "插入表格", icon: <TableRegular /> },
];
const more: Action[] = [
  { command: "task", label: "任务列表" },
  { command: "code-block", label: "代码块" },
  { command: "math", label: "行内公式" },
  { command: "math-block", label: "独立公式" },
  { command: "diagram", label: "Mermaid 图示" },
  { command: "divider", label: "分隔线" },
  { command: "indent", label: "增加缩进" },
  { command: "outdent", label: "减少缩进" },
];

export function MarkdownEditingToolbar({ execute, undo, redo, canUndo, canRedo, insertReference }: {
  execute(command: MarkdownCommand): void; undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  insertReference?(): void;
}) {
  const button = (label: string, icon: ReactElement | undefined, action: () => void, disabled = false, hint = label) =>
    <Tooltip key={label} content={hint} relationship="description"><Button size="small" appearance="subtle" icon={icon}
      aria-label={label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={action} /></Tooltip>;
  const menu = (label: string, content: ReactNode, items: Action[]) => <Menu>
    <MenuTrigger disableButtonEnhancement><Tooltip content={label} relationship="description">
      <Button size="small" appearance="subtle" aria-label={label}>{content}</Button>
    </Tooltip></MenuTrigger>
    <MenuPopover><MenuList>{items.map((item) => <MenuItem key={item.command} icon={item.icon} onClick={() => execute(item.command)}>{item.label}</MenuItem>)}</MenuList></MenuPopover>
  </Menu>;
  return <div className="markdown-editing-toolbar" role="group" aria-label="Markdown 编辑工具栏">
    <div className="markdown-editing-group" role="group" aria-label="编辑历史">
      {button("撤销", <ArrowUndoRegular />, undo, !canUndo, "撤销 · Ctrl/⌘ Z")}
      {button("重做", <ArrowRedoRegular />, redo, !canRedo, "重做 · Ctrl/⌘ Shift Z")}
    </div>
    <div className="markdown-editing-group" role="group" aria-label="文本格式">
      {menu("标题与正文", <>正文 / 标题</>, [
        { command: "paragraph", label: "正文" },
        ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ command: `heading-${level}` as const, label: `${level} 级标题` })),
      ])}
      {inline.map((item) => button(item.label, item.icon, () => execute(item.command), false, item.shortcut ? `${item.label} · ${item.shortcut}` : item.label))}
    </div>
    <div className="markdown-editing-group" role="group" aria-label="段落格式">
      {structure.map((item) => button(item.label, item.icon, () => execute(item.command)))}
    </div>
    <div className="markdown-editing-group" role="group" aria-label="插入内容">
      {insert.map((item) => button(item.label, item.icon, () => execute(item.command), false, item.shortcut ? `${item.label} · ${item.shortcut}` : item.label))}
      {insertReference ? button("插入文件引用", <LinkAddRegular />, insertReference, false, "插入文件引用 · [[") : null}
      {menu("更多 Markdown 工具", <MoreHorizontalRegular />, more)}
    </div>
  </div>;
}

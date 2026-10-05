import { message } from "../../shared/i18n/i18n";
export const workbenchCommands = [
  { id: "global-search", get title() { return message("commands.globalSearch.title"); }, get description() { return message("commands.globalSearch.description"); }, key: "f", shift: true, alt: false, keys: ["Mod", "Shift", "F"], search: "search find 搜索 查找 全文 全局" },
  { id: "open-file", get title() { return message("commands.openFile.title"); }, get description() { return message("commands.openFile.description"); }, key: "o", shift: false, alt: false, keys: ["Mod", "O"], search: "open pdf epub book 打开 本地 原文件 电子书" },
  { id: "open-note", get title() { return message("commands.openNote.title"); }, get description() { return message("commands.openNote.description"); }, key: "o", shift: false, alt: true, keys: ["Mod", "Alt", "O"], search: "open markdown note 打开 本地 原文件 笔记" },
  { id: "open-folder", get title() { return message("commands.openFolder.title"); }, get description() { return message("commands.openFolder.description"); }, key: "o", shift: true, alt: false, keys: ["Mod", "Shift", "O"], search: "open folder vault 文件夹 目录 连接 引用" },
  { id: "page-history", get title() { return message("commands.history.title"); }, get description() { return message("commands.history.description"); }, key: "h", shift: false, alt: false, keys: ["Mod", "H"], search: "history recent 历史 页面 回溯" },
  { id: "preset-reading", get title() { return message("commands.reading.title"); }, get description() { return message("commands.reading.description"); }, key: "", shift: false, alt: false, keys: [], search: "read preset 专注 阅读 布局" },
  { id: "preset-research", get title() { return message("commands.research.title"); }, get description() { return message("commands.research.description"); }, key: "", shift: false, alt: false, keys: [], search: "research preset 研究 布局" },
  { id: "preset-processing", get title() { return message("commands.processing.title"); }, get description() { return message("commands.processing.description"); }, key: "", shift: false, alt: false, keys: [], search: "processing preset 处理 布局 工作流 运行 任务" },
  { id: "preset-custom", get title() { return message("commands.custom.title"); }, get description() { return message("commands.custom.description"); }, key: "", shift: false, alt: false, keys: [], search: "custom layout 自定义 布局 恢复" },
  { id: "library", get title() { return message("commands.library.title"); }, get description() { return message("commands.library.description"); }, key: "l", shift: true, alt: false, keys: ["Mod", "Shift", "L"], search: "library import files 文献 导入 阅读 文件" },
  { id: "assistant", get title() { return message("commands.assistant.title"); }, get description() { return message("commands.assistant.description"); }, key: "i", shift: false, alt: true, keys: ["Mod", "Alt", "I"], search: "chat agent assistant 人工智能 助手 聊天" },
  { id: "settings", get title() { return message("commands.settings.title"); }, get description() { return message("commands.settings.description"); }, key: ",", shift: false, alt: false, keys: ["Mod", ","], search: "settings preferences theme 设置 主题 模型" },
  { id: "help", get title() { return message("commands.help.title"); }, get description() { return message("commands.help.description"); }, key: "F1", shift: false, alt: false, keys: ["F1"], search: "help guide 手册 帮助 快捷键" },
  { id: "active-pages", get title() { return message("commands.pages.title"); }, get description() { return message("commands.pages.description"); }, key: "t", shift: false, alt: false, keys: ["Mod", "T"], search: "tabs pages 活跃 页面 切换" },
  { id: "commands", get title() { return message("commands.all.title"); }, get description() { return message("commands.all.description"); }, key: "p", shift: true, alt: false, keys: ["Mod", "Shift", "P"], search: "commands shortcuts 命令 快捷键" }
] as const;

export type WorkbenchCommandId = typeof workbenchCommands[number]["id"];
export function isMacKeyboard() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
}
export function commandKeys(id: WorkbenchCommandId, mac = isMacKeyboard()) {
  return workbenchCommands.find((command) => command.id === id)!.keys.map((key) => key === "Mod" ? mac ? "⌘" : "Ctrl" : key === "Alt" && mac ? "Option" : key);
}
export function commandShortcut(id: WorkbenchCommandId) { return commandKeys(id).join(" + "); }
export function matchWorkbenchShortcut(event: KeyboardEvent, mac = isMacKeyboard()): WorkbenchCommandId | undefined {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.getModifierState("AltGraph")) return;
  return workbenchCommands.find((command) => {
    if (!command.key) return false;
    const modifier = command.id === "help" ? !event.ctrlKey && !event.metaKey
      : mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const keyMatches = event.key.toLowerCase() === command.key.toLowerCase() ||
      (/^[a-z]$/.test(command.key) && event.code === `Key${command.key.toUpperCase()}`);
    return modifier && event.altKey === command.alt && event.shiftKey === command.shift && keyMatches;
  })?.id;
}

export type WorkbenchCommandAvailability = Partial<Record<WorkbenchCommandId, string>>;

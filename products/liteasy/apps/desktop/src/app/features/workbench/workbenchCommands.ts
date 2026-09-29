export const workbenchCommands = [
  { id: "library", title: "打开文献库", description: "导入 PDF、电子书或笔记，双击文件开始阅读。", key: "l", shift: true, alt: false, keys: ["Mod", "Shift", "L"], search: "library import files 文献 导入 阅读 文件" },
  { id: "assistant", title: "开始 AI 对话", description: "打开 AI 栏，选择模型，输入你的第一条消息。", key: "i", shift: false, alt: true, keys: ["Mod", "Alt", "I"], search: "chat agent assistant 人工智能 助手 聊天" },
  { id: "settings", title: "打开设置", description: "配置模型 API、数据保存路径和浅色或深色外观。", key: ",", shift: false, alt: false, keys: ["Mod", ","], search: "settings preferences theme 设置 主题 模型" },
  { id: "help", title: "查看使用指南", description: "了解文件整理、论文阅读与 AI 分析的基础操作。", key: "F1", shift: false, alt: false, keys: ["F1"], search: "help guide 手册 帮助 快捷键" },
  { id: "page-history", title: "回溯历史页面", description: "按访问时间查看页面，用方向键选择并按 Enter 打开。", key: "h", shift: false, alt: false, keys: ["Mod", "H"], search: "history recent 历史 页面 回溯" },
  { id: "active-pages", title: "切换活跃页面", description: "查看所有已打开页面，用方向键快速切换。", key: "t", shift: false, alt: false, keys: ["Mod", "T"], search: "tabs pages 活跃 页面 切换" },
  { id: "commands", title: "查看全部快捷操作", description: "搜索常用功能，或查看对应快捷键。", key: "p", shift: true, alt: false, keys: ["Mod", "Shift", "P"], search: "commands shortcuts 命令 快捷键" }
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
    const modifier = command.id === "help" ? !event.ctrlKey && !event.metaKey
      : mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const keyMatches = event.key.toLowerCase() === command.key.toLowerCase() ||
      (/^[a-z]$/.test(command.key) && event.code === `Key${command.key.toUpperCase()}`);
    return modifier && event.altKey === command.alt && event.shiftKey === command.shift && keyMatches;
  })?.id;
}

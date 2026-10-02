export const workbenchCommands = [
  { id: "open-note", title: "打开 Markdown 原文件", description: "选择本地笔记，直接阅读原位置文件；编辑后保存回原文件。", key: "o", shift: false, alt: false, keys: ["Mod", "O"], search: "open markdown note 打开 本地 原文件 笔记" },
  { id: "open-folder", title: "连接笔记文件夹", description: "在原位置引用文件夹，保留目录层级；不复制或上传内容。", key: "o", shift: true, alt: false, keys: ["Mod", "Shift", "O"], search: "open folder vault 文件夹 目录 连接 引用" },
  { id: "page-history", title: "回溯历史页面", description: "按访问时间查看页面，用方向键选择并按 Enter 打开。", key: "h", shift: false, alt: false, keys: ["Mod", "H"], search: "history recent 历史 页面 回溯" },
  { id: "preset-reading", title: "阅读布局", description: "收起周边面板，保留中央内容与所有已打开页面。", key: "", shift: false, alt: false, keys: [], search: "read preset 专注 阅读 布局" },
  { id: "preset-research", title: "研究布局", description: "展开文献库和对话工具，保留你的面板位置与宽度。", key: "", shift: false, alt: false, keys: [], search: "research preset 研究 布局" },
  { id: "preset-processing", title: "处理布局", description: "打开运行记录，查看现有工作流任务；不会启动任务。", key: "", shift: false, alt: false, keys: [], search: "processing preset 处理 布局 工作流 运行 任务" },
  { id: "preset-custom", title: "恢复自定义布局", description: "恢复本次切换预设前的面板展开状态。", key: "", shift: false, alt: false, keys: [], search: "custom layout 自定义 布局 恢复" },
  { id: "library", title: "打开文献库", description: "复制导入 PDF、电子书等资料，双击文件开始阅读。", key: "l", shift: true, alt: false, keys: ["Mod", "Shift", "L"], search: "library import files 文献 导入 阅读 文件" },
  { id: "assistant", title: "开始 AI 对话", description: "打开 AI 栏，选择模型，输入你的第一条消息。", key: "i", shift: false, alt: true, keys: ["Mod", "Alt", "I"], search: "chat agent assistant 人工智能 助手 聊天" },
  { id: "settings", title: "打开设置", description: "配置模型 API、数据保存路径和浅色或深色外观。", key: ",", shift: false, alt: false, keys: ["Mod", ","], search: "settings preferences theme 设置 主题 模型" },
  { id: "help", title: "查看使用指南", description: "了解文件整理、论文阅读与 AI 分析的基础操作。", key: "F1", shift: false, alt: false, keys: ["F1"], search: "help guide 手册 帮助 快捷键" },
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
    if (!command.key) return false;
    const modifier = command.id === "help" ? !event.ctrlKey && !event.metaKey
      : mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const keyMatches = event.key.toLowerCase() === command.key.toLowerCase() ||
      (/^[a-z]$/.test(command.key) && event.code === `Key${command.key.toUpperCase()}`);
    return modifier && event.altKey === command.alt && event.shiftKey === command.shift && keyMatches;
  })?.id;
}

export type WorkbenchCommandAvailability = Partial<Record<WorkbenchCommandId, string>>;

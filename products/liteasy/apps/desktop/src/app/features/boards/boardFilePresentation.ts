import type { BoardFileBinding } from "./boardFileFormat";

export function boardFileDisplayName(board: { title: string } | undefined, binding?: BoardFileBinding) {
  return binding?.locationKind === "external" ? binding.name : board?.title || "白板（名称待恢复）";
}

export function boardFileLocationLabel(binding?: BoardFileBinding) {
  return binding?.locationKind === "managed" ? "保存在本机"
    : binding?.locationKind === "external" ? "外部文件" : "正在确认存储位置…";
}

// Only product-authored fixed messages can appear in the ordinary status area.
// Unknown native/I/O errors retain their full chain in the explicit diagnostics.
const readableMessages = new Set([
  "白板已变化，请重新选择后导出。", "白板在导出时发生变化，请重试。",
  "白板和外部文件都有修改。请先将当前白板另存为文件，再打开外部版本。",
  "已有同名白板文件尚未关联，请通过打开白板恢复，或另存为新文件；原文件未覆盖。",
  "外部文件已变化，请重新打开或另存为",
  "文件已在其他应用中修改，请重新打开后再保存；本次修改尚未写入。",
  "账号已切换。", "账号已切换，请重新打开笔记。", "请先创建白板。", "请选择一个白板文件。",
  "找不到已连接的文件夹，请重新连接。", "文件已移动或不可用。",
  "授权路径已移动或变为符号链接，请重新连接。", "连接的文件夹已移动，请重新连接。",
  "授权文件已变为符号链接，请重新选择。", "请选择此文件所在的 Vault 文件夹，以读取其中的引用。",
  "单个笔记文件不能超过 8 MB。", "目标文件夹不存在，请先创建文件夹。",
  "同名文件已存在，请重新选择文件名。", "此浏览器无法选择存储文件，请使用桌面应用。",
  "白板文件过大，请拆分后导入。", "白板文件不是有效的 JSON Canvas 文件。",
  "白板文件格式无效，请检查卡片和连接。", "白板包含重复的卡片编号。",
  "文字卡片缺少正文。", "文件卡片缺少路径。", "链接卡片缺少地址。",
  "白板连接指向不存在的卡片，或连接编号重复。",
]);
export function boardFileFailure(error: unknown): { summary: string; details: string } {
  const message = error instanceof Error ? error.message : String(error);
  const details: string[] = [];
  const seen = new Set<unknown>();
  let cause = error;
  while (cause && !seen.has(cause) && details.length < 8) {
    seen.add(cause);
    details.push(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    cause = cause instanceof Error ? (cause as Error & { cause?: unknown }).cause : undefined;
  }
  return {
    summary: readableMessages.has(message) ? message : "白板文件操作失败。请检查文件是否仍可访问，然后重试；也可以另存为保留当前内容。",
    details: details.join("\n\n原因：\n"),
  };
}

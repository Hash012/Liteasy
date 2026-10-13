/** Limits count UTF-16 code units, matching HTML input and the existing 4,000-unit prompt limit. */
export const QUICK_ASK_INSTRUCTION_LIMIT = 4000;
export const QUICK_ASK_PRESET_SCHEMA = "liteasy.quick-ask-preset/v1" as const;
export type QuickAskPresetSettingKey = "ai.quickAsk.presets" | "ai.quickAsk.lastPresetId";
export type QuickAskPreset = {
  schema: typeof QUICK_ASK_PRESET_SCHEMA;
  id: string; scopeId: string; revision: string; name: string; instruction: string;
  builtIn: boolean; owned: boolean; pinned: boolean; order: number; createdAt: string; updatedAt: string;
};
export const quickAskBuiltInTasks = [
  { id: "explain", name: "讲清楚", action: "解释选段", instruction: "先用一句话概括选段，再解释理解它所必需的因果与术语，避免无关的长篇展开。" },
  { id: "example", name: "举个例子", action: "用例子解释", instruction: "用一个具体的小案例解释选段中的机制，并明确指出案例或类比的适用边界。" },
  { id: "derive", name: "拆解推导", action: "拆解推导", instruction: "逐步拆解选段中的推理或推导，列出已知条件、符号含义和中间步骤。缺少前提时明确指出，不编造假设或推导。" },
  { id: "translate", name: "翻译", action: "翻译选段", instruction: "将选中文段翻译为当前界面语言，保留公式、符号与专有名词。仅翻译选段，不翻译背景资料，不增加原文没有的内容。" },
] as const;
export function builtInQuickAskPresets(scopeId: string): QuickAskPreset[] {
  return quickAskBuiltInTasks.map((task, order) => ({ schema: QUICK_ASK_PRESET_SCHEMA, id: task.id, scopeId, revision: "builtin-v1", name: task.name, instruction: task.instruction,
    builtIn: true, owned: false, pinned: true, order, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z" }));
}
export function validateQuickAskInstruction(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > QUICK_ASK_INSTRUCTION_LIMIT) throw new Error("指令最多 4,000 个 UTF-16 字符；请缩短后再保存或发送，原文已保留。");
}
export function resolveQuickAskInstruction(customInstruction: string, preset?: Pick<QuickAskPreset, "instruction">): string {
  validateQuickAskInstruction(customInstruction);
  const value = customInstruction.trim() || preset?.instruction || quickAskBuiltInTasks[0].instruction;
  validateQuickAskInstruction(value);
  return value;
}
export function quickAskPrimaryAction(customInstruction: string, preset?: Pick<QuickAskPreset, "id" | "name">) {
  return customInstruction.trim() ? "发送" : quickAskBuiltInTasks.find(task => task.id === preset?.id)?.action ?? (preset ? `使用${preset.name}` : "解释选段");
}
export function validateQuickAskPreset(value: unknown): QuickAskPreset {
  if (!value || typeof value !== "object") throw new Error("快捷指令格式无效。");
  const item = value as QuickAskPreset;
  if (item.schema !== QUICK_ASK_PRESET_SCHEMA) throw new Error("不支持的快捷指令版本；原始内容未修改。");
  if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id) || typeof item.scopeId !== "string" || !item.scopeId || item.scopeId.length > 2048 ||
    typeof item.revision !== "string" || !item.revision || item.revision.length > 128 || typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 ||
    typeof item.builtIn !== "boolean" || typeof item.owned !== "boolean" || item.owned === item.builtIn || typeof item.pinned !== "boolean" || !Number.isSafeInteger(item.order) || item.order < 0 ||
    ![item.createdAt, item.updatedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date)))) throw new Error("快捷指令字段无效。");
  validateQuickAskInstruction(item.instruction);
  if (!item.instruction.trim()) throw new Error("请填写快捷指令正文。");
  return { schema: item.schema, id: item.id, scopeId: item.scopeId, revision: item.revision, name: item.name, instruction: item.instruction,
    builtIn: item.builtIn, owned: item.owned, pinned: item.pinned, order: item.order, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

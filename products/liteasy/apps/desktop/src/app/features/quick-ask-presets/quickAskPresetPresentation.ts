import type { QuickAskPreset } from "./quickAskPresets";

/** Names describe the instruction; identity is retained only in the option value. */
export function quickAskPresetOptions(presets: readonly QuickAskPreset[]) {
  return presets.map((preset) => {
    const peers = presets.filter((item) => item.name === preset.name)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const summary = preset.instruction.trim().replace(/\s+/g, " ").slice(0, 36);
    return {
      value: preset.id,
      label: peers.length > 1 ? `${preset.name} · ${summary}（${peers.indexOf(preset) + 1}）` : preset.name,
      description: `${preset.builtIn ? "内置" : "个人"}${preset.pinned ? " · 已置顶" : ""}${preset.builtIn ? "" : ` · ${new Date(preset.updatedAt).toLocaleDateString()}`}`,
    };
  });
}

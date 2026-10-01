import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { GenerationPromptEditor } from "../app/features/ai-prompts/GenerationPromptEditor";
import { GenerationPromptContext } from "../app/features/ai-prompts/GenerationPromptContext";
import { artifactPromptTask, generationPromptStyles, generationPromptTasks, getGenerationPrompt, presetGenerationPrompt, settingsWithGenerationPrompt } from "../app/features/ai-prompts/generationPrompts";
import { GenerationPromptSettingsPanel } from "../app/features/settings/GenerationPromptSettingsPanel";
import { createSettingsStore } from "../app/features/settings/settings.store";

afterEach(() => localStorage.clear());

test("keeps prompt text collapsed, fills every preset, permits edits and restores the global prompt", () => {
  function Harness() {
    const [value, setValue] = useState<string>();
    return <GenerationPromptContext.Provider value={{ "ai.prompts.thin_reading": "全局薄读偏好" }}>
      <GenerationPromptEditor task="thin_reading" value={value} onChange={setValue} />
    </GenerationPromptContext.Provider>;
  }
  render(<Harness />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "生成风格" }), { target: { value: "deep" } });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "自定义系统提示词" }));
  const editor = screen.getByRole("textbox", { name: "本次系统提示词" });
  for (const style of generationPromptStyles) {
    fireEvent.change(screen.getByRole("combobox", { name: "生成风格" }), { target: { value: style.id } });
    expect(editor).toHaveValue(presetGenerationPrompt("thin_reading", style.id));
  }
  fireEvent.change(editor, { target: { value: "用直觉解释，并关注假设" } });
  expect(screen.getByRole("combobox", { name: "生成风格" })).toHaveValue("custom");
  fireEvent.click(screen.getByRole("button", { name: "自定义系统提示词" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "自定义系统提示词" }));
  expect(screen.getByRole("textbox")).toHaveValue("用直觉解释，并关注假设");
  fireEvent.change(screen.getByRole("combobox", { name: "生成风格" }), { target: { value: "default" } });
  expect(screen.getByRole("textbox")).toHaveValue("全局薄读偏好");
});

test("saves per-task prompts across restarts and restores the built-in default", () => {
  const store = createSettingsStore();
  function Harness() {
    const [settings, setSettings] = useState({ ...store.getState() });
    return <GenerationPromptSettingsPanel settings={settings} onUpdateSetting={(command) => {
      store.apply(command); setSettings({ ...store.getState() });
    }} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole("combobox", { name: "提示词用途" }), { target: { value: "thin_reading" } });
  fireEvent.change(screen.getByRole("combobox", { name: "生成风格" }), { target: { value: "question" } });
  expect(createSettingsStore().getState()["ai.prompts.thin_reading"]).toBe(presetGenerationPrompt("thin_reading", "question"));
  expect(createSettingsStore().getState()["ai.prompts.selection_explanation"]).toBe(generationPromptTasks.selection_explanation.prompt);
  fireEvent.click(screen.getByRole("button", { name: "自定义系统提示词" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "关注推理与证据" } });
  expect(createSettingsStore().getState()["ai.prompts.thin_reading"]).toBe("关注推理与证据");
  fireEvent.change(screen.getByRole("combobox", { name: "生成风格" }), { target: { value: "default" } });
  expect(createSettingsStore().getState()["ai.prompts.thin_reading"]).toBe(generationPromptTasks.thin_reading.prompt);
});

test("uses built-in defaults for missing or corrupted preferences and bounds stored prompts", () => {
  localStorage.setItem("liteasy.generation-prompts.v1", "null");
  expect(getGenerationPrompt("tree", createSettingsStore().getState())).toBe(generationPromptTasks.tree.prompt);
  localStorage.setItem("liteasy.generation-prompts.v1", JSON.stringify({ "ai.prompts.tree": false, "ai.prompts.ppt": "a".repeat(5000) }));
  const store = createSettingsStore();
  expect(getGenerationPrompt("tree", store.getState())).toBe(generationPromptTasks.tree.prompt);
  expect(store.getState()["ai.prompts.ppt"]).toHaveLength(4000);
  expect(() => store.apply({ intent: "update_setting", target: "ai.prompts.tree", value: "a".repeat(4001) })).toThrow("4,000");
});

test("run overrides take precedence without changing saved settings or other tasks", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "ai.prompts.thin_reading", value: "全局偏好" });
  const settings = store.getState();
  const run = settingsWithGenerationPrompt(settings, "本次深入解释", "thin_reading");
  expect(getGenerationPrompt("thin_reading", run)).toBe("本次深入解释");
  expect(getGenerationPrompt("thin_reading", settings)).toBe("全局偏好");
  expect(getGenerationPrompt("ppt", run)).toBe(generationPromptTasks.ppt.prompt);
  expect(getGenerationPrompt("thin_reading", settings, "  ")).toBe("全局偏好");
  expect(settingsWithGenerationPrompt(settings)).toBe(settings);
  expect(artifactPromptTask("skill_doc")).toBe("assistant");
});

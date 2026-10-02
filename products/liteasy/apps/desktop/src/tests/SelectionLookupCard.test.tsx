import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { SelectionLookupCard } from "../app/features/selection-lookup/SelectionLookupCard";
import { SelectionLookupSettingsPanel } from "../app/features/selection-lookup/SelectionLookupSettingsPanel";
import { useSelectionLookupController } from "../app/controllers/useSelectionLookupController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";
import type { SelectionLookupRequest, SelectionLookupResult } from "../app/features/selection-lookup/selectionLookup.types";

const result: SelectionLookupResult = { text: "field", kind: "dictionary", service: "bing", sourceLabel: "必应词典", pronunciations: [],
  senses: [{ partOfSpeech: "n.", definition: "领域", example: "A research field." }, { definition: "场" }, { definition: "田野" }, { definition: "字段" }] };
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test("direct AI lookup sends a single minimal request and can save its Markdown explanation", async () => {
  const query = vi.fn(async (_request: SelectionLookupRequest) => ({ ...result, kind: "explanation" as const, sourceLabel: "AI 查词", senses: [], explanation: "**field**：领域。" }));
  const onSave = vi.fn(async () => {});
  render(<StrictMode><SelectionLookupCard lookup={{ query, autoQuery: true, translationUsesAi: true }} initialMode="explain"
    text="field" context="PRIVATE_SENTENCE" paperId="PRIVATE_ID" paperTitle="PRIVATE_PAPER" onClose={vi.fn()} onSave={onSave} /></StrictMode>);
  await screen.findByText("：领域。");
  expect(query).toHaveBeenCalledExactlyOnceWith({ text: "field", mode: "explain", signal: expect.any(AbortSignal) });
  await userEvent.click(screen.getByRole("button", { name: "保存为批注" }));
  expect(onSave).toHaveBeenCalledWith("**field**：领域。\n来源：AI 查词");
});

test("upgrades a dictionary result to AI lookup without forwarding the sentence or previous result", async () => {
  const query = vi.fn(async (request: SelectionLookupRequest) => request.mode === "explain"
    ? { ...result, kind: "explanation" as const, senses: [], explanation: "精简解释", sourceLabel: "AI 查词" } : result);
  render(<SelectionLookupCard lookup={{ query, autoQuery: false, translationUsesAi: true }} text="field" context="PRIVATE_SENTENCE" onClose={vi.fn()} />);
  await screen.findByText("领域");
  await userEvent.click(screen.getByRole("button", { name: "AI 查词", exact: true }));
  await screen.findByText("精简解释");
  expect(query.mock.calls[1][0]).toEqual({ text: "field", mode: "explain", signal: expect.any(AbortSignal) });
});

test("the real model gateway receives only a brief explanation prompt and the selected term", async () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "ai.prompts.selection_translation", value: "PRIVATE_TRANSLATION_PROMPT" });
  const modelTransport = vi.fn(async (_input: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({ answer: "正则化", execution: { mode: "live", provider: "openai" } }) }));
  const { result: hook } = renderHook(() => useSelectionLookupController({ getSettings: () => store.getState(), modelTransport }));
  await hook.current.query({ text: "regularization", mode: "explain", context: "PRIVATE_SENTENCE", paperTitle: "PRIVATE_PAPER", systemPrompt: "PRIVATE_OVERRIDE" });
  const body = JSON.parse(modelTransport.mock.calls[0][0].body);
  expect(body.prompt).toContain('待解释的词："regularization"');
  expect(body.prompt).not.toContain("PRIVATE_");
  expect(body.prompt.length).toBeLessThan(500);
  expect(Object.keys(body).sort()).toEqual(["model", "prompt", "provider", "requireLive", "source"]);
});

test("shows compact senses and saves the full result through the supplied annotation action", async () => {
  const query = vi.fn(async () => result), onSave = vi.fn(async () => {}), onExplain = vi.fn();
  render(<SelectionLookupCard lookup={{ query, autoQuery: false, translationUsesAi: true }} text="field" onClose={vi.fn()} onSave={onSave} onExplain={onExplain} />);
  expect(await screen.findByText("领域")).toBeVisible();
  expect(screen.queryByText("字段")).not.toBeInTheDocument();
  expect(screen.queryByText("A research field.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "更多释义与例句" }));
  expect(screen.getByText("字段")).toBeVisible();
  expect(screen.getByText("A research field.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "保存为批注" }));
  expect(onSave).toHaveBeenCalledWith(expect.stringContaining("来源：必应词典"));
  await userEvent.click(screen.getByRole("button", { name: "结合本句解释" }));
  expect(onExplain).toHaveBeenCalledTimes(1);
});

test("confirms AI translation with a preset and per-run prompt after a missing dictionary entry", async () => {
  const query = vi.fn(async (_request: SelectionLookupRequest) => ({ ...result, kind: "missing" as const, senses: [] }));
  render(<SelectionLookupCard lookup={{ query, autoQuery: true, translationUsesAi: true }} text="field" context="A research field." onClose={vi.fn()} />);
  await screen.findByText("未找到词典释义，可翻译这个选段。");
  expect(query.mock.calls[0][0]).toMatchObject({ mode: "auto", allowTranslation: false });
  expect(screen.queryByRole("textbox", { name: "本次系统提示词" })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "生成风格" }), "concise");
  await userEvent.click(screen.getByRole("button", { name: "自定义系统提示词" }));
  await userEvent.clear(screen.getByRole("textbox", { name: "本次系统提示词" }));
  await userEvent.type(screen.getByRole("textbox", { name: "本次系统提示词" }), "保留术语缩写");
  await userEvent.click(screen.getByRole("button", { name: "翻译选段", exact: true }));
  expect(query.mock.calls[1][0]).toMatchObject({ mode: "translate", allowTranslation: true, systemPrompt: "保留术语缩写", context: "A research field." });
});

test("aborts previous selections and does not display late results", async () => {
  let resolveOld!: (result: SelectionLookupResult) => void;
  const query = vi.fn(async (request: SelectionLookupRequest) => request.text === "field" ? new Promise<SelectionLookupResult>((resolve) => { resolveOld = resolve; }) : { ...result, text: request.text, senses: [{ definition: "当前结果" }] });
  const lookup = { query, autoQuery: false, translationUsesAi: true };
  const view = render(<SelectionLookupCard lookup={lookup} text="field" onClose={vi.fn()} />);
  await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  const signal = query.mock.calls[0][0].signal!;
  view.rerender(<SelectionLookupCard lookup={lookup} text="cell" onClose={vi.fn()} />);
  expect(signal.aborted).toBe(true);
  await screen.findByText("当前结果");
  await act(async () => resolveOld(result));
  expect(screen.queryByText("领域")).not.toBeInTheDocument();
  const current = query.mock.calls[1][0].signal!;
  view.unmount(); expect(current.aborted).toBe(true);
});

test("sends context and the selected prompt through the real model gateway without changing defaults", async () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "ai.prompts.selection_translation", value: "长期术语偏好" });
  const modelTransport = vi.fn(async (_input: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({ answer: "正则化", execution: { mode: "live", provider: "openai" } }) }));
  const { result: hook } = renderHook(() => useSelectionLookupController({ getSettings: () => store.getState(), modelTransport }));
  await hook.current.query({ text: "regularization", context: "We apply regularization.", paperTitle: "Paper title", mode: "translate", systemPrompt: "本次翻译偏好" });
  const prompt = JSON.parse(modelTransport.mock.calls[0][0].body).prompt;
  expect(prompt).toContain("We apply regularization."); expect(prompt).toContain("Paper title"); expect(prompt).toContain("本次翻译偏好");
  expect(prompt).not.toContain("长期术语偏好");
  expect(store.getState()["ai.prompts.selection_translation"]).toBe("长期术语偏好");
});

test("updates centralized lookup preferences while keeping connection details collapsed", async () => {
  const onUpdateSetting = vi.fn();
  const view = render(<SelectionLookupSettingsPanel onUpdateSetting={onUpdateSetting} />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "词典服务" }), "youdao");
  expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "lookup.dictionary_service", value: "youdao" });
  await userEvent.click(screen.getByRole("switch", { name: "自动查询选区" }));
  expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "lookup.auto_query", value: true });
  view.rerender(<SelectionLookupSettingsPanel onUpdateSetting={onUpdateSetting} settings={{ "lookup.translation_service": "libretranslate" }} />);
  expect(screen.getByLabelText("翻译服务密钥")).not.toBeVisible();
  await userEvent.click(screen.getByText("配置可选密钥"));
  const field = screen.getByLabelText("翻译服务密钥");
  await userEvent.type(field, "test-secret");
  await userEvent.click(screen.getByRole("button", { name: "保存翻译连接" }));
  await screen.findByText("翻译服务连接设置已保存。");
  expect(field).toHaveValue("");
  expect(onUpdateSetting).toHaveBeenLastCalledWith({ intent: "update_setting", target: "lookup.libretranslate_endpoint", value: "http://localhost:5000" });
  expect(JSON.stringify(localStorage)).not.toContain("test-secret");
});

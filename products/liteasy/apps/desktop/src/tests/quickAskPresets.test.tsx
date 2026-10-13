import "fake-indexeddb/auto";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { builtInQuickAskPresets, resolveQuickAskInstruction, quickAskPrimaryAction, validateQuickAskPreset } from "../app/features/quick-ask-presets/quickAskPresets";
import { QuickAskPresetManager } from "../app/features/quick-ask-presets/QuickAskPresetManager";
import { QuickAskPresetPicker } from "../app/features/quick-ask-presets/QuickAskPresetPicker";
import { useQuickAskPresets } from "../app/features/quick-ask-presets/useQuickAskPresets";
import { quickAskPresetResourceType } from "../app/features/quick-ask-presets/quickAskPresetResourceType";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { objectText } from "../app/features/objects/object.types";
import { renderDocumentHtml } from "../app/features/document-export/documentHtml";
import { getGenerationPrompt } from "../app/features/ai-prompts/generationPrompts";
import { settingsRegistry } from "../app/features/settings/settingsRegistry";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
const open = (scope = "account-a") => createSettingsStore().quickAsk(scope);

describe("Quick Ask presets settings owner", () => {
  test("four builtins provide deterministic zero-input tasks and custom replaces task intent", () => {
    const presets = builtInQuickAskPresets("a");
    expect(presets.map(item => item.id)).toEqual(["explain", "example", "derive", "translate"]);
    for (const preset of presets) expect(resolveQuickAskInstruction("  ", preset)).toBe(preset.instruction);
    expect(resolveQuickAskInstruction(" \n用中文推导 E=mc²\n ", presets[3])).toBe("用中文推导 E=mc²");
    expect(quickAskPrimaryAction("", presets[3])).toBe("翻译选段");
    expect(quickAskPrimaryAction("请推导", presets[3])).toBe("发送");
    expect(() => resolveQuickAskInstruction("🙂".repeat(2001))).toThrow("4,000");
  });
  test("typed settings projection, durable restart and account separation share one source", async () => {
    const store = createSettingsStore(); const repo = store.quickAsk("a");
    const receipt = await repo.save({ name: "我的例子", instruction: "保留 $x^2$ 和代码 <script>literal</script>" }, repo.read().revision);
    expect(receipt).toMatchObject({ preset: { builtIn: false, owned: true, scopeId: "a" } });
    expect(open("a").read().presets.find(item => item.id === receipt.preset?.id)?.instruction).toContain("<script>literal</script>");
    expect(open("b").read().presets).toHaveLength(4);
    expect(JSON.parse(store.getState()["ai.quickAsk.presets"]!).presets).toHaveLength(5);
    expect(settingsRegistry["ai.quickAsk.presets"].help).toBeTruthy();
    expect(() => createSeededSettingsStore(store.getState())).not.toThrow();
    expect(() => store.apply({ intent: "update_setting", target: "ai.quickAsk.presets", value: "{}" })).toThrow("按账号和版本");
  });
  test("CAS rejects concurrent stale edits and preserves original frozen snapshots", async () => {
    const a = open(); const b = open(); const revision = a.read().revision;
    const receipt = await a.save({ name: "One", instruction: "first" }, revision);
    await expect(b.save({ name: "Two", instruction: "second" }, revision)).rejects.toThrow("其他窗口");
    const frozen = { ...receipt.preset! };
    await a.save({ id: frozen.id, expectedRevision: frozen.revision, name: "Renamed", instruction: "updated" }, receipt.revision);
    expect(frozen.instruction).toBe("first");
    await expect(a.save({ id: frozen.id, expectedRevision: frozen.revision, name: "stale", instruction: "stale" }, a.read().revision)).rejects.toThrow("版本");
  });
  test("builtin edits copy, pin ceiling, reorder, rename/delete and successful-task memory", async () => {
    const repo = open(); const builtin = repo.read().presets[0];
    const receipt = await repo.save({ id: builtin.id, expectedRevision: builtin.revision, name: "My explain", instruction: "custom" }, repo.read().revision);
    const id = receipt.preset!.id;
    expect(id).not.toBe("explain"); expect(repo.read().presets[0]).toEqual(builtin);
    await expect(repo.setPinned(id, true, repo.read().revision)).rejects.toThrow("四个");
    await repo.setPinned("derive", false, repo.read().revision);
    await repo.setPinned(id, true, repo.read().revision);
    await repo.move(id, -1, repo.read().revision);
    expect(repo.read().presets.find(item => item.id === id)?.order).toBe(3);
    await repo.markCompleted(id, repo.read().revision);
    await repo.remove(id, repo.read().revision);
    expect(repo.read().lastPresetId).toBe(id);
    await expect(repo.remove("explain", repo.read().revision)).rejects.toThrow("内置");
  });
  test("runtime validation rejects unknown versions/oversize with no truncation or overwrite", async () => {
    const repo = open(); const before = repo.exportJson();
    expect(() => repo.save({ name: "long", instruction: "a".repeat(4001) }, repo.read().revision)).toThrow("4,000");
    expect(() => repo.importJson(before.replace("liteasy.quick-ask-settings/v1", "liteasy.quick-ask-settings/v99"), repo.read().revision)).toThrow("版本");
    expect(repo.exportJson()).toBe(before);
    expect(() => validateQuickAskPreset({ ...repo.read().presets[0], order: NaN })).toThrow("字段");
    const source = await repo.save({ name: "数学 code", instruction: "```js\nalert('plain text')\n```\n$α=β$" }, repo.read().revision);
    const other = open("b"); await other.importJson(repo.exportJson(), other.read().revision);
    const copied = other.read().presets.find(item => !item.builtIn)!;
    expect(copied.instruction).toBe(source.preset!.instruction); expect(copied.scopeId).toBe("b"); expect(copied.id).not.toBe(source.preset!.id);
    expect(copied.pinned).toBe(false);
  });
  test("legacy reply preferences stay verbatim and single native preset exports import as owned copies", async () => {
    const legacy = "旧偏好".repeat(1600); localStorage.setItem("liteasy.generation-prompts.v1", JSON.stringify({ "ai.prompts.selection_explanation": legacy }));
    expect(getGenerationPrompt("selection_explanation", createSettingsStore().getState())).toBe(legacy);
    const repo = open(); const saved = await repo.save({ name: "Native", instruction: "full source" }, repo.read().revision);
    const other = open("b"); await other.importJson(JSON.stringify(saved.preset), other.read().revision);
    expect(other.read().presets.find(item => !item.builtIn)).toMatchObject({ instruction: "full source", scopeId: "b", owned: true });
  });
  test("write failures never publish fake receipts and stale account operations reject", async () => {
    let active = true; const repo = createSettingsStore().quickAsk("a", () => active);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota failed"); });
    await expect(repo.save({ name: "Keep", instruction: "draft" }, "initial")).rejects.toThrow("quota");
    expect(repo.read().presets).toHaveLength(4);
    active = false; await expect(repo.markCompleted("translate", "initial")).rejects.toThrow("账号已切换");
  });
});

test("picker changes selection only, preserves custom draft and caps top actions at four", () => {
  const onSelect = vi.fn(), onUsePreset = vi.fn();
  const presets = [...builtInQuickAskPresets("a"), { ...builtInQuickAskPresets("a")[0], id: "custom", name: "My task", pinned: false, builtIn: false, owned: true }];
  render(<QuickAskPresetPicker presets={presets} selectedPresetId="explain" customInstruction="keep draft" onSelect={onSelect} onUsePreset={onUsePreset} />);
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  expect(onSelect).toHaveBeenCalledWith("translate"); expect(onUsePreset).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "速问任务" }).querySelectorAll("button")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "使用预设" })); expect(onUsePreset).toHaveBeenCalledOnce();
});

test("hook remembers only completed task, switches scopes, and reports deleted-task fallback", async () => {
  const { result, rerender } = renderHook(({ scopeId }) => useQuickAskPresets({ scopeId }), { initialProps: { scopeId: "a" } });
  act(() => result.current.selectPreset("translate")); expect(open("a").read().lastPresetId).toBe("explain");
  await act(() => result.current.markCompleted("translate")); expect(open("a").read().lastPresetId).toBe("translate");
  const stale = result.current.repository;
  rerender({ scopeId: "b" }); expect(result.current.selectedPreset.id).toBe("explain");
  expect(() => stale.read()).toThrow("账号已切换");
  const repo = open("b");
  await act(async () => { const saved = await repo.save({ name: "Removed", instruction: "hello" }, repo.read().revision); await repo.markCompleted(saved.preset!.id, repo.read().revision); await repo.remove(saved.preset!.id, repo.read().revision); });
  expect(result.current.selectedPreset.id).toBe("explain"); expect(result.current.fallbackNotice).toContain("不可用");
});

test("manager retains duplicate/failed-save draft, unknown import and shows durable receipt", async () => {
  const repo = open(); const onSaved = vi.fn();
  render(<QuickAskPresetManager repository={repo} initialInstruction="必须完整保留的草稿 $x$" onSaved={onSaved} />);
  fireEvent.change(screen.getByRole("textbox", { name: "快捷指令名称" }), { target: { value: "翻译" } });
  expect(screen.getByText("已有同名快捷指令，请修改名称以便区分。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存快捷指令" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /仍保留同名/ }));
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("存储空间不足"); });
  fireEvent.click(screen.getByRole("button", { name: "保存快捷指令" }));
  await screen.findByRole("alert"); expect(screen.getByRole("textbox", { name: "完整快捷指令" })).toHaveValue("必须完整保留的草稿 $x$");
  expect(onSaved).not.toHaveBeenCalled(); fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "保存快捷指令" })); await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(screen.getByText(/已保存 ·/)).toBeTruthy();
  fireEvent.click(screen.getByText("导入与导出"));
  fireEvent.change(screen.getByRole("textbox", { name: "待导入的快捷指令" }), { target: { value: '{"schema":"unknown"}' } });
  fireEvent.click(screen.getByRole("button", { name: "验证并导入为个人副本" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不支持"));
  expect(screen.getByRole("textbox", { name: "待导入的快捷指令" })).toHaveValue('{"schema":"unknown"}');
});

test("real resource registry reads canonical settings, native exports, pins context and rejects stale scope/revision", async () => {
  const scopeId = crypto.randomUUID(); let active = true;
  const settings = createSettingsStore().quickAsk(scopeId, () => active);
  const objects = createObjectRepository(createObjectStorage(scopeId, () => active ? scopeId : "other"), scopeId);
  const service = createWorkspaceAgentAssetService({ repository: objects, active: () => active, resourceTypes: [quickAskPresetResourceType({ settings, objects, active: () => active })] });
  const saved = await settings.save({ name: "Quoted task", instruction: "Plain <script>alert(1)</script>\n$E=mc^2$" }, settings.read().revision);
  const found = (await service.search({ query: "Quoted task" }))[0];
  expect((await service.read(found.path)).text).toContain(saved.preset!.instruction);
  expect(JSON.parse((await service.resourceFiles.read(found.path, { representation: "native", maxBytes: 10000 })).content)).toEqual(saved.preset);
  const context = await service.context(found.path); expect(objectText(await objects.get(context[0].ref))).toContain(saved.preset!.instruction);
  const document = await service.resourceTypes.compileExport(found.path, "html"); const html = renderDocumentHtml(document);
  expect(html).not.toContain("<script>alert(1)</script>"); expect(html).toContain("&lt;script&gt;");
  await settings.save({ id: saved.preset!.id, expectedRevision: saved.preset!.revision, name: "Changed", instruction: "new" }, settings.read().revision);
  await expect(service.read(found.path)).rejects.toThrow("版本");
  expect(objectText(await objects.get(context[0].ref))).toContain("Plain <script>");
  active = false; await expect(service.search({ query: "" })).rejects.toThrow("账号");
});

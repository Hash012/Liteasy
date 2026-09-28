import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { parseAssistantAssetWrites, mergeAssistantAssetWrites, parseSavedAssistantAssetWrites } from "../app/features/assistant/assistantAssetWrites";
import { AssistantMessageList } from "../app/features/assistant/AssistantMessageList";
import { AgentSettingsPanel } from "../app/features/agent-core/AgentSettingsPanel";

const receipt = { asset: { title: "CicN", path: "liteasy://objects/note-cicn?scope=local", revision: "r2" },
  changed: true, addedLines: 12, removedLines: 1 };

test("only renders valid saved write receipts and merges duplicate event/final-result receipts", () => {
  const parsed = parseAssistantAssetWrites([receipt, { ...receipt, addedLines: -1 }, { ...receipt, asset: { ...receipt.asset, path: "https://untrusted.example/" } }]);
  expect(parsed).toHaveLength(1);
  expect(mergeAssistantAssetWrites(parsed, parsed)).toHaveLength(1);
  expect(parseAssistantAssetWrites({ text: "I saved CicN" })).toBeUndefined();
  expect(parseSavedAssistantAssetWrites(parsed)).toEqual(parsed);
  expect(parseSavedAssistantAssetWrites([null, { path: false }])).toBeUndefined();
});

test("opens a saved asset from its actual write receipt", async () => {
  const open = vi.fn();
  render(<AssistantMessageList messages={[{ id: "saved", role: "assistant", content: "已保存要点。",
    assetWrites: parseAssistantAssetWrites([receipt]) }]} mode="qa" onModeChange={vi.fn()} onOpenAsset={open} />);
  expect(screen.getByLabelText("已保存的资产修改")).toHaveTextContent("已更新 CicN+12−1行");
  await userEvent.setup().click(screen.getByRole("button", { name: "查看" }));
  expect(open).toHaveBeenCalledWith(receipt.asset.path);
});

test("keeps existing custom context limits selectable and saves a new budget", async () => {
  const update = vi.fn();
  render(<AgentSettingsPanel settings={{ "assistant.context_window": "48000" }} onUpdateSetting={update} />);
  expect(screen.getByRole("combobox", { name: "Agent 上下文上限" })).toHaveValue("48000");
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Agent 上下文上限" }), "65536");
  expect(update).toHaveBeenCalledWith({ intent: "update_setting", target: "assistant.context_window", value: "65536" });
});

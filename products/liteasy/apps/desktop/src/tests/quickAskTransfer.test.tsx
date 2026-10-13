import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { createAssistantHistoryPersistence, parseAssistantHistory, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../app/features/assistant/assistantSessionHistory";
import { createQuickAskService } from "../app/features/pdf/quickAskService";
import { transferQuickAskToConversation } from "../app/features/pdf/quickAskTransfer";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { QuickAskGenerationReceipt } from "../app/features/pdf/pdfQuickAsk";
async function generateReceipt() {
  let receipt!: QuickAskGenerationReceipt;
  await createQuickAskService({ getSettings: () => createSettingsStore().getState(), modelTransport: async () => ({ ok: true, status: 200, json: async () => ({}), body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"completed","answer":"Synthetic quick answer"}\n')); controller.close(); } }) }) })
    .run({ paper: { id: "p", title: "Paper" }, page: 1, source: { scopeId: "local", paperId: "p", documentRevision: "r1", extractorRevision: "v1" }, excerpt: "Selected original", question: "Explain briefly", pageText: "Selected original", abstractText: "", signal: new AbortController().signal, onReceipt: value => { receipt = value; } });
  return receipt;
}

test("explicit transfer creates one separate destination, preserves the old draft and persists immutable source metadata", async () => {
  const initial: AssistantHistorySnapshot = { version: "liteasy.assistant-history/v1", activeSessionId: "old", sessions: [{ ...createAssistantSession({ id: "old" }), messages: [{ id: "old-question", role: "user", content: "Old conversation" }] }], draft: { input: "Old draft", tokens: [], readerContexts: [] } };
  const saved: AssistantHistorySnapshot[] = [];
  const persistence = createAssistantHistoryPersistence({ load: async () => initial, save: async snapshot => { saved.push(structuredClone(snapshot)); } });
  const onGenerate = vi.fn(() => "");
  const view = render(<AssistantSessionController selectedSetStatus={{ selectedCount: 0, importedCount: 0, selectionLocked: false }} onGenerateArtifact={onGenerate} historyPersistence={persistence} />);
  await screen.findByText("Old conversation");
  await waitFor(() => expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("Old draft"));
  const receipt = await generateReceipt();
  const transfer = { receipt, excerpt: "Selected original", answer: "Synthetic quick answer", paperTitle: "Paper" };
  let destination!: { conversationId: string };
  await act(async () => { destination = await transferQuickAskToConversation(transfer); });
  expect(await screen.findByText("Synthetic quick answer")).toBeInTheDocument();
  expect(screen.queryByText("Old conversation")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("");
  await act(async () => { expect(await transferQuickAskToConversation(transfer)).toEqual(destination); });
  const latest = saved.at(-1)!;
  expect(latest.sessions.filter(session => session.id === destination.conversationId)).toHaveLength(1);
  expect(latest.sessions.find(session => session.id === destination.conversationId)?.messages).toHaveLength(2);
  expect(latest.sessions.find(session => session.id === "old")?.draft?.input).toBe("Old draft");
  const restored = parseAssistantHistory(JSON.parse(JSON.stringify(latest)))!;
  expect(restored.sessions.find(session => session.id === destination.conversationId)?.messages[0].quickAskSource?.receipt.context.inputHash).toBe(receipt.context.inputHash);
  expect(onGenerate).not.toHaveBeenCalled();
  const incomplete = structuredClone(transfer); incomplete.receipt.terminal = "incomplete";
  await expect(transferQuickAskToConversation(incomplete)).rejects.toThrow("完成回执");
  const foreign = structuredClone(transfer); foreign.receipt.context.source.scopeId = "other-account";
  await expect(transferQuickAskToConversation(foreign)).rejects.toThrow("账号");
  view.unmount();
});

test("malformed or cross-scope saved transfer metadata is quarantined, never silently trusted", async () => {
  const receipt = await generateReceipt();
  const snapshot = { version: "liteasy.assistant-history/v1", activeSessionId: "target", sessions: [{ ...createAssistantSession({ id: "target" }), scopeId: "other-account", messages: [{ id: "source", role: "user", content: "keep historical text", quickAskSource: { receipt, excerpt: "Selected original", paperTitle: "Paper" } }] }], draft: { input: "", tokens: [], readerContexts: [] } };
  const parsed = parseAssistantHistory(snapshot)!;
  expect(parsed.sessions[0].messages[0].content).toBe("keep historical text");
  expect(parsed.sessions[0].messages[0].quickAskSource).toBeUndefined();
  expect(parsed.quarantined).toHaveLength(1);
});


test("account switch during the old-session save cannot transfer a late answer into the new scope", async () => {
  const receipt = await generateReceipt();
  let delayed = false; let finish!: () => void;
  const saved: AssistantHistorySnapshot[] = [];
  const persistence = createAssistantHistoryPersistence({ load: async () => ({ version: "liteasy.assistant-history/v1", activeSessionId: "old", sessions: [{ ...createAssistantSession({ id: "old" }), messages: [{ id: "question", role: "user", content: "Old account question" }] }], draft: { input: "", tokens: [], readerContexts: [] } }), save: async value => { if (delayed) await new Promise<void>(resolve => { finish = resolve; }); saved.push(value); } });
  const ui = (scopeId: string) => <ObjectWorkbenchContext.Provider value={{ scopeId } as never}><AssistantSessionController selectedSetStatus={{ selectedCount: 0, importedCount: 0, selectionLocked: false }} onGenerateArtifact={() => ""} historyPersistence={persistence} /></ObjectWorkbenchContext.Provider>;
  const view = render(ui("local"));
  await screen.findByText("Old account question");
  await waitFor(() => expect(saved.length).toBeGreaterThan(0));
  delayed = true;
  let pending!: Promise<unknown>;
  act(() => { pending = transferQuickAskToConversation({ paperTitle: "Paper", excerpt: "Selected original", answer: "late answer", receipt }); });
  const rejection = expect(pending).rejects.toThrow("账号");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(ui("other-account"));
  delayed = false;
  await act(async () => { finish(); await rejection; });
  expect(saved.flatMap(value => value.sessions).some(session => session.id.startsWith("quick-ask:"))).toBe(false);
  expect(screen.queryByText("late answer")).not.toBeInTheDocument();
  view.unmount();
});

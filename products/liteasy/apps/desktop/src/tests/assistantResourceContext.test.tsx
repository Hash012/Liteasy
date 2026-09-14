import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import { useObjectWorkbenchController, type ObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { makeObjectTransfer, writeObjectTransfer } from "../app/features/object-transfer/objectTransfer";
import { refOf } from "../app/features/objects/object.types";
import { createAssistantHistoryPersistence, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

test("chat sends dropped resources through the public context resolver and preserves draft references across remount", async () => {
  const scopeId = crypto.randomUUID();
  let workbench: ObjectWorkbenchController;
  let stored: AssistantHistorySnapshot | null = null;
  const history = createAssistantHistoryPersistence({ load: async () => stored, save: async (snapshot) => { stored = snapshot; } });
  const execute = vi.fn(async (input) => ({ message: `读到：${input.context.objectSnapshot.entries.map((entry: { text: string }) => entry.text).join("\n")}` }));
  const api = createAgentApplicationService({
    supportsObjectContext: true, getPrincipalId: () => scopeId,
    resolveContext: async ({ request }) => ({ objectSnapshot: await workbench.resolveContext(request) }),
    executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: execute,
  });
  const submit = vi.spyOn(api, "submitTurn");
  const client = createFrontendAgentClient(api);
  function Harness() {
    workbench = useObjectWorkbenchController({ scopeId, getApi: () => api, getPapers: () => [],
      getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() });
    return <ObjectWorkbenchContext.Provider value={workbench.port}>
      <AssistantPane agentClient={client} historyPersistence={history} onGenerateArtifact={() => "unused"}
        selectedSetStatus={{ selectedCount: 0, importedCount: 0, selectionLocked: false }} />
    </ObjectWorkbenchContext.Provider>;
  }
  const user = userEvent.setup();
  const first = render(<Harness />);
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  let note;
  await act(async () => { note = await workbench.repository.create({ kind: "content.note", title: "研究记录",
    content: { schema: "liteasy.note/v1", payload: { text: "这段是用户的真实笔记内容", origin: "user" } } }); });
  const data = new Map<string, string>();
  const transfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "",
    get types() { return [...data.keys()]; } } as unknown as DataTransfer;
  writeObjectTransfer(transfer, makeObjectTransfer([refOf(note!)]));
  fireEvent.drop(first.container.querySelector(".assistant-pane")!, { dataTransfer: transfer });
  expect(await screen.findByRole("button", { name: "移除上下文：研究记录" })).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "请审阅这段内容");
  await act(async () => { await history.flush(); });
  first.unmount();
  render(<Harness />);
  expect(await screen.findByRole("button", { name: "移除上下文：研究记录" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("请审阅这段内容"));
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0].contextRefs).toEqual([refOf(note!)]);
  expect(submit.mock.calls[0][0].attachments).toBeUndefined();
  expect(await screen.findByText("读到：这段是用户的真实笔记内容")).toBeInTheDocument();
  expect(workbench!.visible).toBe(false);
});

test("frontend forwards context references and purpose without converting them to untrusted prompt text", async () => {
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    resolveContext: () => ({}), executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async () => ({ message: "test" }),
  });
  const submit = vi.spyOn(api, "submitTurn");
  const client = createFrontendAgentClient(api);
  await client.send({ mode: "qa", message: "review" }, {
    contextRefs: [{ objectId: "object-id", revision: "fixed-version" }], contextPurpose: "审阅所选内容",
  });
  expect(submit.mock.calls[0][0]).toMatchObject({ contextRefs: [{ objectId: "object-id", revision: "fixed-version" }],
    contextPurpose: "审阅所选内容", input: { message: "review" } });
});

test("adding an object preserves the explicitly locked paper set in the same fixed context request", async () => {
  const objectRef = { objectId: "note", revision: "note-v1" };
  const paperRef = { objectId: "source", revision: "paper-v1" };
  const prepare = vi.fn(async () => {});
  const capturePaperContext = vi.fn(async () => [paperRef]);
  const api = createAgentApplicationService({ supportsObjectContext: true,
    resolveContext: () => ({}), executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async () => ({ message: "组合上下文已收到" }) });
  const submit = vi.spyOn(api, "submitTurn");
  const client = createFrontendAgentClient(api);
  const port = { receiveContextDrop: async () => [{ ref: objectRef, refs: [objectRef], title: "笔记", kind: "content.note" }],
    capturePaperContext } as unknown as ObjectWorkbenchPort;
  const result = render(<ObjectWorkbenchContext.Provider value={port}>
    <AssistantPane agentClient={client} onGenerateArtifact={() => "unused"} onPreparePapersForContext={prepare}
      selectedPapers={[{ id: "paper", title: "锁定论文" }]}
      selectedSetStatus={{ selectedCount: 1, importedCount: 1, selectionLocked: true }} />
  </ObjectWorkbenchContext.Provider>);
  const transfer = { types: ["application/x-liteasy-object-transfer+json"], getData: () => "" } as unknown as DataTransfer;
  fireEvent.drop(result.container.querySelector(".assistant-pane")!, { dataTransfer: transfer });
  expect(await screen.findByRole("button", { name: "移除上下文：笔记" })).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "结合锁定论文审阅");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(prepare).toHaveBeenCalledWith(["paper"]);
  expect(capturePaperContext).toHaveBeenCalledWith(["paper"]);
  expect(submit.mock.calls[0][0].contextRefs).toEqual([objectRef, paperRef]);
  expect(submit.mock.calls[0][0].attachments).toBeUndefined();
  expect(await screen.findByText("组合上下文已收到")).toBeInTheDocument();
});

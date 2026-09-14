import type { ArtifactTab } from "../app/features/artifacts/artifact.types";
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { useAssistantContextCatalog } from "../app/controllers/useAssistantContextCatalog";
import { useObjectWorkbenchController, type ObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";

const files = vi.hoisted(() => ({
  listMounts: vi.fn(async () => [{ id: "vault", location: "/Research Vault" }, { id: "offline", location: "/offline" }]),
  listEntries: vi.fn(async (id: string) => {
    if (id === "offline") throw new Error("已断开");
    return [{ mountId: "vault", path: "project/methods/review.md", name: "review.md", kind: "file" }];
  }),
  readFile: vi.fn(async () => ({ mountId: "vault", path: "project/methods/review.md", name: "review.md", kind: "file", version: "v1", text: "磁盘文件正文：归一化后权重和为一。" })),
}));
vi.mock("../app/features/note-files/noteFileService", () => ({
  createNoteFileService: () => files,
  subscribeNoteFiles: () => () => undefined,
}));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); files.readFile.mockClear(); });

test("searches all mounted paths and sends the selected file body via fixed context references", async () => {
  const scopeId = crypto.randomUUID();
  let workbench: ObjectWorkbenchController;
  const execute = vi.fn(async (input) => ({ message: `收到：${input.context.objectSnapshot.entries.map((entry: { text: string }) => entry.text).join("\n")}` }));
  const api = createAgentApplicationService({ supportsObjectContext: true, getPrincipalId: () => scopeId,
    resolveContext: async ({ request }) => ({ objectSnapshot: await workbench.resolveContext(request) }),
    executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: execute });
  const submit = vi.spyOn(api, "submitTurn");
  const client = createFrontendAgentClient(api);
  function Harness() {
    workbench = useObjectWorkbenchController({ scopeId, getApi: () => api, getPapers: () => [],
      getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() });
    const suggestions = useAssistantContextCatalog({ artifacts: [], objects: workbench.objects,
      repository: workbench.repository, port: workbench.port });
    return <ObjectWorkbenchContext.Provider value={workbench.port}>
      <AssistantPane contextSuggestions={suggestions} agentClient={client} onGenerateArtifact={() => "unused"}
        selectedSetStatus={{ selectedCount: 0, importedCount: 0, selectionLocked: false }} />
    </ObjectWorkbenchContext.Provider>;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "@Research Vault/project/methods");
  expect(await screen.findByRole("button", { name: /review.md/ })).toBeInTheDocument();
  expect(files.readFile).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("button", { name: "移除上下文：review.md" })).toBeInTheDocument();
  expect(files.readFile).toHaveBeenCalledWith("vault", "project/methods/review.md");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "解释这个笔记");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0][0].contextRefs).toHaveLength(1);
  expect(await screen.findByText("收到：磁盘文件正文：归一化后权重和为一。")).toBeInTheDocument();
  expect(workbench!.visible).toBe(false);
  await act(async () => {});
});


test("keeps candidate and resolver identity on unrelated component renders", async () => {
  const artifacts: [] = [];
  const scopeId = crypto.randomUUID();
  const { result, rerender } = renderHook(({ tick }: { tick: number }) => {
    void tick;
    const workbench = useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
      getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() });
    return useAssistantContextCatalog({ artifacts, objects: workbench.objects,
      repository: workbench.repository, port: workbench.port });
  }, { initialProps: { tick: 0 } });
  await waitFor(() => expect(result.current.some((item) => item.label === "review.md")).toBe(true));
  const suggestions = result.current;
  rerender({ tick: 1 });
  expect(result.current).toBe(suggestions);
});


test("reuses candidates for new arrays with unchanged entries and invalidates changed content or order", async () => {
  const artifacts: ArtifactTab[] = [
    { artifactId: "first", title: "首份薄读", type: "thin_reading" },
    { artifactId: "second", title: "另一份薄读", type: "thin_reading" },
  ];
  const scopeId = crypto.randomUUID();
  const { result, rerender } = renderHook(({ records }: { records: ArtifactTab[] }) => {
    const workbench = useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
      getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() });
    const suggestions = useAssistantContextCatalog({ artifacts: [...records], objects: [...workbench.objects],
      repository: workbench.repository, port: workbench.port });
    return { suggestions, workbench };
  }, { initialProps: { records: artifacts } });
  await waitFor(() => expect(result.current.suggestions.some((item) => item.label === "review.md")).toBe(true));
  await act(async () => { await result.current.workbench.createNote("稳定的笔记正文"); });
  expect(result.current.workbench.objects.length).toBeGreaterThan(0);
  const suggestions = result.current.suggestions;
  rerender({ records: [...artifacts] });
  expect(result.current.suggestions).toBe(suggestions);
  rerender({ records: [artifacts[1], artifacts[0]] });
  expect(result.current.suggestions).not.toBe(suggestions);
  expect(result.current.suggestions.slice(0, 2).map((item) => item.label)).toEqual(["另一份薄读", "首份薄读"]);
  rerender({ records: [{ ...artifacts[1], title: "更新后的薄读" }, artifacts[0]] });
  expect(result.current.suggestions[0].label).toBe("更新后的薄读");
});

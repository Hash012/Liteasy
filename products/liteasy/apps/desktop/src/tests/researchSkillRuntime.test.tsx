import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { useResearchSkillsController } from "../app/controllers/useResearchSkillsController";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf } from "../app/features/objects/object.types";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { createLocalArtifactResultClient } from "../app/features/artifacts/localArtifactResultClient";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { listResearchSkills } from "../app/features/research-skills/researchSkillCatalog";
import { loadDurableEntries } from "../app/features/persistence/durableJsonStore";
const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer: model.generate }) }));
async function fixture() {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope), projects = createPaperProjectRepository(storage, scope);
  const source = await repository.create({ kind: "content.note", title: "Selected source A", content: { schema: "liteasy.note/v1", payload: { text: "Synthetic evidence: 12 observations.", origin: "user" } } });
  const owner = await projects.ensurePaperProject({ paperId: "owner-B", title: "Explicit owner B" });
  const destination = { kind: "entry-child" as const, canonicalEntryId: owner.projectId, scopeId: scope, paperId: owner.paperId, title: owner.title };
  const skill = listResearchSkills().find(skill => skill.id === "research-read")!;
  model.generate.mockReset().mockResolvedValue({ answer: JSON.stringify({ schema: "liteasy.research-draft/v1", title: "Research output", documentKind: "paper_brief", sections: skill.adapter!.output.requiredSections.map(id => ({ id, markdown: "Evidence [S1]", sourceIds: ["S1"] })), claims: [], limitations: ["Synthetic"], nextActions: [] }), terminal: "completed", trace: { mode: "live" } });
  const client = createLocalArtifactResultClient();
  const input = { repository, projects, destinations: [destination], settings: createSettingsStore().getState(), store: createArtifactStore(scope), client, sync: vi.fn(), notice: vi.fn() };
  const request = { selection: { skill: skill.ref!, destination, roles: {}, preset: { parameters: {} } }, prompt: "", refs: [refOf(source)], origin: { kind: "conversation_action" as const, entryPoint: "test", initiatedBy: { type: "user" as const, id: "user" } } };
  return { input, request, scope };
}
test("real IndexedDB output survives reload, has one explicit owner and rejects a different payload", async () => {
  const { input, request } = await fixture();
  const view = renderHook(() => useResearchSkillsController(input));
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(request)).taskIds[0]; });
  await waitFor(() => expect(input.store.getTask(taskId)?.status).toBe("completed"));
  const id = input.store.getTask(taskId)!.artifactId!;
  const saved = (await createLocalArtifactResultClient().list()).find(item => item.artifactId === id)!;
  expect(saved.researchDocument?.invocation.destination.paperId).toBe("owner-B");
  expect(saved.researchDocument?.sources[0].text).toContain("12 observations");
  expect((await input.projects.listAssets(request.selection.destination.canonicalEntryId)).filter(asset => asset.artifactId === id)).toHaveLength(1);
  await expect(input.client.save({ ...saved, createdAt: "2026-10-15T00:00:00.000Z" })).rejects.toThrow();
  expect(model.generate).toHaveBeenCalledTimes(1);
  await view.result.current.createEditableCopy(saved.researchDocument!);
  expect((await input.projects.listAssets(request.selection.destination.canonicalEntryId)).some(asset => asset.kind === "note")).toBe(true);
});
test("failed save checkpoints validated bytes; reload retries save without regenerating", async () => {
  const { input, request, scope } = await fixture();
  const real = input.client;
  const save = vi.fn().mockRejectedValue(new Error("disk full"));
  input.client = { ...real, save };
  const view = renderHook(() => useResearchSkillsController(input));
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(request)).taskIds[0]; });
  await waitFor(() => expect(input.store.getTask(taskId)?.status).toBe("failed"));
  expect(input.store.getTask(taskId)?.pendingResult?.document.researchDocument).toBeTruthy();
  const entries = await loadDurableEntries("artifact-tasks");
  expect(JSON.stringify(entries[`research:${scope}`])).toContain("12 observations");
  view.unmount();
  const restored = { ...input, store: createArtifactStore(`${scope}-restored`), client: real };
  const next = renderHook(() => useResearchSkillsController(restored));
  await waitFor(() => expect(restored.store.getTask(taskId)?.pendingResult).toBeTruthy());
  await act(async () => { await next.result.current.retry(taskId); });
  expect(restored.store.getTask(taskId)?.status).toBe("completed");
  expect(restored.store.getTask(taskId)?.failure).toBeUndefined();
  expect(model.generate).toHaveBeenCalledTimes(1);
});

test("cancelling before generation completes saves no result", async () => {
  const { input, request } = await fixture();
  let finish!: (value: unknown) => void;
  const successful = await model.generate(); model.generate.mockClear();
  model.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useResearchSkillsController(input));
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(request)).taskIds[0]; });
  await waitFor(() => expect(model.generate).toHaveBeenCalledTimes(1));
  await act(async () => { await view.result.current.cancel(taskId); finish(successful); });
  expect(input.store.getTask(taskId)?.status).toBe("cancelled");
  expect((await input.client.list()).filter(item => item.researchDocument?.invocation.scopeId === input.repository.scopeId)).toHaveLength(0);
});

test("switching the local workspace scope removes old research projections and tasks", async () => {
  const first = await fixture();
  const view = renderHook(({ input }) => useResearchSkillsController(input), { initialProps: { input: first.input } });
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(first.request)).taskIds[0]; });
  await waitFor(() => expect(first.input.store.getTask(taskId)?.status).toBe("completed"));
  const second = await fixture();
  view.rerender({ input: { ...second.input, store: first.input.store } });
  await waitFor(() => expect(first.input.store.getTask(taskId)).toBeUndefined());
  expect(first.input.store.getCatalog().some(item => item.researchDocument?.invocation.scopeId === first.scope)).toBe(false);
});

test("failed research retains the cause and model binding instead of only a generic failure", async () => {
  const { input, request } = await fixture();
  model.generate.mockRejectedValue(new Error("HTTP 400 unsupported response_format; api_key=synthetic-secret"));
  const view = renderHook(() => useResearchSkillsController(input));
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(request)).taskIds[0]; });
  await waitFor(() => expect(input.store.getTask(taskId)?.status).toBe("failed"));
  const failure = input.store.getTask(taskId)!.failure!;
  expect(failure.message).toContain("unsupported response_format");
  expect(failure.message).not.toContain("synthetic-secret");
  expect(failure.provider).toBeTruthy(); expect(failure.model).toBeTruthy();
  expect(input.notice).toHaveBeenCalledWith(expect.stringContaining("结构化输出方式"));
  expect((await input.client.list()).filter(item => item.researchDocument?.invocation.scopeId === input.repository.scopeId)).toHaveLength(0);
});

test("a recorded failure survives app restart with its original diagnostic and time", async () => {
  const { input, request } = await fixture();
  model.generate.mockRejectedValue(new Error("模型输出达到长度上限"));
  const view = renderHook(() => useResearchSkillsController(input));
  let taskId = "";
  await act(async () => { taskId = (await view.result.current.start(request)).taskIds[0]; });
  await waitFor(() => expect(input.store.getTask(taskId)?.status).toBe("failed"));
  const failure = structuredClone(input.store.getTask(taskId)!.failure);
  await waitFor(async () => expect(JSON.stringify(await loadDurableEntries("artifact-tasks"))).toContain("模型输出达到长度上限"));
  view.unmount();
  const reloaded = { ...input, store: createArtifactStore(`${input.repository.scopeId}-reload`) };
  renderHook(() => useResearchSkillsController(reloaded));
  await waitFor(() => expect(reloaded.store.getTask(taskId)?.failure).toEqual(failure));
  expect(model.generate).toHaveBeenCalledOnce();
});

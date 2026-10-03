import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useCommunitySourceController } from "../app/controllers/useCommunitySourceController";
import { communitySourceLink, type CommunitySourceReference, type CommunitySourceRevision } from "../app/features/forum/communitySourceReference";
import type { ObjectRef } from "../app/features/objects/object.types";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { externalModelAssetService } from "../app/features/models/externalSourcePolicy";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { reflectionDrafts } from "../app/features/forum/communityReflectionDrafts";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const source: CommunitySourceRevision = { sourceNamespace: "intuecho.annotation", sourceId: "synthetic-annotation", revision: 2, currentRevision: 3, historical: true, visibility: "organization", organizationId: "synthetic-org", body: "SYNTHETIC ORGANIZATION BODY MUST NOT COPY" };
const link = communitySourceLink(source);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const scope = crypto.randomUUID(), repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const create = vi.spyOn(repository, "create"), readCommunitySource = vi.fn(async (_reference: CommunitySourceReference): Promise<CommunitySourceRevision> => source), collect = vi.fn(async (_ref: ObjectRef) => {}), openNote = vi.fn(async (_ref: ObjectRef) => {});
  let controller!: ReturnType<typeof useCommunitySourceController>;
  function View({ actor = "a" }: { actor?: string }) { controller = useCommunitySourceController({ actorKey: actor, repository, client: { readCommunitySource }, collect, openNote }); return controller.dialog; }
  const view = render(<View />);
  return { scope, repository, create, readCommunitySource, collect, openNote, view, View, begin: (url = link) => controller.open(url), open: (url = link) => act(async () => { await controller.open(url); }) };
}
async function startSave(f: ReturnType<typeof fixture>) {
  await f.open();
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "My own reflection" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" })); });
}
test("explicit note return saves only personal reflection and the fixed source, with organization lineage", async () => {
  const f = fixture();
  await startSave(f);
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(f.create).toHaveBeenCalledOnce();
  const ref = f.openNote.mock.calls[0][0];
  const note = await f.repository.get(ref);
  expect(JSON.stringify(note)).toContain("My own reflection");
  expect(JSON.stringify(note)).toContain("revision=2");
  expect(JSON.stringify(note)).not.toContain(source.body);
  const assets = createWorkspaceAgentAssetService({ repository: f.repository, active: () => true });
  await expect(externalModelAssetService(assets).read(liteasyPath(f.scope, { kind: "object", ref }))).rejects.toThrow("属于组织");
});
test("access loss on explicit save hides the cached body and creates no note", async () => {
  const f = fixture();
  f.readCommunitySource.mockResolvedValueOnce(source).mockRejectedValueOnce(new Error("来源当前不可访问"));
  await startSave(f);
  expect(await screen.findByRole("alert")).toHaveTextContent("不可访问");
  expect(screen.queryByText(source.body!)).not.toBeInTheDocument();
  expect(f.create).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("My own reflection");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" })); });
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
});
test("a storage failure keeps the reflection and verified preview for an explicit retry", async () => {
  const f = fixture();
  f.create.mockRejectedValueOnce(new Error("本机存储暂不可用"));
  await startSave(f);
  expect(await screen.findByRole("alert")).toHaveTextContent("本机存储暂不可用");
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("My own reflection");
  expect(screen.getByText(source.body!)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" })); });
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(f.create.mock.calls[0][1]).toBe(f.create.mock.calls[1][1]);
  expect(f.readCommunitySource).toHaveBeenCalledTimes(3);
});
test.each(["close", "account", "source"])("a pending save invalidated by %s cannot write or close the next source", async (change) => {
  const f = fixture(), pending = deferred<CommunitySourceRevision>();
  f.readCommunitySource.mockResolvedValueOnce(source).mockImplementationOnce(() => pending.promise);
  await startSave(f);
  if (change === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  if (change === "account") f.view.rerender(<f.View actor="b" />);
  if (change === "source") await f.open(communitySourceLink({ ...source, sourceId: "next-source" }));
  await act(async () => pending.resolve(source));
  expect(f.create).not.toHaveBeenCalled();
  expect(f.openNote).not.toHaveBeenCalled();
  if (change === "source") expect(screen.getByRole("dialog")).toBeInTheDocument();
});
test("rapid repeated saves share one permission check and one committed note", async () => {
  const f = fixture(), pending = deferred<CommunitySourceRevision>();
  f.readCommunitySource.mockResolvedValueOnce(source).mockImplementationOnce(() => pending.promise);
  await startSave(f);
  fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" }));
  await act(async () => pending.resolve(source));
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(f.readCommunitySource).toHaveBeenCalledTimes(2);
  expect(f.create).toHaveBeenCalledOnce();
});
test("account switch hides a late preview and confirmed literature remains a normal personal reference", async () => {
  const f = fixture(), pending = deferred<CommunitySourceRevision>();
  f.readCommunitySource.mockImplementationOnce(() => pending.promise);
  let loading!: Promise<void>;
  act(() => { loading = f.begin(); });
  f.view.rerender(<f.View actor="b" />);
  await act(async () => pending.resolve(source));
  await loading;
  expect(screen.queryByText(source.body!)).not.toBeInTheDocument();
  expect(f.create).not.toHaveBeenCalled();
  f.readCommunitySource.mockResolvedValue({ sourceNamespace: "intuecho.literature", sourceId: "literature", revision: 1, currentRevision: 1, historical: false, literature: { title: "Confirmed public reference" } });
  await startSave(f);
  await waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  expect(f.create.mock.calls[0][0].sourceResolution).toBeUndefined();
});

test("preserves a private reflection across current-version preview, close and remount", async () => {
  const f = fixture();
  await f.open();
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "Private draft about the cited revision" } });
  f.readCommunitySource.mockResolvedValue({ ...source, revision: 3, currentRevision: 3, historical: false, body: "Corrected synthetic source" });
  fireEvent.click(screen.getByRole("button", { name: "查看当前修订" }));
  await screen.findByText("Corrected synthetic source");
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("Private draft about the cited revision");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  f.view.unmount();
  render(<f.View />);
  f.readCommunitySource.mockResolvedValue(source);
  await f.open();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("Private draft about the cited revision");
  expect(f.create).not.toHaveBeenCalled();
});

test("reflection recovery is isolated by account while keeping the original author's draft", async () => {
  const f = fixture();
  await f.open();
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "Account A private idea" } });
  f.view.rerender(<f.View actor="b" />);
  await f.open();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("");
  f.view.rerender(<f.View actor="a" />);
  await f.open();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("Account A private idea");
  expect(f.create).not.toHaveBeenCalled();
});

test("previewing the current source never silently changes the reflection citation", async () => {
  const f = fixture();
  f.readCommunitySource.mockImplementation(async (reference) => ({ ...source, revision: reference.revision,
    historical: reference.revision === 2, body: reference.revision === 2 ? "Cited source" : "Current source" }));
  await f.open();
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "Thinking about revision two" } });
  fireEvent.click(screen.getByRole("button", { name: "查看当前修订" }));
  await screen.findByText("Current source");
  fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" }));
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(f.readCommunitySource).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }));
  expect(JSON.stringify(f.create.mock.calls[0][0])).toContain("revision=2");
  expect(JSON.stringify(f.create.mock.calls[0][0])).not.toContain("Current source");
});

test("a failed draft save keeps the visible text and prevents an unnoticed close", async () => {
  const f = fixture();
  await f.open();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "Unsaved important idea" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("Unsaved important idea");
  expect(screen.getByRole("alert")).toHaveTextContent("想法尚未保存");
  expect(f.create).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test("a successful save cannot clean up newer reflection text typed while access was checked", async () => {
  const f = fixture(), pending = deferred<CommunitySourceRevision>();
  f.readCommunitySource.mockResolvedValueOnce(source).mockImplementationOnce(() => pending.promise);
  await startSave(f);
  fireEvent.change(screen.getByRole("textbox", { name: "带回个人笔记的想法" }), { target: { value: "A newer thought to keep" } });
  await act(async () => pending.resolve(source));
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(JSON.stringify(f.create.mock.calls[0][0])).toContain("My own reflection");
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("A newer thought to keep");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  f.view.unmount();
  render(<f.View />);
  await f.open();
  expect(screen.getByRole("textbox", { name: "带回个人笔记的想法" })).toHaveValue("A newer thought to keep");
});

test("reopening after a failed save preserves retry identity without deleting another writer's draft", async () => {
  const f = fixture();
  f.create.mockRejectedValueOnce(new Error("Storage unavailable"));
  await startSave(f);
  await screen.findByRole("alert");
  const original = reflectionDrafts(JSON.stringify(["a", f.scope]), source)[0];
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  f.view.unmount();
  render(<f.View />);
  await f.open();
  fireEvent.click(screen.getByRole("button", { name: "新建个人笔记" }));
  await waitFor(() => expect(f.openNote).toHaveBeenCalledOnce());
  expect(f.create.mock.calls[0][1]).toBe(f.create.mock.calls[1][1]);
  expect(reflectionDrafts(JSON.stringify(["a", f.scope]), source)).toContainEqual(original);
});

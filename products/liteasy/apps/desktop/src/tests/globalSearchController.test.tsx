import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useGlobalSearchController } from "../app/controllers/useGlobalSearchController";
import type { ObjectRepository } from "../app/features/objects/objectRepository";
import type { Paper } from "../app/features/workspace/workspace.types";

const { collect, verify } = vi.hoisted(() => ({ collect: vi.fn(), verify: vi.fn(async () => true) }));
vi.mock("../app/features/global-search/workspaceSearchSource", async (importOriginal) => ({
  ...await importOriginal<typeof import("../app/features/global-search/workspaceSearchSource")>(),
  createWorkspaceSearchSource: () => ({
    collect, verify,
  }),
}));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  collect.mockReset().mockResolvedValue({ limited: false, documents: [{ id: "note", title: "Recovered note", revision: "v1", coverage: "indexed",
    sections: [{ key: "body", group: "note", text: "owned recovered", locator: { path: "synthetic:note" } }] }] });
  verify.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 330)); });

test("replacing the repository in the same scope refreshes the new service before searching", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const scopeId = crypto.randomUUID();
  const papers: Paper[] = [];
  const open = vi.fn(async () => {});
  const original = { scopeId } as ObjectRepository;
  const hook = renderHook(({ repository }) => useGlobalSearchController({ repository, papers, open }), { initialProps: { repository: original } });
  act(() => { hook.result.current.show(); hook.result.current.setQuery("owned"); });
  await waitFor(() => expect(hook.result.current.hits.map((hit) => hit.title)).toEqual(["Recovered note"]));
  hook.rerender({ repository: { scopeId } as ObjectRepository });
  await waitFor(() => expect(hook.result.current.hits.map((hit) => hit.title)).toEqual(["Recovered note"]));
  expect(hook.result.current.query).toBe("owned");
  expect(hook.result.current.coverage?.indexed).toBe(1);
  expect(collect).toHaveBeenCalledTimes(2);
});


test("unchanged papers, focus and reopening preserve completed results without rescanning or querying", async () => {
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const papers: Paper[] = [{ id: "p", title: "巴赫传", authors: ["Author"], year: 2020 }];
  const hook = renderHook(({ papers }) => useGlobalSearchController({ repository, papers, open: async () => {} }), { initialProps: { papers } });
  act(() => hook.result.current.show());
  await settle();
  expect(collect).toHaveBeenCalledTimes(1); // Opening prepares the index before typing.
  expect(verify).not.toHaveBeenCalled();
  act(() => hook.result.current.setQuery("owned"));
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  const hits = hook.result.current.hits;
  hook.rerender({ papers: papers.map((paper) => ({ ...paper, authors: [...paper.authors!] })) });
  act(() => { window.dispatchEvent(new Event("focus")); hook.result.current.show(); });
  await settle();
  act(() => hook.result.current.close());
  act(() => hook.result.current.show());
  await settle();
  expect(hook.result.current.hits).toBe(hits);
  expect(hook.result.current.busy).toBe(false);
  expect(collect).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

test("query and range changes reuse the index, including returning to an interrupted query", async () => {
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const hook = renderHook(() => useGlobalSearchController({ repository, papers: [], open: async () => {} }));
  act(() => { hook.result.current.show(); hook.result.current.setQuery("owned"); });
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  act(() => hook.result.current.setQuery("missing"));
  act(() => hook.result.current.setQuery("owned"));
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  act(() => hook.result.current.setGroup("annotation"));
  await settle();
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(hook.result.current.hits).toHaveLength(0);
  act(() => hook.result.current.setGroup("note"));
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  act(() => hook.result.current.setQuery('"owned'));
  await waitFor(() => expect(hook.result.current.error).toContain("补上"));
  act(() => hook.result.current.setQuery(""));
  expect(hook.result.current.error).toBe("");
  act(() => hook.result.current.setQuery("owned"));
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  expect(collect).toHaveBeenCalledTimes(1);
});

test("actual paper changes and relevant saved content refresh, but unrelated writes do not", async () => {
  const { createObjectStorage } = await import("../app/features/objects/objectStorage");
  const { PAPER_FULLTEXT_SAVED_EVENT } = await import("../app/features/library/userPaperArtifactClient");
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const storage = createObjectStorage(repository.scopeId, () => repository.scopeId);
  const hook = renderHook(({ title }) => useGlobalSearchController({ repository, papers: [{ id: "p", title }], open: async () => {} }), { initialProps: { title: "Old title" } });
  act(() => { hook.result.current.show(); hook.result.current.setQuery("owned"); });
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  hook.rerender({ title: "Corrected title" });
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  await act(async () => { await storage.commit([{ key: "reading-library/import/mapping", expected: null, row: { key: "reading-library/import/mapping", version: "1", value: {} } }]); });
  act(() => window.dispatchEvent(new CustomEvent(PAPER_FULLTEXT_SAVED_EVENT, { detail: "other-paper" })));
  await settle();
  expect(collect).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new CustomEvent(PAPER_FULLTEXT_SAVED_EVENT, { detail: "p" })));
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  await act(async () => { await storage.commit([{ key: "head/note", expected: null, row: { key: "head/note", version: "1", value: {} } }]); });
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(5));
});

test("changes while closed invalidate cached results and account changes never reuse them", async () => {
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const hook = renderHook(({ repository, title }) => useGlobalSearchController({ repository, papers: [{ id: "p", title }], open: async () => {} }), { initialProps: { repository, title: "Before" } });
  act(() => { hook.result.current.show(); hook.result.current.setQuery("owned"); });
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  act(() => hook.result.current.close());
  hook.rerender({ repository, title: "After" });
  await settle();
  expect(collect).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.show());
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  hook.rerender({ repository: { scopeId: crypto.randomUUID() } as ObjectRepository, title: "Other scope" });
  expect(hook.result.current.hits).toEqual([]);
  expect(hook.result.current.query).toBe("");
});

test("typing and closing during a slow warmup reuse one index pass and only search the latest query", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  collect.mockImplementation(async () => {
    await gate;
    return { limited: false, documents: [{ id: "note", title: "Owned", revision: "1", coverage: "indexed",
      sections: [{ key: "body", group: "note", text: "owned recovered", locator: { path: "synthetic:note" } }] }] };
  });
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const hook = renderHook(() => useGlobalSearchController({ repository, papers: [], open: async () => {} }));
  act(() => hook.result.current.show());
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
  for (const query of ["ow", "own", "owned"]) {
    act(() => hook.result.current.setQuery(query));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  }
  act(() => hook.result.current.close());
  expect((collect.mock.calls[0][0] as AbortSignal).aborted).toBe(false);
  await act(async () => { finish(); await gate; });
  act(() => hook.result.current.show());
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  expect(hook.result.current.query).toBe("owned");
  expect(collect).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

test("an edit cancels obsolete warmup and only the new corpus can supply results", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  collect.mockImplementationOnce(async () => { await gate; return { limited: false, documents: [] }; });
  const repository = { scopeId: crypto.randomUUID() } as ObjectRepository;
  const hook = renderHook(({ title }) => useGlobalSearchController({ repository, papers: [{ id: "p", title }], open: async () => {} }), { initialProps: { title: "before" } });
  act(() => { hook.result.current.show(); hook.result.current.setQuery("owned"); });
  await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
  hook.rerender({ title: "after" });
  expect((collect.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  await act(async () => { finish(); await gate; });
  await waitFor(() => expect(hook.result.current.hits).toHaveLength(1));
  expect(collect).toHaveBeenCalledTimes(2);
});

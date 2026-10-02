import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useGlobalSearchController } from "../app/controllers/useGlobalSearchController";
import type { ObjectRepository } from "../app/features/objects/objectRepository";
import type { Paper } from "../app/features/workspace/workspace.types";

vi.mock("../app/features/global-search/workspaceSearchSource", () => ({
  createWorkspaceSearchSource: () => ({
    collect: async () => ({ limited: false, documents: [{ id: "note", title: "Recovered note", revision: "v1", coverage: "indexed",
      sections: [{ key: "body", group: "note", text: "owned recovered", locator: { path: "synthetic:note" } }] }] }),
    verify: async () => true,
  }),
}));
afterEach(() => vi.unstubAllGlobals());

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
});

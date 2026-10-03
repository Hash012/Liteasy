import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useCloudLibraryTree } from "../app/features/library/useCloudLibraryTree";
const client = vi.hoisted(() => ({ getTree: vi.fn() }));
vi.mock("../app/features/library/cloudLibraryStorageClient", () => ({ createCloudLibraryStorageClient: () => client }));

function tree(scopeId: string) {
  return { tree: { entries: [{ documentId: "same-id", title: `${scopeId} private title` }], folders: [], revision: 1, scopeId, scopeType: "organization" }, quota: { scopeId, scopeType: "organization", availableBytes: 1, limitBytes: 1, usedBytes: 0 } };
}

test("changing scopes hides the prior tree and refuses its late response", async () => {
  let finish!: (value: ReturnType<typeof tree>) => void;
  const a = new Promise((resolve) => { finish = resolve; });
  client.getTree.mockImplementation((scope) => scope.scopeId === "A" ? a : Promise.resolve(tree("B")));
  const { result, rerender } = renderHook(({ scopeId }) => useCloudLibraryTree({ enabled: true, endpoint: "https://api.example.test", scopeType: "organization", scopeId }), { initialProps: { scopeId: "A" } });
  rerender({ scopeId: "B" });
  await waitFor(() => expect(result.current.tree?.scopeId).toBe("B"));
  await act(async () => { finish(tree("A")); });
  expect(result.current.tree?.scopeId).toBe("B");
  expect(result.current.tree?.entries[0].title).toBe("B private title");
});

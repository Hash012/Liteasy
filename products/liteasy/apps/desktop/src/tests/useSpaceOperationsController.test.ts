import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useSpaceOperationsController } from "../app/controllers/useSpaceOperationsController";
import { getAccountSessionGeneration } from "../app/features/account/accountSessionStorage";
import { accountActorStorageKey } from "../app/features/account/accountSessionBinding";
const session = { name: "Synthetic A", userId: "a", endpoint: "https://liteasy.example.test", issuer: "https://id.example.test", email: "a@example.test", sessionId: "token-a", expiresAt: "2099-01-01" };
test("switching accounts clears prior projections synchronously and ignores late receipts", () => {
  const input = { session, endpoint: session.endpoint, getActorBinding: () => undefined, getPapers: () => [], listArtifacts: vi.fn(async () => []), openAnnotation: vi.fn(), openArtifact: vi.fn(), openLibrary: vi.fn() };
  const { result, rerender } = renderHook((props) => useSpaceOperationsController(props), { initialProps: input });
  const event = { id: "a-upload", actorKey: accountActorStorageKey(session, session.endpoint), generation: getAccountSessionGeneration(), title: "A private file", phase: "running" as const };
  const oldReport = result.current.reportTransfer;
  act(() => oldReport(event));
  expect(result.current.rows).toHaveLength(1);
  rerender({ ...input, session: { ...session, userId: "b", sessionId: "token-b" } });
  expect(result.current.rows).toEqual([]);
  act(() => oldReport({ ...event, phase: "completed" }));
  expect(result.current.rows).toEqual([]);
  expect(input.listArtifacts).not.toHaveBeenCalled();
});

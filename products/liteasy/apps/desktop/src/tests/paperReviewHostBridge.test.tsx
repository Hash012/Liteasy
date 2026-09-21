import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentPublicApi } from "../app/features/agent-api/agentApi.types";
import { useTauriAgentHostBridge } from "../app/controllers/agent/useTauriAgentHostBridge";
import { paperReviewShareStore } from "../app/features/pdf/paperReviewShare";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

const host = vi.hoisted(() => ({ callback: undefined as undefined | ((event: { payload: unknown }) => Promise<void>),
  invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, callback) => { host.callback = callback; return () => {}; }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
afterEach(() => { cleanup(); vi.clearAllMocks(); const id = paperReviewShareStore.getId(); if (id) paperReviewShareStore.revoke(id); });

test("the native review request uses the private snapshot without invoking the Agent API", async () => {
  const submitTurn = vi.fn();
  renderHook(() => useTauriAgentHostBridge({ submitTurn } as unknown as AgentPublicApi));
  await waitFor(() => expect(host.callback).toBeDefined());
  const reviewId = paperReviewShareStore.share({ title: "Review paper", pageTexts: { 1: "Source context" }, annotations: [{
    id: "note", revision: 1, page: 1, kind: "note", text: "note", excerpt: "Quote", note: "My comment", rects: [],
    createdAt: "", updatedAt: "", paperIdentity: resolvePaperIdentity({ id: "p", title: "Review paper" }),
    publication: { desiredVisibility: "private", state: "not_published" },
  }] }, () => true);
  await act(async () => host.callback!({ payload: { kind: "paper_review", requestId: "request-1", payload: { operation: "comments", reviewId } } }));
  expect(host.invoke).toHaveBeenCalledWith("agent_host_reply", expect.objectContaining({
    requestId: "request-1", response: { ok: true, value: expect.objectContaining({ comments: [expect.objectContaining({ comment: "My comment" })] }) },
  }));
  paperReviewShareStore.revoke(reviewId);
  await act(async () => host.callback!({ payload: { kind: "paper_review", requestId: "request-2", payload: { operation: "comments", reviewId } } }));
  expect(host.invoke).toHaveBeenLastCalledWith("agent_host_reply", expect.objectContaining({ response: { ok: false, error: expect.stringContaining("review_not_shared") } }));
  expect(submitTurn).not.toHaveBeenCalled();
});
